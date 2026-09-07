/**
 * MCP tools for private database item read + local YAML CRUD (FAQ bank and others).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkCap, denyResponse } from "../lib/auth.js";
import { ok, fail, actionRequired, type McpWarning, type NextAction } from "../lib/respond.js";
import { loadContentTypes, resolveSiteContext } from "../lib/content.js";
import { getTokenUsername } from "../lib/oauth.js";
import {
  FAQ_DB_NAME,
  applyFaqDefaults,
  findFaqDuplicateIndex,
  filterIndexedItems,
  paginateItems,
  prepareBatchAdd,
  prepareBatchUpdate,
  abortRemainingPatches,
  summarizeUsage,
  summarizeDatabaseItem,
  databaseReadWarnings,
  resolveContentTypesForDatabase,
  nonLocalMutateFailDetails,
  validateBulkLength,
  validateFaqItem,
  withGlobalIndices,
  type BatchRowResult,
} from "../lib/database-items.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const INTERNAL_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

const REFRESH_ARG_DESC =
  "Force rebuild the database cache before reading. Expensive for api/remote sources (hits the external API). Use sparingly when stale cache is blocking; prefer the default TTL cache. Ignored when page > 1 on list (refresh on page 1 only).";

function internalHeaders(mcpToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
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

function siteQuery(domain: string | null): string {
  return domain ? `?__site=${encodeURIComponent(domain)}` : "";
}

function siteQueryJoin(domain: string | null, extra: string): string {
  if (domain) return `?__site=${encodeURIComponent(domain)}&${extra}`;
  return extra ? `?${extra}` : "";
}

async function requireItemCap(mcpToken?: string) {
  if (!mcpToken) return null;
  const allowed =
    (await checkCap(mcpToken, "databases_manage")) ||
    (await checkCap(mcpToken, "content_edit_text"));
  if (!allowed) {
    return denyResponse("databases_manage|content_edit_text");
  }
  return null;
}

async function requireReindexCap(mcpToken?: string) {
  if (!mcpToken) return null;
  if (!(await checkCap(mcpToken, "databases_manage"))) {
    return denyResponse("databases_manage");
  }
  return null;
}

type DbConfigResponse = {
  name: string;
  config: {
    name?: string;
    source?: { type?: string; local?: { filename?: string; results_path?: string } };
    vector_search?: { enabled?: boolean; fields?: string[] };
    field_mapping?: Record<string, string>;
  };
};

async function fetchDbConfig(
  dbName: string,
  domain: string | null,
  mcpToken?: string,
): Promise<{ ok: true; data: DbConfigResponse } | { ok: false; message: string }> {
  const url = `http://localhost:${MAIN_SERVER_PORT}/api/databases/${encodeURIComponent(dbName)}${siteQuery(domain)}`;
  const res = await fetch(url, { headers: internalHeaders(mcpToken) });
  const data = (await res.json()) as DbConfigResponse & { error?: string };
  if (!res.ok) {
    return { ok: false, message: data.error || `Server error: ${res.status}` };
  }
  return { ok: true, data };
}

function assertLocal(
  config: DbConfigResponse["config"],
  dbName: string,
): { ok: true; filename: string } | { ok: false; message: string } {
  if (config.source?.type !== "local") {
    return {
      ok: false,
      message: `Database "${dbName}" is not local (source.type=${config.source?.type ?? "unknown"}). MCP item CRUD only supports local YAML databases.`,
    };
  }
  const filename = config.source.local?.filename;
  if (!filename) {
    return { ok: false, message: `Database "${dbName}" is local but missing source.local.filename` };
  }
  return { ok: true, filename };
}

function itemFileForConfig(
  dbName: string,
  config: DbConfigResponse["config"],
): string | null {
  if (config.source?.type !== "local") return null;
  const filename = config.source.local?.filename;
  return filename ? `db/${dbName}/${filename}` : null;
}

async function forceRefreshDatabase(
  dbName: string,
  domain: string | null,
  mcpToken?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const url = `http://localhost:${MAIN_SERVER_PORT}/api/databases/${encodeURIComponent(dbName)}/refresh${siteQuery(domain)}`;
  const res = await fetch(url, { method: "POST", headers: internalHeaders(mcpToken) });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, message: data.error || `Refresh failed: ${res.status}` };
  }
  return { ok: true };
}

async function fetchAllItems(
  dbName: string,
  domain: string | null,
  mcpToken?: string,
): Promise<{ ok: true; items: Record<string, unknown>[] } | { ok: false; message: string }> {
  // High limit so we can stamp global indices correctly before filtering.
  const url = `http://localhost:${MAIN_SERVER_PORT}/api/databases/${encodeURIComponent(dbName)}/items${siteQueryJoin(domain, "limit=1000&page=1")}`;
  const res = await fetch(url, { headers: internalHeaders(mcpToken) });
  const data = (await res.json()) as {
    items?: Record<string, unknown>[];
    total_count?: number;
    error?: string;
  };
  if (!res.ok) {
    return { ok: false, message: data.error || `Server error: ${res.status}` };
  }
  let items = data.items ?? [];
  const total = data.total_count ?? items.length;
  if (total > items.length) {
    // Paginate remaining pages if needed
    const pages = Math.ceil(total / 1000);
    for (let page = 2; page <= pages; page++) {
      const pageUrl = `http://localhost:${MAIN_SERVER_PORT}/api/databases/${encodeURIComponent(dbName)}/items${siteQueryJoin(domain, `limit=1000&page=${page}`)}`;
      const pageRes = await fetch(pageUrl, { headers: internalHeaders(mcpToken) });
      const pageData = (await pageRes.json()) as { items?: Record<string, unknown>[]; error?: string };
      if (!pageRes.ok) {
        return { ok: false, message: pageData.error || `Server error: ${pageRes.status}` };
      }
      items = items.concat(pageData.items ?? []);
    }
  }
  return { ok: true, items };
}

/** Resolve refresh intent: ignore on page>1; soft-fail refresh then still read items. */
async function prepareDatabaseRead(opts: {
  database: string;
  domain: string | null;
  mcpToken?: string;
  refresh?: boolean;
  page?: number;
}): Promise<
  | {
      ok: true;
      items: Record<string, unknown>[];
      refreshed: boolean;
      refreshFailed: boolean;
      refreshIgnoredPagination: boolean;
    }
  | { ok: false; message: string }
