/**
 * Accept any slug for tools that target an existing page.
 *
 * Before the handler runs, `slug` / `slugs` are resolved to the page ID (folder name) through the
 * main app's live content index (`GET /api/internal/content/resolve-entry`), so a Spanish address
 * or another spelling of the page works. A language slug also picks the language unless the caller
 * passed `locale`. Resolution facts are prepended to the tool's `warnings`.
 * Creation tools never resolve (see ENTRY_REF_TOOLS).
 */

import fs from "fs";
import path from "path";
import { z } from "zod";
import type { EntryRefWire } from "../../server/entry-ref.js";
import { getDirectory, loadContentTypes, resolveSiteContext } from "./content.js";
import { buildLoopbackHeaders } from "./loopback.js";
import { fail, type McpTextResult, type McpWarning } from "./respond.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const LOOKUP_TIMEOUT_MS = 3000;

/** Tools whose `slug` / `slugs` name an existing page. Not: create_entry, propose_change (server-side), product tools. */
export const ENTRY_REF_TOOLS: ReadonlySet<string> = new Set([
  "get_entry_content",
  "get_entry_seo",
  "get_entry_fields",
  "get_entry_activity",
  "get_section_bindings",
  "get_page_recipe",
  "review_page_render",
  "get_or_refresh_seo_research",
  "get_validation_issues",
  "list_variants",
  "update_fields",
  "update_entry_field",
  "update_entry_attributes",
  "create_variant",
  "publish_draft",
  "promote_variant",
  "delete_variant",
  "convert_to_draft",
  "add_section",
  "remove_section",
  "reorder_sections",
  "replace_entry_sections",
  "translate_entry",
  "set_entry_attachment",
  "list_entry_seo",
  "run_entry_diagnostics",
  "regenerate_entry_previews",
  "ensure_content_type_schema_org",
]);

const SHARED_SHELL_SLUGS = new Set(["template", "single"]);

export type EntryRefLookup = (q: {
  ref: string;
  contentType: string | null;
  locale?: string;
  localeExplicit: boolean;
  domain: string;
}) => Promise<EntryRefWire | null>;

