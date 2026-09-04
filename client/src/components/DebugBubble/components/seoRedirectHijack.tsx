import React from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";

/** Helpers for SEO modal “live URL redirected away” warning. */

export type RedirectTestConflict = {
  kind: string;
  from?: string;
  source?: string;
  to?: string | Record<string, string>;
  message?: string;
};

export type RedirectTestLike = {
  match?: boolean;
  resolvedTo?: string;
  to?: string | Record<string, string>;
  source?: string;
  conflicts?: RedirectTestConflict[];
};

/** Prefer content-index livePath from seo-preview; fall back to meta.canonical_url path. */
export function resolveSeoLiveProbePath(
  seoData: { livePath?: unknown } | null | undefined,
  canonicalUrl: string | undefined | null,
): string | null {
  const fromPreview =
    typeof seoData?.livePath === "string" ? seoData.livePath.trim() : "";
  if (fromPreview.startsWith("/")) return fromPreview;

  const raw = (canonicalUrl || "").trim();
  if (!raw) return null;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const pathname = new URL(raw).pathname;
      return pathname && pathname !== "/" ? pathname.replace(/\/$/, "") || null : null;
    }
  } catch {
    return null;
  }
  if (raw.startsWith("/")) {
    return raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
  }
  return null;
}

export function isLiveUrlRedirectHijack(result: RedirectTestLike | null | undefined): boolean {
  if (!result || result.match !== true) return false;
  return (result.conflicts ?? []).some((c) => c.kind === "overwrites_content");
}

export function formatRedirectDestination(to: string | Record<string, string> | undefined): string {
  if (!to) return "";
  if (typeof to === "string") return to;
  return Object.values(to).filter(Boolean).join(", ");
}

export function hijackDestination(result: RedirectTestLike): string {
  if (typeof result.resolvedTo === "string" && result.resolvedTo) return result.resolvedTo;
  return formatRedirectDestination(result.to);
}

export function privateRedirectsInspectHref(livePath: string): string {
  return `/private/redirects?url=${encodeURIComponent(livePath)}`;
}

export function LiveUrlRedirectHijackBanner({
  livePath,
  destination,
  sourceLabel,
}: {
  livePath: string;
  destination?: string;
  sourceLabel?: string;
}) {
  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive dark:text-red-300 space-y-1.5"
      data-testid="banner-seo-live-url-hijack"
    >
      <p className="flex items-start gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
        <span>
          Visitors who open this page’s live URL (
          <code className="font-mono">{livePath}</code>
          ) are sent elsewhere (301). That does not change the old→here list below.
        </span>
      </p>
      {(destination || sourceLabel) && (
        <p className="text-muted-foreground dark:text-red-200/80 pl-5">
          {destination ? (
            <>
              Goes to <code className="font-mono text-destructive dark:text-red-300">{destination}</code>
            </>
          ) : null}
          {destination && sourceLabel ? " · " : null}
          {sourceLabel ? (
            <>
              Rule in <code className="font-mono text-destructive dark:text-red-300">{sourceLabel}</code>
            </>
          ) : null}
        </p>
      )}
      <a
        href={privateRedirectsInspectHref(livePath)}
        className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground transition-colors pl-5"
        data-testid="link-seo-hijack-open-redirects"
      >
        Open in Redirects
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    </div>
  );
}
