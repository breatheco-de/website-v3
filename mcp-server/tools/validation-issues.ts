import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkCap, denyResponse } from "../lib/auth.js";
import { hasCapAnyScope, type CatalogGrant } from "../lib/tool-catalog.js";
import { ok } from "../lib/respond.js";
import { resolveSiteContext, resolveContentType, loadPage, safeLoad, getDirectory } from "../lib/content.js";
import { getTokenUsername } from "../lib/oauth.js";
import { SITE_PARAM_DESC, siteFailResult } from "../lib/entry-helpers.js";
import fs from "fs";
import path from "path";
import {
  clampIssuesLimit,
  clampIssuesOffset,
  isValidationIssuesScoped,
  issuesNextOffset,
  openStatsFromCacheTotals,
  paginateRows,
  resolvedStatsFromArchiveSummary,
  type ValidationIssuesArgs,
} from "../lib/validation-issues-mcp.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const INTERNAL_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

function internalHeaders(mcpToken?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (INTERNAL_SECRET) {
    headers.Authorization = `Bearer ${INTERNAL_SECRET}`;
    const username = mcpToken ? getTokenUsername(mcpToken) : undefined;
    if (username) headers["x-mcp-author"] = username;
  } else if (mcpToken) {
    const username = getTokenUsername(mcpToken);
    if (username) headers["x-mcp-author"] = username;
  }
  return headers;
}

function siteQuery(domain: string | null, extra = ""): string {
  const parts: string[] = [];
  if (domain) parts.push(`__site=${encodeURIComponent(domain)}`);
  if (extra) parts.push(extra);
  return parts.length ? `?${parts.join("&")}` : "";
}

async function requireMetricsView(mcpToken: string | undefined, grants: CatalogGrant[] | undefined) {
  if (!mcpToken) return null;
  if (grants && hasCapAnyScope(grants, "metrics_view")) return null;
  if (await checkCap(mcpToken, "metrics_view")) return null;
  return denyResponse("metrics_view");
}

/** Resolve public URL for slug/locale when possible. */
function resolveSlugUrl(
  slug: string,
  locale: string,
  contentType: string | undefined,
  contentPath: string,
): { url?: string; error?: string } {
  const resolved = resolveContentType(slug, contentType, contentPath);
  if (!resolved) {
    return { error: `Page not found for slug '${slug}'` };
  }
  const result = loadPage(resolved.contentType, slug, locale, contentPath);
  if (!result) {
    return { error: `Locale '${locale}' not found for page '${slug}'` };
  }
  const urlPattern = resolved.config.url_pattern;
  if (!urlPattern) return {};
  let localeSlug = slug;
  const pageDir = path.join(contentPath, getDirectory(resolved.contentType, resolved.config), slug);
  for (const ext of ["yml", "yaml"]) {
    const localeFile = path.join(pageDir, `${locale}.${ext}`);
    if (!fs.existsSync(localeFile)) continue;
    try {
      const parsed = safeLoad(fs.readFileSync(localeFile, "utf-8"));
      const candidate = parsed?.slug;
      if (typeof candidate === "string" && candidate.trim()) localeSlug = candidate.trim();
    } catch {
      // folder slug fallback
    }
    break;
  }
  const pattern = urlPattern[locale] || urlPattern["default"];
  if (typeof pattern !== "string") return {};
  return { url: pattern.replace(":slug", localeSlug) };
}

function mapOpenIssue(row: Record<string, unknown>) {
  return {
    id: row.id,
    url: row.url,
    code: row.code,
    message: row.message,
    severity: row.severity,
    validator: row.validator,
    category: row.category,
    suggestion: row.suggestion,
    file: row.file,
  };
}