/** Loopback to the main app. Null when it cannot answer (MCP running without the app). */
export const loopbackEntryRefLookup: EntryRefLookup = async (q) => {
  const params = new URLSearchParams({ ref: q.ref, __site: q.domain });
  if (q.contentType) params.set("contentType", q.contentType);
  if (q.locale) params.set("locale", q.locale);
  if (q.localeExplicit) params.set("locale_explicit", "1");
  try {
    const res = await fetch(`http://127.0.0.1:${MAIN_SERVER_PORT}/api/internal/content/resolve-entry?${params}`, {
      headers: buildLoopbackHeaders(undefined, { omitJsonContentType: true }),
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as EntryRefWire;
    return data && typeof data.ok === "boolean" ? data : null;
  } catch {
    return null;
  }
};

let lookupImpl: EntryRefLookup = loopbackEntryRefLookup;

/** @internal Tests: swap the lookup (pass null to restore loopback). */
export function setEntryRefLookupForTest(fn: EntryRefLookup | null): void {
  lookupImpl = fn ?? loopbackEntryRefLookup;
}

const dirNamesCache = new Map<string, { mtimeMs: number; names: Set<string> }>();

/** Exact-case folder names (macOS `existsSync` ignores case; Linux does not). */
function folderNames(dir: string): Set<string> {
  try {
    const mtimeMs = fs.statSync(dir).mtimeMs;
    const hit = dirNamesCache.get(dir);
    if (hit && hit.mtimeMs === mtimeMs) return hit.names;
    const names = new Set(
      fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name),
    );
    dirNamesCache.set(dir, { mtimeMs, names });
    return names;
  } catch {
    return new Set();
  }
}

/** True when `slug` is already an exact entry folder name of the given type, or of any type when none is given. */
function isExactPageId(contentPath: string, slug: string, contentType: string | null): boolean {
  const configs = loadContentTypes(contentPath);
  const types = contentType ? [contentType] : Object.keys(configs);
  return types.some((ct) => {
    const config = configs[ct];
    return Boolean(config) && folderNames(path.join(contentPath, getDirectory(ct, config!))).has(slug);
  });
}

type Resolved = { slug: string; contentType?: string; locale?: string; warnings: McpWarning[] };

async function resolveOne(opts: {
  slug: string;
  contentType: string | null;
  locale?: string;
  localeExplicit: boolean;
  contentPath: string;
  domain: string;
}): Promise<{ ok: true; value: Resolved } | { ok: false; result: McpTextResult }> {
  const { slug, contentType } = opts;
  if (!slug || SHARED_SHELL_SLUGS.has(slug) || isExactPageId(opts.contentPath, slug, contentType)) {
    return { ok: true, value: { slug, warnings: [] } };
  }
  const wire = await lookupImpl({
    ref: slug,
    contentType,
    locale: opts.locale,
    localeExplicit: opts.localeExplicit,
    domain: opts.domain,
  });
  if (!wire) return { ok: true, value: { slug, warnings: [] } };
  if (wire.ok) {
    return {
      ok: true,
      value: {
        slug: wire.entry_id,
        contentType: wire.contentType,
        ...(wire.locale ? { locale: wire.locale } : {}),
        warnings: wire.warnings.map((w) => ({ code: w.code, message: w.message, ...w.details })),
      },
    };
  }
  if (wire.reason === "not_found") return { ok: true, value: { slug, warnings: [] } };
  return {
    ok: false,
    result: fail(wire.message, {
      code: wire.reason === "ambiguous" ? "ambiguous_slug" : "index_updating",
      slug,
      ...(wire.candidates ? { candidates: wire.candidates } : {}),
      warnings: [],
      next_actions:
        wire.reason === "ambiguous"
          ? [{ tool: "list_entries", reason: "Find the exact page ID (entry_id) for this page", args_hint: { search: slug } }]
          : [],
    }),
  };
}

/**
 * Rewrite tool args so `slug` / `slugs` hold page IDs. `localeExplicit` must reflect the raw call
 * (before any schema default).
 */
export async function canonicalizeEntryArgs(
  args: Record<string, unknown>,
  opts: { localeExplicit: boolean; hasContentTypeArg: boolean; hasLocaleArg: boolean },
): Promise<{ ok: true; args: Record<string, unknown>; warnings: McpWarning[] } | { ok: false; result: McpTextResult }> {
  const site = resolveSiteContext(typeof args.site === "string" ? args.site : undefined);
  if (!site.ok) return { ok: true, args, warnings: [] };
  const rawType = typeof args.contentType === "string" ? args.contentType : args.content_type;
  const contentType = typeof rawType === "string" && rawType.trim() ? rawType.trim() : null;
  const locale = typeof args.locale === "string" && args.locale.trim() ? args.locale.trim() : undefined;
  const next = { ...args };
  const warnings: McpWarning[] = [];
  const base = { contentPath: site.contentPath, domain: site.domain };

  if (typeof args.slug === "string") {
    const r = await resolveOne({ ...base, slug: args.slug, contentType, locale, localeExplicit: opts.localeExplicit });
    if (!r.ok) return r;
    next.slug = r.value.slug;
    if (opts.hasContentTypeArg && !contentType && r.value.contentType) next.contentType = r.value.contentType;
    if (opts.hasLocaleArg && r.value.locale) next.locale = r.value.locale;
    warnings.push(...r.value.warnings);
  }

  if (Array.isArray(args.slugs)) {
    const out: unknown[] = [];
    for (const s of args.slugs) {
      if (typeof s !== "string") {
        out.push(s);
        continue;
      }
      // Shared locale for the batch: never infer it from one slug.
      const r = await resolveOne({ ...base, slug: s, contentType, locale, localeExplicit: true });
      if (!r.ok) return r;
      out.push(r.value.slug);
      warnings.push(...r.value.warnings.filter((w) => w.code === "slug_resolved"));
    }
    next.slugs = out;
  }

  return { ok: true, args: next, warnings };
}

/** Prepend resolution warnings to a JSON tool result (non-JSON results are returned unchanged). */
export function attachEntryRefWarnings(result: unknown, warnings: McpWarning[]): unknown {
  if (warnings.length === 0) return result;
  const r = result as { content?: Array<{ type?: string; text?: string }> } | null;
  const first = r?.content?.[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") return result;
  let body: unknown;
  try {
    body = JSON.parse(first.text);
  } catch {
    return result;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return result;
  const obj = body as Record<string, unknown>;
  const existing = Array.isArray(obj.warnings) ? obj.warnings : [];
  const text = JSON.stringify({ ...obj, warnings: [...warnings, ...existing] }, null, 2);
  return { ...r, content: [{ ...first, text }, ...(r!.content!.slice(1) ?? [])] };
}

/**
 * Wrap a tool registration (`[description, shape, handler]`) so the handler sees page IDs.
 * A `locale` with a schema default becomes optional so an omitted locale can follow the slug's language;
 * the default is re-applied after resolution.
 */
export function wrapEntryRefTool(rest: unknown[]): unknown[] {
  const handlerIdx = rest.length - 1;
  const handler = rest[handlerIdx];
  const shapeIdx = rest.findIndex((x, i) => i < handlerIdx && x && typeof x === "object" && !Array.isArray(x));
  if (typeof handler !== "function" || shapeIdx < 0) return rest;
  const shape = { ...(rest[shapeIdx] as Record<string, z.ZodTypeAny>) };
  if (!("slug" in shape) && !("slugs" in shape)) return rest;

  let localeDefault: (() => unknown) | null = null;
  const localeSchema = shape.locale;
  if (localeSchema instanceof z.ZodDefault) {
    const def = localeSchema._def as { defaultValue: () => unknown; innerType: z.ZodTypeAny };
    localeDefault = def.defaultValue;
    shape.locale = def.innerType.optional().describe(localeSchema.description ?? "");
  }
  const hasLocaleArg = "locale" in shape;
  const hasContentTypeArg = "contentType" in shape;

  const wrapped = async (...callArgs: unknown[]) => {
    const raw = (callArgs[0] && typeof callArgs[0] === "object" ? callArgs[0] : {}) as Record<string, unknown>;
    const localeExplicit = typeof raw.locale === "string" && raw.locale.trim() !== "";
    const res = await canonicalizeEntryArgs(raw, { localeExplicit, hasContentTypeArg, hasLocaleArg });
    if (!res.ok) return res.result;
    const args = res.args;
    if (localeDefault && (args.locale === undefined || args.locale === "")) args.locale = localeDefault();
    const out = await (handler as (...a: unknown[]) => unknown)(args, ...callArgs.slice(1));
    return attachEntryRefWarnings(out, res.warnings);
  };

  const next = [...rest];
  next[shapeIdx] = shape;
  next[handlerIdx] = wrapped;
  return next;
}
