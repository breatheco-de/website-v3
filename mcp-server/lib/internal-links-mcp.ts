/**
 * MCP envelopes for the internal-link gate (server code `broken_internal_links`).
 */
import {
  BROKEN_INTERNAL_LINKS_CODE,
  type BrokenInternalLink,
  type InternalLinkWarning,
} from "../../shared/internalLinkGate.js";
import { actionRequired, type McpTextResult, type McpWarning, type NextAction } from "./respond.js";

/**
 * Non-blocking `form_location_warnings` from saves (missing location on a draft / untouched form,
 * wrong or hidden location slugs, form overriding the page's Locations). Paths are update_fields dot paths.
 */
export function formLocationMcpWarnings(raw: unknown): McpWarning[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (w): w is { code: string; message: string; fix_field_path?: string } =>
        !!w && typeof w === "object" && typeof (w as { message?: unknown }).message === "string",
    )
    .map((w) => ({
      code: w.code,
      message: w.fix_field_path ? `${w.message} Fix: ${w.fix_field_path}` : w.message,
    }));
}

/** `sections[2].data.content` → `sections.2.data.content` (update_fields field_path). */
export function toUpdateFieldPath(fieldPath: string): string {
  return fieldPath.replace(/\[(\d+)\]/g, ".$1");
}

function asBrokenLinks(raw: unknown): BrokenInternalLink[] {
  return Array.isArray(raw)
    ? raw.filter(
        (l): l is BrokenInternalLink =>
          !!l && typeof l === "object" && typeof (l as BrokenInternalLink).link === "string",
      )
    : [];
}

/** Non-blocking `link_warnings` from saves / promote (redirects, draft targets, not yet enforced). */
export function internalLinkWarnings(raw: unknown): McpWarning[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w): w is InternalLinkWarning => !!w && typeof w === "object" && typeof (w as InternalLinkWarning).message === "string")
    .map((w) => ({ code: w.code, message: w.message }));
}

export function isBrokenInternalLinksError(code: unknown): boolean {
  return code === BROKEN_INTERNAL_LINKS_CODE;
}

/** Save or publish blocked: the page links to URLs that do not resolve to a live page. */
export function brokenInternalLinksResult(
  errMsg: string,
  data: Record<string, unknown>,
  ctx?: { slug?: string; locale?: string; contentType?: string; variant?: string; publish?: boolean },
): McpTextResult {
  const details = data.details as Record<string, unknown> | undefined;
  const broken = asBrokenLinks(data.broken_internal_links ?? details?.broken_internal_links);
  const fieldPaths = [...new Set(broken.map((l) => toUpdateFieldPath(l.field_path)))];

  const next_actions: NextAction[] = [
    {
      tool: "update_fields",
      priority: "required",
      reason:
        "Rewrite each flagged field with every broken link replaced (use closest_live_match when it fits) or removed (keep the anchor text), then retry" +
        (ctx?.publish ? " publish." : " the save."),
      args_hint: {
        slug: ctx?.slug,
        locale: ctx?.locale ?? "en",
        contentType: ctx?.contentType,
        ...(ctx?.variant ? { variant: ctx.variant } : {}),
        ...(ctx?.publish || ctx?.variant ? {} : { confirm_live_edit: true }),
        updates: fieldPaths.map((field_path) => ({ field_path, value: "<full field value with the broken links fixed>" })),
      },
    },
    {
      tool: "get_entry_content",
      priority: "recommended",
      reason: "Read the current value of each flagged field before rewriting it.",
      args_hint: {
        slug: ctx?.slug,
        locale: ctx?.locale ?? "en",
        contentType: ctx?.contentType,
        ...(ctx?.variant ? { variant: ctx.variant } : {}),
      },
    },
  ];

  return actionRequired(
    {
      success: false,
      action_required: "fix_broken_internal_links",
      code: BROKEN_INTERNAL_LINKS_CODE,
      message: errMsg,
      broken_internal_links: broken,
      property_paths: fieldPaths,
      warnings: [
        {
          code: BROKEN_INTERNAL_LINKS_CODE,
          message:
            "Every internal link on the page is checked (markdown, <a href>, url/link/*_url fields, bare /en/ and /es/ paths), not only the field you edited; " +
            "an existing broken link elsewhere on the page also blocks. Live = same answer as Redirects → Test a URL. " +
            "Links to pages that are still drafts block on live saves and publish; draft saves only warn. " +
            "Links that redirect to a live page pass with a warning (link to the final URL). Never invent slugs: copy URLs from list/get tools.",
        },
      ],
    },
    next_actions,
  );
}