export function registerValidationIssuesTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "get_validation_issues",
    "Metrics Viewer read of validation health (does NOT run diagnostics). " +
      "Always returns open_stats (truly open cache issues — not soft-completed) and resolved_stats " +
      "(last ~60 days archive KPI). " +
      "To load issue rows, pass a scope filter (slug, url, code, validator, category, or search) AND set: " +
      "'open' | 'resolved' (required — no default). Paginate with limit (default 20, max 200) and offset. " +
      "Content agents fixing pages should use run_entry_diagnostics instead. Requires metrics_view.",
    {
      slug: z.string().optional().describe("Entry folder slug — resolves to URL for filtering"),
      locale: z.string().optional().describe("Locale when using slug (default en)"),
      contentType: z.string().optional().describe("Content type hint when resolving slug"),
      url: z.string().optional().describe("Exact or path URL filter"),
      code: z.string().optional(),
      validator: z.string().optional(),
      category: z.string().optional(),
      search: z.string().optional(),
      set: z.enum(["open", "resolved"]).optional().describe("Required with any scope filter to return issues[]"),
      limit: z.number().optional(),
      offset: z.number().optional(),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async (rawArgs) => {
      const denied = await requireMetricsView(mcpToken, grants);
      if (denied) return denied;
      const siteResult = resolveSiteContext(rawArgs.site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain, contentPath } = siteResult;

      const args: ValidationIssuesArgs = {
        slug: rawArgs.slug,
        locale: rawArgs.locale,
        contentType: rawArgs.contentType,
        url: rawArgs.url,
        code: rawArgs.code,
        validator: rawArgs.validator,
        category: rawArgs.category,
        search: rawArgs.search,
        set: rawArgs.set,
        limit: rawArgs.limit,
        offset: rawArgs.offset,
      };

      const warnings: Array<{ code: string; message: string }> = [];
      const scoped = isValidationIssuesScoped(args);
      const limit = clampIssuesLimit(args.limit);
      const offset = clampIssuesOffset(args.offset);

      if (!scoped && (args.limit != null || args.offset != null || args.set)) {
        warnings.push({
          code: "issues_need_filter",
          message:
            "limit/offset/set without a scope filter (slug, url, code, validator, category, search) are ignored. Stats only.",
        });
      }

      let filterUrl = args.url?.trim() || undefined;
      if (args.slug?.trim()) {
        const resolved = resolveSlugUrl(
          args.slug.trim(),
          (args.locale || "en").trim(),
          args.contentType,
          contentPath,
        );
        if (resolved.error) {
          warnings.push({ code: "slug_unresolved", message: resolved.error });
        } else if (resolved.url) {
          filterUrl = filterUrl || resolved.url;
        } else if (!filterUrl) {
          warnings.push({
            code: "slug_unresolved",
            message: `Could not resolve a public URL for slug '${args.slug}' — pass url= explicitly.`,
          });
        }
      }

      const headers = internalHeaders(mcpToken);
      const q = siteQuery(domain);

      let open_stats = { errors: 0, warnings: 0, total: 0 };
      let resolved_stats = resolvedStatsFromArchiveSummary({});

      try {
        const openRes = await fetch(
          `http://localhost:${MAIN_SERVER_PORT}/api/validation/cache-issues${q}`,
          { headers },
        );
        if (openRes.ok) {
          const openData = (await openRes.json()) as { totals?: Record<string, number> };
          open_stats = openStatsFromCacheTotals(openData.totals ?? {});
        } else {
          warnings.push({
            code: "open_stats_unavailable",
            message: `Could not load open issue stats (${openRes.status}).`,
          });
        }
      } catch (e) {
        warnings.push({
          code: "open_stats_unavailable",
          message: (e as Error).message,
        });
      }

      try {
        const resolvedRes = await fetch(
          `http://localhost:${MAIN_SERVER_PORT}/api/validation/resolved-issues${q}${q ? "&" : "?"}limit=1`,
          { headers },
        );
        if (resolvedRes.ok) {
          const resolvedData = (await resolvedRes.json()) as { summary?: Record<string, number> };
          resolved_stats = resolvedStatsFromArchiveSummary(resolvedData.summary ?? {});
        } else {
          warnings.push({
            code: "resolved_stats_unavailable",
            message: `Could not load resolved archive stats (${resolvedRes.status}).`,
          });
        }
      } catch (e) {
        warnings.push({
          code: "resolved_stats_unavailable",
          message: (e as Error).message,
        });
      }

      if (!scoped) {
        return ok({ open_stats, resolved_stats }, { warnings });
      }

      if (args.set !== "open" && args.set !== "resolved") {
        warnings.push({
          code: "set_required",
          message:
            "Scope filters require set: 'open' or 'resolved' to return issues[]. Stats returned without rows.",
        });
        return ok({ open_stats, resolved_stats }, { warnings });
      }

      if (args.set === "resolved") {
        const qs = new URLSearchParams();
        qs.set("limit", String(limit));
        qs.set("offset", String(offset));
        if (filterUrl) qs.set("url", filterUrl);
        if (args.code?.trim()) qs.set("code", args.code.trim());
        if (args.validator?.trim()) qs.set("validator", args.validator.trim());
        if (args.category?.trim()) qs.set("category", args.category.trim());
        if (args.search?.trim()) qs.set("search", args.search.trim());
        const sep = q ? `${q}&` : "?";
        try {
          const res = await fetch(
            `http://localhost:${MAIN_SERVER_PORT}/api/validation/resolved-issues${sep}${qs.toString()}`,
            { headers },
          );
          if (!res.ok) {
            warnings.push({
              code: "resolved_rows_unavailable",
              message: `Could not load resolved rows (${res.status}).`,
            });
            return ok({ open_stats, resolved_stats, set: "resolved" }, { warnings });
          }
          const data = (await res.json()) as {
            rows?: unknown[];
            total?: number;
          };
          const issues = data.rows ?? [];
          const total = typeof data.total === "number" ? data.total : issues.length;
          return ok(
            {
              open_stats,
              resolved_stats,
              set: "resolved",
              issues,
              total,
              limit,
              offset,
              next_offset: issuesNextOffset(offset, limit, total, issues.length),
            },
            { warnings },
          );
        } catch (e) {
          warnings.push({ code: "resolved_rows_unavailable", message: (e as Error).message });
          return ok({ open_stats, resolved_stats, set: "resolved" }, { warnings });
        }
      }

      // set === "open"
      const qs = new URLSearchParams();
      if (filterUrl) qs.set("url", filterUrl);
      else if (args.slug?.trim() && !filterUrl) qs.set("path", args.slug.trim());
      if (args.code?.trim()) qs.set("code", args.code.trim());
      if (args.validator?.trim()) qs.set("validator", args.validator.trim());
      if (args.category?.trim()) qs.set("category", args.category.trim());
      if (args.search?.trim()) qs.set("search", args.search.trim());
      const extra = qs.toString();
      const sep = q ? (extra ? `${q}&${extra}` : q) : extra ? `?${extra}` : "";
      try {
        const res = await fetch(
          `http://localhost:${MAIN_SERVER_PORT}/api/validation/cache-issues${sep}`,
          { headers },
        );
        if (!res.ok) {
          warnings.push({
            code: "open_rows_unavailable",
            message: `Could not load open rows (${res.status}).`,
          });
          return ok({ open_stats, resolved_stats, set: "open" }, { warnings });
        }
        const data = (await res.json()) as {
          issues?: Record<string, unknown>[];
          totals?: { filtered?: number; errors?: number; warnings?: number };
        };
        const all = (data.issues ?? []).map(mapOpenIssue);
        const total = all.length;
        const page = paginateRows(all, offset, limit);
        return ok(
          {
            open_stats,
            resolved_stats,
            set: "open",
            issues: page,
            total,
            limit,
            offset,
            next_offset: issuesNextOffset(offset, limit, total, page.length),
          },
          { warnings },
        );
      } catch (e) {
        warnings.push({ code: "open_rows_unavailable", message: (e as Error).message });
        return ok({ open_stats, resolved_stats, set: "open" }, { warnings });
      }
    },
  );
}
