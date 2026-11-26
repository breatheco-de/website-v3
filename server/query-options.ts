import { getContentTypeConfig } from "./content-types";
import { databaseManager, type DatabaseManager } from "./database";
import {
  queryEntries,
  type QueryFilter,
  type QueryEntriesOptions,
} from "./query-entries";
import {
  assertSourceNameAvailable as assertSourceNameAvailableCore,
  findSourceNameCollisions as findSourceNameCollisionsCore,
  logSourceNameCollisions as logSourceNameCollisionsCore,
  resolveSourceName as resolveSourceNameCore,
  type ResolvedSource,
} from "./source-namespace";

const RESERVED_QUERY_KEYS = new Set([
  "source",
  "content_type",
  "database",
  "value",
  "label",
  "sort",
  "limit",
  "locale",
]);

export type { ResolvedSource };

export interface QueryOption {
  value: string;
  label: string;
  /** Present when the source content type has ecommerce products. Not used as an implicit filter. */
  purchasable?: boolean;
}

/** Exact-name collisions between content-type keys and database slugs. */
export function findSourceNameCollisions(
  contentRoot?: string,
  db: DatabaseManager = databaseManager,
): string[] {
  return findSourceNameCollisionsCore(contentRoot, db);
}

export function logSourceNameCollisions(
  contentRoot?: string,
  db: DatabaseManager = databaseManager,
): string[] {
  return logSourceNameCollisionsCore(contentRoot, db);
}

export function resolveSourceName(
  name: string,
  contentRoot?: string,
  db: DatabaseManager = databaseManager,
): ResolvedSource {
  return resolveSourceNameCore(name, contentRoot, db);
}

/**
 * Content-type keys and database slugs share one namespace for relation /
 * query-options `source`. Reject creating a name that already exists on the
 * other side.
 */
export function assertSourceNameAvailable(
  name: string,
  as: "contentType" | "database",
  contentRoot?: string,
  db: DatabaseManager = databaseManager,
): void {
  assertSourceNameAvailableCore(name, as, contentRoot, db);
}

export function parseFilterQueryParams(
  query: Record<string, unknown>,
): {
  filters: QueryFilter[];
  sort?: string;
  limit?: number;
  locale?: string;
  valuePath?: string;
  labelPath?: string;
  source?: string;
  content_type?: string;
  database?: string;
} {
  const source =
    typeof query.source === "string" && query.source ? query.source : undefined;
  const content_type =
    typeof query.content_type === "string" && query.content_type
      ? query.content_type
      : undefined;
  const database =
    typeof query.database === "string" && query.database ? query.database : undefined;
  const valuePath =
    typeof query.value === "string" && query.value ? query.value : undefined;
  const labelPath =
    typeof query.label === "string" && query.label ? query.label : undefined;
  const sort =
    typeof query.sort === "string" && query.sort ? query.sort : undefined;
  const locale =
    typeof query.locale === "string" && query.locale ? query.locale : undefined;

  let limit: number | undefined;
  if (query.limit !== undefined && query.limit !== "") {
    const n = parseInt(String(query.limit), 10);
    if (!Number.isNaN(n) && n > 0) limit = n;
  }

  const filters: QueryFilter[] = [];
  for (const [key, raw] of Object.entries(query)) {
    if (RESERVED_QUERY_KEYS.has(key)) continue;
    if (raw === undefined || raw === null || raw === "") continue;
    const str = Array.isArray(raw) ? String(raw[0]) : String(raw);
    if (!str) continue;
    const value = str.includes(",")
      ? str.split(",").map((s) => s.trim()).filter(Boolean)
      : str;
    filters.push({ field: key, value });
  }

  return { filters, sort, limit, locale, valuePath, labelPath, source, content_type, database };
}

function pickField(
  item: Record<string, unknown>,
  path: string,
): unknown {
  if (!path.includes(".")) return item[path];
  const parts = path.split(".");
  let cur: unknown = item;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function mapItemToOption(
  item: Record<string, unknown>,
  valuePath?: string,
  labelPath?: string,
): QueryOption | null {
  const rawValue = valuePath
    ? pickField(item, valuePath)
    : (item.bc_slug ?? item.slug ?? item.id);
  const rawLabel = labelPath
    ? pickField(item, labelPath)
    : (item.title ?? item.name ?? item.label ?? item.slug);

  const value = rawValue == null || rawValue === "" ? "" : String(rawValue);
  const label = rawLabel == null || rawLabel === "" ? "" : String(rawLabel);
  if (!value) return null;
  const option: QueryOption = { value, label: label || value };
  if (typeof item.purchasable === "boolean") {
    option.purchasable = item.purchasable;
  }
  return option;
}

export async function fetchQueryOptions(
  input: {
    source?: string;
    contentType?: string;
    database?: string;
    filters?: QueryFilter[];
    sort?: string;
    limit?: number;
    locale?: string;
    valuePath?: string;
    labelPath?: string;
  },
  options: QueryEntriesOptions = {},
): Promise<
  | { ok: true; options: QueryOption[]; meta: { source: string; kind: string } }
  | { ok: false; status: number; error: string }
> {
  const contentRoot = options.contentRoot;
  const db = options.db ?? databaseManager;
  const explicitType = input.contentType?.trim();
  const explicitDb = input.database?.trim();

  if (explicitType && explicitDb) {
    return {
      ok: false,
      status: 400,
      error: "Pass either content_type or database, not both",
    };
  }

  let from: { contentType: string } | { database: string };
  let kind: string;
  let sourceName: string;

  if (explicitType) {
    if (!getContentTypeConfig(explicitType, contentRoot)) {
      return {
        ok: false,
        status: 404,
        error: `Content type "${explicitType}" not found`,
      };
    }
    from = { contentType: explicitType };
    kind = "contentType";
    sourceName = explicitType;
  } else if (explicitDb) {
    if (!db.exists(explicitDb)) {
      return {
        ok: false,
        status: 404,
        error: `Database "${explicitDb}" not found`,
      };
    }
    from = { database: explicitDb };
    kind = "database";
    sourceName = explicitDb;
  } else if (input.source) {
    const resolved = resolveSourceName(input.source, contentRoot, db);

    if (resolved.kind === "collision") {
      return {
        ok: false,
        status: 409,
        error: `Source name "${input.source}" matches both a content type and a database — rename one to remove the collision`,
      };
    }
    if (resolved.kind === "not_found") {
      return {
        ok: false,
        status: 404,
        error: `Source "${input.source}" not found as a content type or database`,
      };
    }
    from =
      resolved.kind === "contentType"
        ? { contentType: resolved.name }
        : { database: resolved.name };
    kind = resolved.kind;
    sourceName = resolved.name;
  } else {
    return {
      ok: false,
      status: 400,
      error: "content_type, database, or source is required",
    };
  }

  const { items, meta } = await queryEntries(
    {
      from,
      locale: input.locale,
      filters: input.filters?.length ? input.filters : undefined,
      sort: input.sort,
      limit: input.limit,
    },
    options,
  );

  const mapped: QueryOption[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const opt = mapItemToOption(item, input.valuePath, input.labelPath);
    if (!opt || seen.has(opt.value)) continue;
    seen.add(opt.value);
    mapped.push(opt);
  }

  return {
    ok: true,
    options: mapped,
    meta: { source: meta.key || sourceName, kind },
  };
}