> {
  const page = opts.page ?? 1;
  let refreshIgnoredPagination = false;
  let refreshed = false;
  let refreshFailed = false;

  const wantRefresh = opts.refresh === true;
  if (wantRefresh && page > 1) {
    refreshIgnoredPagination = true;
  } else if (wantRefresh) {
    const fr = await forceRefreshDatabase(opts.database, opts.domain, opts.mcpToken);
    if (fr.ok) {
      refreshed = true;
    } else {
      refreshFailed = true;
    }
  }

  const all = await fetchAllItems(opts.database, opts.domain, opts.mcpToken);
  if (!all.ok) {
    if (refreshFailed) {
      return {
        ok: false,
        message: `Forced refresh failed and items could not be read: ${all.message}`,
      };
    }
    return { ok: false, message: all.message };
  }

  return {
    ok: true,
    items: all.items,
    refreshed,
    refreshFailed,
    refreshIgnoredPagination,
  };
}

async function failNonLocalMutate(opts: {
  database: string;
  config: DbConfigResponse["config"];
  contentPath: string;
  site?: string | null;
  domain: string | null;
  mcpToken?: string;
  index?: number;
}): Promise<ReturnType<typeof fail>> {
  const configs = loadContentTypes(opts.contentPath);
  const contentTypes = resolveContentTypesForDatabase(opts.database, configs);
  let slug: string | null = null;
  if (opts.index !== undefined && contentTypes.length > 0) {
    const all = await fetchAllItems(opts.database, opts.domain, opts.mcpToken);
    if (all.ok && all.items[opts.index]) {
      const raw = all.items[opts.index].slug;
      slug = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    }
  }
  const details = nonLocalMutateFailDetails({
    database: opts.database,
    sourceType: opts.config.source?.type,
    contentTypes,
    slug,
    site: opts.site,
  });
  return fail(
    `Database "${opts.database}" is not local (source.type=${opts.config.source?.type ?? "unknown"}). MCP cannot edit upstream api/remote rows — use field overrides when a content type links this database.`,
    details,
  );
}

function syncWarnings(relPath: string): McpWarning[] {
  return [
    {
      code: "global_index",
      message:
        "Item index is the position in the full unfiltered YAML array (all locales). Filtered lists keep that global index — do not treat list position as the mutate index.",
    },
    {
      code: "content_sync_not_pushed",
      message: `Write dirties ${relPath} for content GitHub sync; this tool does not push or commit.`,
    },
    {
      code: "no_section_auto_wire",
      message:
        "Does not update page sections, hardcoded_entries, or dynamic_entries. Sections pull from the bank via Topics/Locations/search.",
    },
  ];
}

function reindexNextActions(dbName: string, vectorEnabled: boolean): NextAction[] {
  if (!vectorEnabled) return [];
  return [
    {
      tool: "reindex_database",
      reason: "Semantic index is stale after item writes until reindex runs",
      args_hint: { database: dbName },
      priority: "recommended",
    },
  ];
}

async function maybeReindex(
  dbName: string,
  domain: string | null,
  mcpToken: string | undefined,
  reindex: boolean | undefined,
  vectorEnabled: boolean,
): Promise<{ did: boolean; warning?: McpWarning }> {
  if (!reindex || !vectorEnabled) return { did: false };
  if (mcpToken && !(await checkCap(mcpToken, "databases_manage"))) {
    return {
      did: false,
      warning: {
        code: "reindex_cap_denied",
        message:
          "reindex:true requested but capability databases_manage is missing; call reindex_database with that cap, or ask staff to reindex.",
      },
    };
  }
  const url = `http://localhost:${MAIN_SERVER_PORT}/api/databases/${encodeURIComponent(dbName)}/reindex${siteQuery(domain)}`;
  const res = await fetch(url, { method: "POST", headers: internalHeaders(mcpToken) });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      did: false,
      warning: {
        code: "reindex_failed",
        message: data.error || `Reindex failed with status ${res.status}`,
      },
    };
  }
  return { did: true };
}

