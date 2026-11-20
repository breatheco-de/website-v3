import { IconAlertTriangle, IconExternalLink } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  INTERNAL_LINK_WARNING_CODES,
  type BrokenInternalLink,
  type InternalLinkWarning,
} from "@shared/internalLinkGate";

export const BROKEN_LINKS_STAFF_MESSAGE =
  "This page links to pages that don't exist. Fix or remove those links, then save again.";

/** `sections[2].data.content` → "Section 3 · data.content" */
export function describeLinkField(fieldPath: string, component?: string): string {
  const m = fieldPath.match(/^sections\[(\d+)\]\.?(.*)$/);
  if (!m) return fieldPath;
  const section = `Section ${Number(m[1]) + 1}${component ? ` (${component})` : ""}`;
  return m[2] ? `${section} · ${m[2]}` : section;
}

/** Plain-text list for toasts: one line per broken link with its field and suggestion. */
export function brokenLinksToastDescription(links: BrokenInternalLink[]): string {
  const lines = links.slice(0, 8).map((l) => {
    const draft = l.draft_target ? " (still a draft)" : "";
    const hint = l.closest_live_match ? ` → did you mean ${l.closest_live_match}?` : "";
    return `• ${l.link} in ${describeLinkField(l.field_path, l.component)}${draft}${hint}`;
  });
  if (links.length > 8) lines.push(`• and ${links.length - 8} more`);
  return lines.join("\n");
}

/** One-line toast text for non-blocking link warnings returned by a successful save. */
export function linkWarningsToastText(warnings: InternalLinkWarning[] | undefined): string | null {
  if (!warnings?.length) return null;
  const parts: string[] = [];
  for (const w of warnings) {
    const n = w.links?.length ?? 0;
    if (w.code === INTERNAL_LINK_WARNING_CODES.redirects) {
      parts.push(`${n} link(s) redirect to another page — link to the final URL instead.`);
    } else if (w.code === INTERNAL_LINK_WARNING_CODES.draftTarget) {
      parts.push(`${n} link(s) point to pages that are still drafts — publishing will be blocked until they are live.`);
    } else if (w.code === INTERNAL_LINK_WARNING_CODES.draftPageBroken) {
      parts.push(`${n} link(s) go to pages that don't exist — publishing will be blocked until you fix them.`);
    } else if (w.code === INTERNAL_LINK_WARNING_CODES.notEnforced) {
      parts.push(`${BROKEN_LINKS_STAFF_MESSAGE} (${n} link(s). Saving is still allowed on this site for now.)`);
    } else {
      parts.push(w.message);
    }
  }
  return parts.join(" ");
}

const LINK_WARNING_CODES = new Set<string>(Object.values(INTERNAL_LINK_WARNING_CODES));

/** Link warnings from a publish/promote response (`warnings[]` with plain messages). */
export function promoteLinkWarningsText(warnings: unknown): string | null {
  if (!Array.isArray(warnings)) return null;
  const messages = warnings
    .filter((w): w is { code: string; message: string } =>
      !!w && typeof w === "object" && LINK_WARNING_CODES.has((w as { code?: string }).code ?? ""),
    )
    .map((w) => w.message);
  return messages.length ? messages.join(" ") : null;
}

const FACT_LITERAL_WARNING_CODE = "fact_literal_prefer_variable";

/**
 * Exact catalog fact-literal warnings from publish/promote (`warnings[]` and/or
 * `fact_literal_warnings[]`). Soft toast only — prefer {{ global.* }} tokens.
 */
export function promoteFactLiteralWarningsText(
  warnings: unknown,
  factLiteralWarnings?: unknown,
): string | null {
  const messages: string[] = [];
  if (Array.isArray(warnings)) {
    for (const w of warnings) {
      if (
        w &&
        typeof w === "object" &&
        (w as { code?: string }).code === FACT_LITERAL_WARNING_CODE &&
        typeof (w as { message?: string }).message === "string"
      ) {
        messages.push((w as { message: string }).message);
      }
    }
  }
  if (Array.isArray(factLiteralWarnings)) {
    for (const w of factLiteralWarnings) {
      if (w && typeof w === "object" && typeof (w as { message?: string }).message === "string") {
        const msg = (w as { message: string }).message.trim();
        if (msg && !messages.includes(msg)) messages.push(msg);
      }
    }
  }
  return messages.length ? messages.slice(0, 3).join(" ") : null;
}

export function BrokenInternalLinksNotice({
  links,
  className,
}: {
  links: BrokenInternalLink[];
  className?: string;
}) {
  if (links.length === 0) return null;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground",
        className,
      )}
      data-testid="notice-broken-internal-links"
    >
      <div className="flex items-start gap-2">
        <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <p className="font-medium">{BROKEN_LINKS_STAFF_MESSAGE}</p>
      </div>
      <ul className="mt-2 space-y-1.5 pl-6">
        {links.map((l) => (
          <li key={`${l.field_path}|${l.link}`} className="leading-snug">
            <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">{l.link}</code>
            <span className="text-muted-foreground"> in {describeLinkField(l.field_path, l.component)}</span>
            {l.draft_target && <span className="text-muted-foreground"> — that page is still a draft</span>}
            {l.closest_live_match && (
              <span className="text-muted-foreground">
                {" "}
                — did you mean{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">{l.closest_live_match}</code>?
              </span>
            )}
          </li>
        ))}
      </ul>
      <a
        href="/private/redirects"
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1 pl-6 text-xs text-primary hover:underline"
      >
        Check a URL in Redirects → Test a URL
        <IconExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