const itemSchema = z.record(z.string(), z.unknown());

export function registerDatabaseTools(mcp: McpServer, mcpToken?: string): void {
  mcp.tool(
    "list_databases",
    "List private databases for a site. Includes source_type and whether item CRUD is allowed (local only). Call explain_site topic local_databases first if unsure.",
    {
      site: z
        .string()
        .optional()
        .describe("Site domain when multi-site. Pass site when multiple sites are configured; call list_sites if unsure."),
      local_only: z
        .boolean()
        .optional()
        .describe("If true, only return source.type=local databases (MCP CRUD targets)."),
    },
    async ({ site, local_only }) => {
      const denied = await requireItemCap(mcpToken);
      if (denied) return denied;

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;

      try {
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/databases${siteQuery(domain)}`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const data = (await res.json()) as Array<Record<string, unknown>> | { error?: string };
        if (!res.ok || !Array.isArray(data)) {
          return fail(
            (!Array.isArray(data) && data.error) || `Server error: ${res.status}`,
          );
        }

        const enriched = [];
        for (const row of data) {
          const name = String(row.name ?? "");
          if (!name) continue;
          const cfg = await fetchDbConfig(name, domain, mcpToken);
          const sourceType = cfg.ok
            ? cfg.data.config.source?.type
            : (row.source_type as string | undefined);
          const local = sourceType === "local";
          if (local_only && !local) continue;
          const vs = cfg.ok ? cfg.data.config.vector_search : undefined;
          const filename = cfg.ok ? cfg.data.config.source?.local?.filename : undefined;
          enriched.push({
            name,
            label: (row.label as string | undefined) ?? (cfg.ok ? cfg.data.config.name : undefined) ?? name,
            source_type: sourceType ?? row.source_type ?? null,
            local,
            vector_search_enabled: vs?.enabled === true,
            item_file: local && filename ? `db/${name}/${filename}` : null,
            cache_item_count: row.cache_item_count ?? null,
          });
        }

        return ok(
          {
            message: `Found ${enriched.length} database(s)`,
            databases: enriched,
          },
          {
            warnings: [
              {
                code: "local_crud_only",
                message: "Item add/update/delete only works when local=true.",
              },
            ],
            next_actions: [],
          },
        );
      } catch (e) {
        return fail(`list_databases failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "list_database_items",
    "List private database items (local, api, or remote). Returns summary rows (not full bodies) with global `index`. " +
      "Use get_database_item for a full row. Mutate tools only work for local YAML. " +
      "Optional refresh:true rebuilds cache (expensive for api/remote; ignored when page>1). FAQ: filter by locale recommended.",
    {
      database: z.string().describe("Database slug, e.g. frequently_asked_questions or interactive-exercises"),
      page: z.number().int().positive().optional().describe("Page number (default 1)"),
      limit: z.number().int().positive().max(1000).optional().describe("Page size (default 50)"),
      locale: z.string().optional().describe("Filter item.locale (does not change index)"),
      filter: z
        .record(z.string(), z.union([z.string(), z.array(z.string())]))
        .optional()
        .describe("Extra field filters (OR within field, AND across fields)"),
      refresh: z.boolean().optional().describe(REFRESH_ARG_DESC),
      site: z.string().optional(),
    },
    async ({ database, page, limit, locale, filter, refresh, site }) => {
      const denied = await requireItemCap(mcpToken);
      if (denied) return denied;

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;
      const pageNum = page ?? 1;

      try {
        const cfg = await fetchDbConfig(database, domain, mcpToken);
        if (!cfg.ok) return fail(cfg.message);
        const sourceType = cfg.data.config.source?.type ?? null;
        const local = sourceType === "local";

        const prepared = await prepareDatabaseRead({
          database,
          domain,
          mcpToken,
          refresh,
          page: pageNum,
        });
        if (!prepared.ok) return fail(prepared.message);

        const indexed = withGlobalIndices(prepared.items);
        const filters: Record<string, string | string[]> = { ...(filter ?? {}) };
        if (locale) filters.locale = locale;
        const filtered = filterIndexedItems(indexed, filters);
        const pageResult = paginateItems(filtered, pageNum, limit ?? 50);
        const summaryItems = pageResult.items.map((row) => summarizeDatabaseItem(row));

        return ok(
          {
            message: `Listed ${summaryItems.length} of ${pageResult.total_count} item(s) (summary; global index preserved)`,
            database,
            source_type: sourceType,
            local,
            item_file: itemFileForConfig(database, cfg.data.config),
            summary: true,
            items: summaryItems,
            page: pageResult.page,
            limit: pageResult.limit,
            total_count: pageResult.total_count,
          },
          {
            warnings: databaseReadWarnings({
              sourceType,
              refreshed: prepared.refreshed,
              refreshFailed: prepared.refreshFailed,
              refreshIgnoredPagination: prepared.refreshIgnoredPagination,
            }),
            next_actions: [],
          },
        );
      } catch (e) {
        return fail(`list_database_items failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "get_database_item",
    "Get one private database item (full row) by global index. Works for local, api, and remote caches. " +
      "Mutate only for local YAML — for api/remote use update_entry_field overrides when a content type links the DB. " +
      "Optional refresh:true rebuilds cache (expensive).",
    {
      database: z.string(),
      index: z.number().int().min(0).describe("Global array index"),
      refresh: z.boolean().optional().describe(REFRESH_ARG_DESC),
      site: z.string().optional(),
    },
    async ({ database, index, refresh, site }) => {
      const denied = await requireItemCap(mcpToken);
      if (denied) return denied;

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;

      try {
        const cfg = await fetchDbConfig(database, domain, mcpToken);
        if (!cfg.ok) return fail(cfg.message);
        const sourceType = cfg.data.config.source?.type ?? null;
        const local = sourceType === "local";

        const prepared = await prepareDatabaseRead({
          database,
          domain,
          mcpToken,
          refresh,
          page: 1,
        });
        if (!prepared.ok) return fail(prepared.message);
        if (index < 0 || index >= prepared.items.length) {
          return fail(`Item at index ${index} not found (length=${prepared.items.length})`);
        }

        return ok(
          {
            message: `Item ${index} from ${database}`,
            database,
            source_type: sourceType,
            local,
            index,
            item: prepared.items[index],
            item_file: itemFileForConfig(database, cfg.data.config),
          },
          {
            warnings: databaseReadWarnings({
              sourceType,
              refreshed: prepared.refreshed,
              refreshFailed: prepared.refreshFailed,
              refreshIgnoredPagination: false,
            }),
            next_actions: [],
          },
        );
      } catch (e) {
        return fail(`get_database_item failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "add_database_item",
    "Append one item to a local database YAML. FAQ requires question, answer, locale; fills last_updated/priority/locations defaults; rejects duplicate (locale, question). Does not push content sync. Set reindex:true to reindex after write if you have databases_manage.",
    {
      database: z.string(),
      item: itemSchema.describe("Item fields to append"),
      reindex: z.boolean().optional().describe("If true and vector_search enabled, reindex after write (needs databases_manage)"),
      site: z.string().optional(),
    },
    async ({ database, item, reindex, site }) => {
      const denied = await requireItemCap(mcpToken);
      if (denied) return denied;

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;

      try {
        const cfg = await fetchDbConfig(database, domain, mcpToken);
        if (!cfg.ok) return fail(cfg.message);
        const local = assertLocal(cfg.data.config, database);
        if (!local.ok) {
          return failNonLocalMutate({
            database,
            config: cfg.data.config,
            contentPath: siteResult.contentPath,
            site,
            domain,
            mcpToken,
          });
        }

        let toWrite: Record<string, unknown> = { ...item };
        const warnings: McpWarning[] = [...syncWarnings(`db/${database}/${local.filename}`)];
        const vectorEnabled = cfg.data.config.vector_search?.enabled === true;

        if (database === FAQ_DB_NAME) {
          const v = validateFaqItem(toWrite);
          if (!v.ok) return fail(v.message);
          toWrite = applyFaqDefaults(toWrite);
          const all = await fetchAllItems(database, domain, mcpToken);
          if (!all.ok) return fail(all.message);
          const dup = findFaqDuplicateIndex(
            all.items,
            String(toWrite.locale),
            String(toWrite.question),
          );
          if (dup >= 0) {
            return fail(
              `Duplicate FAQ for locale="${toWrite.locale}" question (normalized) already exists at global index ${dup}`,
              { existing_index: dup },
            );
          }
          const rf = toWrite.related_features;
          if (Array.isArray(rf) && rf.length > 2) {
            warnings.push({
              code: "faq_too_many_tags",
              message: "related_features has more than 2 tags (preferred max 2).",
            });
          }
          warnings.push({
            code: "sibling_locale_not_created",
            message:
              "Only this locale row was added. Add a separate item for other locales if needed — this tool does not auto-translate.",
          });
        }

        const url = `http://localhost:${MAIN_SERVER_PORT}/api/databases/${encodeURIComponent(database)}/items${siteQuery(domain)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify({ item: toWrite }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }

        const newIndex =
          typeof data.count === "number" ? Math.max(0, (data.count as number) - 1) : undefined;

        const ri = await maybeReindex(database, domain, mcpToken, reindex, vectorEnabled);
        if (ri.warning) warnings.push(ri.warning);
        if (vectorEnabled && !ri.did) {
          warnings.push({
            code: "semantic_index_stale",
            message: "Vector search index not updated yet.",
          });
        }

        return ok(
          {
            message: `Added item to ${database}${newIndex !== undefined ? ` at index ${newIndex}` : ""}`,
            database,
            index: newIndex,
            item: toWrite,
            reindexed: ri.did,
            item_file: `db/${database}/${local.filename}`,
            ...data,
          },
          {
            warnings,
            side_effects: [
              {
                kind: "yaml_write",
                summary: `Appended item to db/${database}/${local.filename} (sync-state pending)`,
              },
            ],
            next_actions: ri.did ? [] : reindexNextActions(database, vectorEnabled),
          },
        );
      } catch (e) {
        return fail(`add_database_item failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "add_database_items",
    "Best-effort bulk append to a local database YAML (max 40). Per-row results[]; FAQ defaults + first-wins dedupe. Retry only failed input_index rows. Does not push content sync. Set reindex:true after any success if you have databases_manage.",
    {
      database: z.string(),
      items: z
        .array(itemSchema)
        .min(1)
        .max(40)
        .describe("Items to append (max 40)"),
      reindex: z
        .boolean()
        .optional()
        .describe(
          "If true and vector_search enabled, reindex once after any successful write (needs databases_manage)",
        ),
      site: z.string().optional(),
    },
    async ({ database, items, reindex, site }) => {
      const denied = await requireItemCap(mcpToken);
      if (denied) return denied;

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;

      const lenCheck = validateBulkLength(items.length);
      if (!lenCheck.ok) return fail(lenCheck.message);

      try {
        const cfg = await fetchDbConfig(database, domain, mcpToken);
        if (!cfg.ok) return fail(cfg.message);
        const local = assertLocal(cfg.data.config, database);
        if (!local.ok) {
          return failNonLocalMutate({
            database,
            config: cfg.data.config,
            contentPath: siteResult.contentPath,
            site,
            domain,
            mcpToken,
          });
        }

        const all = await fetchAllItems(database, domain, mcpToken);
        if (!all.ok) return fail(all.message);

        const { results, toWrite } = prepareBatchAdd(database, items, all.items);
        const warnings: McpWarning[] = [...syncWarnings(`db/${database}/${local.filename}`)];
        const vectorEnabled = cfg.data.config.vector_search?.enabled === true;

        if (database === FAQ_DB_NAME) {
          for (const row of toWrite) {
            const rf = row.item.related_features;
            if (Array.isArray(rf) && rf.length > 2) {
              warnings.push({
                code: "faq_too_many_tags",
                message: `input_index ${row.input_index}: related_features has more than 2 tags (preferred max 2).`,
              });
            }
          }
          if (toWrite.length > 0) {
            warnings.push({
              code: "sibling_locale_not_created",
              message:
                "Only the locales in this batch were added. Add separate items for other locales if needed.",
            });
          }
        }

        let wrote_count = 0;
        const items_written: Record<string, unknown>[] = [];
        const indices: number[] = [];

        if (toWrite.length > 0) {
          const url = `http://localhost:${MAIN_SERVER_PORT}/api/databases/${encodeURIComponent(database)}/items${siteQuery(domain)}`;
          const res = await fetch(url, {
            method: "POST",
            headers: internalHeaders(mcpToken),
            body: JSON.stringify({ items: toWrite.map((r) => r.item) }),
          });
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) {
            return fail((data.error as string) || `Server error: ${res.status}`, {
              results,
              wrote_count: 0,
              failed_count: results.length,
            });
          }
          wrote_count = toWrite.length;
          for (const row of toWrite) {
            const r = results[row.input_index];
            if (r?.ok) {
              items_written.push(r.item);
              indices.push(r.index);
            }
          }
        }

        const failed_count = results.filter((r) => !r.ok).length;
        const ri =
          wrote_count > 0
            ? await maybeReindex(database, domain, mcpToken, reindex, vectorEnabled)
            : { did: false as const };
        if (ri.warning) warnings.push(ri.warning);
        if (wrote_count > 0 && vectorEnabled && !ri.did) {
          warnings.push({
            code: "semantic_index_stale",
            message: "Vector search index not updated yet.",
          });
        }

        return ok(
          {
            message:
              wrote_count > 0
                ? `Added ${wrote_count} item(s) to ${database} (${failed_count} failed)`
                : `No items written to ${database} (${failed_count} failed)`,
            database,
            wrote_count,
            failed_count,
            results,
            indices,
            items_written,
            reindexed: ri.did,
            item_file: `db/${database}/${local.filename}`,
          },
          {
            warnings,
            side_effects:
              wrote_count > 0
                ? [
                    {
                      kind: "yaml_write",
                      summary: `Appended ${wrote_count} item(s) to db/${database}/${local.filename} (sync-state pending)`,
                    },
                  ]
                : [],
            next_actions: [
              ...(wrote_count > 0 && !ri.did
                ? reindexNextActions(database, vectorEnabled)
                : []),
              ...(failed_count > 0
                ? [
                    {
                      tool: "add_database_items",
                      reason:
                        "Retry only failed input_index rows after fixing validation/duplicates",
                      args_hint: { database },
                      priority: "recommended" as const,
                    },
                  ]
                : []),
            ],
          },
        );
      } catch (e) {
        return fail(`add_database_items failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "update_database_item",
    "PATCH a local database item by global index. Pass expect.question (from prior list/get) to refuse stale indices. FAQ dedupe applies if question/locale change. Set reindex:true to reindex after write.",
    {
      database: z.string(),
      index: z.number().int().min(0),
      item: itemSchema.describe("Partial fields to merge"),
      expect_question: z
        .string()
        .optional()
        .describe("If set, must match current item.question or update is refused"),
      reindex: z.boolean().optional(),
      site: z.string().optional(),
    },
    async ({ database, index, item, expect_question, reindex, site }) => {
      const denied = await requireItemCap(mcpToken);
      if (denied) return denied;

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;

      try {
        const cfg = await fetchDbConfig(database, domain, mcpToken);
        if (!cfg.ok) return fail(cfg.message);
        const local = assertLocal(cfg.data.config, database);
        if (!local.ok) {
          return failNonLocalMutate({
            database,
            config: cfg.data.config,
            contentPath: siteResult.contentPath,
            site,
            domain,
            mcpToken,
            index,
          });
        }

        const all = await fetchAllItems(database, domain, mcpToken);
        if (!all.ok) return fail(all.message);
        if (index < 0 || index >= all.items.length) {
          return fail(`Item at index ${index} not found (length=${all.items.length})`);
        }

        const current = all.items[index];
        if (
          expect_question !== undefined &&
          String(current.question ?? "") !== expect_question
        ) {
          return actionRequired(
            {
              success: false,
              action_required: "relist_and_retry",
              message: `expect_question mismatch at index ${index}. Item may have shifted — re-list and use the current global index.`,
              expected_question: expect_question,
              actual_question: current.question ?? null,
              index,
            },
            [
              {
                tool: "list_database_items",
                reason: "Re-fetch items with global index before update",
                args_hint: { database },
                priority: "required",
              },
            ],
          );
        }

        const merged = { ...current, ...item };
        const warnings: McpWarning[] = [...syncWarnings(`db/${database}/${local.filename}`)];
        const vectorEnabled = cfg.data.config.vector_search?.enabled === true;

        if (database === FAQ_DB_NAME) {
          const v = validateFaqItem(merged);
          if (!v.ok) return fail(v.message);
          const dup = findFaqDuplicateIndex(
            all.items,
            String(merged.locale),
            String(merged.question),
            index,
          );
          if (dup >= 0) {
            return fail(
              `Update would duplicate FAQ at global index ${dup} (same locale + normalized question)`,
              { existing_index: dup },
            );
          }
          const rf = merged.related_features;
          if (Array.isArray(rf) && rf.length > 2) {
            warnings.push({
              code: "faq_too_many_tags",
              message: "related_features has more than 2 tags (preferred max 2).",
            });
          }
        }

        const url = `http://localhost:${MAIN_SERVER_PORT}/api/databases/${encodeURIComponent(database)}/items/${index}${siteQuery(domain)}`;
        const res = await fetch(url, {
          method: "PATCH",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify(item),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }

        const ri = await maybeReindex(database, domain, mcpToken, reindex, vectorEnabled);
        if (ri.warning) warnings.push(ri.warning);
        if (vectorEnabled && !ri.did) {
          warnings.push({
            code: "semantic_index_stale",
            message: "Vector search index not updated yet.",
          });
        }

        return ok(
          {
            message: `Updated ${database} item at index ${index}`,
            database,
            index,
            item: data.item ?? merged,
            reindexed: ri.did,
            item_file: `db/${database}/${local.filename}`,
          },
          {
            warnings,
            side_effects: [
              {
                kind: "yaml_write",
                summary: `Patched db/${database}/${local.filename} index ${index} (sync-state pending)`,
              },
            ],
            next_actions: ri.did ? [] : reindexNextActions(database, vectorEnabled),
          },
        );
      } catch (e) {
        return fail(`update_database_item failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "update_database_items",
    "Best-effort bulk PATCH of local database items by global index (max 40). Recommended: pass expect_question per row from last list/get (optional — index alone is trusted when omitted). Working-copy order allows FAQ renames/swaps; two rows targeting the same FAQ key both fail. HTTP failure aborts remaining rows. Retry failed/aborted input_index only.",
    {
      database: z.string(),
      updates: z
        .array(
          z.object({
            index: z.number().int().min(0).describe("Global array index"),
            item: itemSchema.describe("Partial fields to merge"),
            expect_question: z
              .string()
              .optional()
              .describe(
                "Recommended: must match current item.question or this row is refused",
              ),
          }),
        )
        .min(1)
        .max(40)
        .describe("Updates to apply (max 40)"),
      reindex: z.boolean().optional(),
      site: z.string().optional(),
    },
    async ({ database, updates, reindex, site }) => {
      const denied = await requireItemCap(mcpToken);
      if (denied) return denied;

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;

      const lenCheck = validateBulkLength(updates.length);
      if (!lenCheck.ok) return fail(lenCheck.message);

      try {
        const cfg = await fetchDbConfig(database, domain, mcpToken);
        if (!cfg.ok) return fail(cfg.message);
        const local = assertLocal(cfg.data.config, database);
        if (!local.ok) {
          const firstIndex =
            updates.length > 0 && typeof updates[0]?.index === "number"
              ? updates[0].index
              : undefined;
          return failNonLocalMutate({
            database,
            config: cfg.data.config,
            contentPath: siteResult.contentPath,
            site,
            domain,
            mcpToken,
            index: firstIndex,
          });
        }

        const all = await fetchAllItems(database, domain, mcpToken);
        if (!all.ok) return fail(all.message);

        const { results, toPatch } = prepareBatchUpdate(database, updates, all.items);
        const finalResults: BatchRowResult[] = results.map((r) => ({ ...r }));
        const warnings: McpWarning[] = [...syncWarnings(`db/${database}/${local.filename}`)];
        const vectorEnabled = cfg.data.config.vector_search?.enabled === true;

        if (database === FAQ_DB_NAME) {
          for (const row of toPatch) {
            const rf = row.merged.related_features;
            if (Array.isArray(rf) && rf.length > 2) {
              warnings.push({
                code: "faq_too_many_tags",
                message: `input_index ${row.input_index}: related_features has more than 2 tags (preferred max 2).`,
              });
            }
          }
        }

        let wrote_count = 0;
        const items_written: Record<string, unknown>[] = [];
        const indices: number[] = [];

        for (let i = 0; i < toPatch.length; i++) {
          const row = toPatch[i];
          const url = `http://localhost:${MAIN_SERVER_PORT}/api/databases/${encodeURIComponent(database)}/items/${row.index}${siteQuery(domain)}`;
          const res = await fetch(url, {
            method: "PATCH",
            headers: internalHeaders(mcpToken),
            body: JSON.stringify(row.item),
          });
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) {
            const msg = (data.error as string) || `Server error: ${res.status}`;
            finalResults[row.input_index] = {
              input_index: row.input_index,
              ok: false,
              code: "http_error",
              message: msg,
              index: row.index,
            };
            abortRemainingPatches(
              finalResults,
              toPatch,
              i,
              `Aborted after HTTP failure on input_index ${row.input_index}: ${msg}`,
            );
            break;
          }

          const written = (data.item as Record<string, unknown> | undefined) ?? row.merged;
          wrote_count += 1;
          items_written.push(written);
          indices.push(row.index);
          finalResults[row.input_index] = {
            input_index: row.input_index,
            ok: true,
            index: row.index,
            item: written,
          };
        }

        const failed_count = finalResults.filter((r) => !r.ok).length;
        const ri =
          wrote_count > 0
            ? await maybeReindex(database, domain, mcpToken, reindex, vectorEnabled)
            : { did: false as const };
        if (ri.warning) warnings.push(ri.warning);
        if (wrote_count > 0 && vectorEnabled && !ri.did) {
          warnings.push({
            code: "semantic_index_stale",
            message: "Vector search index not updated yet.",
          });
        }

        return ok(
          {
            message:
              wrote_count > 0
                ? `Updated ${wrote_count} item(s) in ${database} (${failed_count} failed/aborted)`
                : `No items updated in ${database} (${failed_count} failed/aborted)`,
            database,
            wrote_count,
            failed_count,
            results: finalResults,
            indices,
            items_written,
            reindexed: ri.did,
            item_file: `db/${database}/${local.filename}`,
          },
          {
            warnings,
            side_effects:
              wrote_count > 0
                ? [
                    {
                      kind: "yaml_write",
                      summary: `Patched ${wrote_count} item(s) in db/${database}/${local.filename} (sync-state pending)`,
                    },
                  ]
                : [],
            next_actions: [
              ...(wrote_count > 0 && !ri.did
                ? reindexNextActions(database, vectorEnabled)
                : []),
              ...(failed_count > 0
                ? [
                    {
                      tool: "update_database_items",
                      reason: "Retry only failed/aborted input_index rows",
                      args_hint: { database },
                      priority: "recommended" as const,
                    },
                  ]
                : []),
            ],
          },
        );
      } catch (e) {
        return fail(`update_database_items failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "delete_database_item",
    "Delete a local database item by global index. Requires confirm:true. Without confirm, returns action_required with usage summary. Hard delete — bank FAQs disappear from all sections that pull them.",
    {
      database: z.string(),
      index: z.number().int().min(0),
      confirm: z.boolean().optional().describe("Must be true to perform delete"),
      expect_question: z.string().optional(),
      reindex: z.boolean().optional(),
      site: z.string().optional(),
    },
    async ({ database, index, confirm, expect_question, reindex, site }) => {
      const denied = await requireItemCap(mcpToken);
      if (denied) return denied;

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;

      try {
        const cfg = await fetchDbConfig(database, domain, mcpToken);
        if (!cfg.ok) return fail(cfg.message);
        const local = assertLocal(cfg.data.config, database);
        if (!local.ok) {
          return failNonLocalMutate({
            database,
            config: cfg.data.config,
            contentPath: siteResult.contentPath,
            site,
            domain,
            mcpToken,
            index,
          });
        }

        const all = await fetchAllItems(database, domain, mcpToken);
        if (!all.ok) return fail(all.message);
        if (index < 0 || index >= all.items.length) {
          return fail(`Item at index ${index} not found (length=${all.items.length})`);
        }
        const current = all.items[index];

        if (
          expect_question !== undefined &&
          String(current.question ?? "") !== expect_question
        ) {
          return actionRequired(
            {
              success: false,
              action_required: "relist_and_retry",
              message: `expect_question mismatch at index ${index}`,
              expected_question: expect_question,
              actual_question: current.question ?? null,
              index,
            },
            [
              {
                tool: "list_database_items",
                reason: "Re-fetch before delete",
                args_hint: { database },
                priority: "required",
              },
            ],
          );
        }

        let usageSummary: ReturnType<typeof summarizeUsage> | null = null;
        let usageUnknown = false;
        try {
          const usageUrl = `http://localhost:${MAIN_SERVER_PORT}/api/databases/${encodeURIComponent(database)}/usage${siteQuery(domain)}`;
          const usageRes = await fetch(usageUrl, { headers: internalHeaders(mcpToken) });
          if (usageRes.ok) {
            const usageData = (await usageRes.json()) as {
              content_types?: Array<{ name: string; label?: string }>;
              queries?: Array<{ file?: string; content_type?: string; kind?: string }>;
            };
            usageSummary = summarizeUsage(usageData);
          } else {
            usageUnknown = true;
          }
        } catch {
          usageUnknown = true;
        }

        if (confirm !== true) {
          return actionRequired(
            {
              success: false,
              action_required: "confirm_delete",
              message: `Set confirm:true to delete ${database} index ${index}. This removes the YAML row permanently.`,
              database,
              index,
              item_preview: {
                question: current.question ?? null,
                locale: current.locale ?? null,
              },
              usage: usageSummary,
              usage_unknown: usageUnknown,
            },
            [
              {
                tool: "delete_database_item",
                reason: "Retry with confirm:true after reviewing usage",
                args_hint: {
                  database,
                  index,
                  confirm: true,
                  expect_question: current.question,
                },
                priority: "required",
              },
            ],
          );
        }

        const warnings: McpWarning[] = [...syncWarnings(`db/${database}/${local.filename}`)];
        if (usageUnknown) {
          warnings.push({
            code: "usage_unknown",
            message: "Could not load database usage; sections may still reference this bank.",
          });
        }
        const vectorEnabled = cfg.data.config.vector_search?.enabled === true;

        const url = `http://localhost:${MAIN_SERVER_PORT}/api/databases/${encodeURIComponent(database)}/items/${index}${siteQuery(domain)}`;
        const res = await fetch(url, {
          method: "DELETE",
          headers: internalHeaders(mcpToken),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }

        const ri = await maybeReindex(database, domain, mcpToken, reindex, vectorEnabled);
        if (ri.warning) warnings.push(ri.warning);
        if (vectorEnabled && !ri.did) {
          warnings.push({
            code: "semantic_index_stale",
            message: "Vector search index not updated yet.",
          });
        }

        return ok(
          {
            message: `Deleted ${database} item at index ${index}`,
            database,
            index,
            deleted_preview: {
              question: current.question ?? null,
              locale: current.locale ?? null,
            },
            reindexed: ri.did,
            item_file: `db/${database}/${local.filename}`,
          },
          {
            warnings,
            side_effects: [
              {
                kind: "yaml_write",
                summary: `Removed index ${index} from db/${database}/${local.filename} (sync-state pending)`,
              },
            ],
            next_actions: ri.did ? [] : reindexNextActions(database, vectorEnabled),
          },
        );
      } catch (e) {
        return fail(`delete_database_item failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "reindex_database",
    "Trigger vector reindex for a database with vector_search.enabled. Requires databases_manage. Call after item CRUD so semantic search includes new/changed rows.",
    {
      database: z.string(),
      site: z.string().optional(),
    },
    async ({ database, site }) => {
      const denied = await requireReindexCap(mcpToken);
      if (denied) return denied;

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;

      try {
        const cfg = await fetchDbConfig(database, domain, mcpToken);
        if (!cfg.ok) return fail(cfg.message);
        if (cfg.data.config.vector_search?.enabled !== true) {
          return fail(`Semantic search is not enabled for database "${database}"`);
        }

        const url = `http://localhost:${MAIN_SERVER_PORT}/api/databases/${encodeURIComponent(database)}/reindex${siteQuery(domain)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }

        return ok(
          {
            message: `Reindex started for ${database}`,
            database,
            ...data,
          },
          {
            warnings: [
              {
                code: "reindex_async",
                message: "Indexing runs in the background; check job-status / Semantic Index KPI until done.",
              },
            ],
            side_effects: [
              {
                kind: "vector_reindex",
                summary: `Queued Qdrant reindex for ${database}; search-result cache cleared on success`,
              },
            ],
            next_actions: [],
          },
        );
      } catch (e) {
        return fail(`reindex_database failed: ${(e as Error).message}`);
      }
    },
  );
}
