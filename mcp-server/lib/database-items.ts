/**
 * Pure helpers for MCP local database item tools (FAQ defaults, dedupe, indexing).
 */

export const FAQ_DB_NAME = "frequently_asked_questions";

export function normalizeFaqQuestion(question: string): string {
  return question
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

export function faqDuplicateKey(locale: string, question: string): string {
  return `${locale.toLowerCase().trim()}|${normalizeFaqQuestion(question)}`;
}

export function applyFaqDefaults(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...item };
  if (out.last_updated == null || out.last_updated === "") {
    out.last_updated = new Date().toISOString().slice(0, 10);
  }
  if (out.priority == null || out.priority === "") {
    out.priority = 2;
  }
  if (out.locations == null) {
    out.locations = ["all"];
  }
  return out;
}

export function validateFaqItem(
  item: Record<string, unknown>,
  opts?: { requireLocale?: boolean },
): { ok: true } | { ok: false; message: string } {
  const requireLocale = opts?.requireLocale !== false;
  if (typeof item.question !== "string" || !item.question.trim()) {
    return { ok: false, message: "FAQ item requires non-empty string field: question" };
  }
  if (typeof item.answer !== "string" || !item.answer.trim()) {
    return { ok: false, message: "FAQ item requires non-empty string field: answer" };
  }
  if (requireLocale && (typeof item.locale !== "string" || !item.locale.trim())) {
    return { ok: false, message: "FAQ item requires non-empty string field: locale" };
  }
  return { ok: true };
}

export function findFaqDuplicateIndex(
  items: Record<string, unknown>[],
  locale: string,
  question: string,
  excludeIndex?: number,
): number {
  const key = faqDuplicateKey(locale, question);
  for (let i = 0; i < items.length; i++) {
    if (excludeIndex !== undefined && i === excludeIndex) continue;
    const loc = String(items[i].locale ?? "");
    const q = String(items[i].question ?? "");
    if (!q) continue;
    if (faqDuplicateKey(loc, q) === key) return i;
  }
  return -1;
}

export type IndexedItem = Record<string, unknown> & { index: number };

/** Stamp every row with its global array index. */
export function withGlobalIndices(
  items: Record<string, unknown>[],
): IndexedItem[] {
  return items.map((item, index) => ({ ...item, index }));
}

/**
 * Filter indexed items without renumbering. `filters` values are OR within a field,
 * AND across fields. Special key `locale` matches item.locale.
 */
export function filterIndexedItems(
  items: IndexedItem[],
  filters: Record<string, string | string[]> | undefined,
): IndexedItem[] {
  if (!filters || Object.keys(filters).length === 0) return items;
  return items.filter((item) => {
    for (const [field, rawValues] of Object.entries(filters)) {
      const values = (Array.isArray(rawValues) ? rawValues : [rawValues]).map(String);
      if (values.length === 0) continue;
      const fieldVal = item[field];
      const match = Array.isArray(fieldVal)
        ? values.some((v) => fieldVal.map(String).includes(v))
        : values.includes(String(fieldVal ?? ""));
      if (!match) return false;
    }
    return true;
  });
}

export function paginateItems<T>(
  items: T[],
  page: number,
  limit: number,
): { items: T[]; page: number; limit: number; total_count: number } {
  const safePage = Math.max(1, page);
  const safeLimit = Math.max(1, Math.min(1000, limit));
  const start = (safePage - 1) * safeLimit;
  return {
    items: items.slice(start, start + safeLimit),
    page: safePage,
    limit: safeLimit,
    total_count: items.length,
  };
}

export function summarizeUsage(report: {
  content_types?: Array<{ name: string; label?: string }>;
  queries?: Array<{ file?: string; content_type?: string; kind?: string }>;
}): {
  content_type_count: number;
  query_count: number;
  sample_files: string[];
} {
  const queries = report.queries ?? [];
  const sample_files = queries
    .map((q) => q.file)
    .filter((f): f is string => typeof f === "string" && f.length > 0)
    .slice(0, 8);
  return {
    content_type_count: report.content_types?.length ?? 0,
    query_count: queries.length,
    sample_files,
  };
}

/** Max items/updates per bulk MCP tool call. */
export const MAX_BULK = 40;

export type BatchRowOk = {
  input_index: number;
  ok: true;
  index: number;
  item: Record<string, unknown>;
};

export type BatchRowFail = {
  input_index: number;
  ok: false;
  code: string;
  message: string;
  field?: string;
  existing_index?: number;
  index?: number;
};

export type BatchRowResult = BatchRowOk | BatchRowFail;

export function validateBulkLength(
  length: number,
): { ok: true } | { ok: false; message: string } {
  if (length < 1) {
    return { ok: false, message: "Batch must contain at least 1 row" };
  }
  if (length > MAX_BULK) {
    return {
      ok: false,
      message: `Batch exceeds max of ${MAX_BULK} rows (got ${length})`,
    };
  }
  return { ok: true };
}

function isPlainItem(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

export type PreparedAddRow = {
  input_index: number;
  item: Record<string, unknown>;
};

/**
 * Best-effort prepare for bulk add. FAQ: per-item defaults + first-wins
 * duplicate vs existing DB and earlier rows in this batch.
 */
export function prepareBatchAdd(
  database: string,
  items: unknown[],
  existing: Record<string, unknown>[],
): { results: BatchRowResult[]; toWrite: PreparedAddRow[] } {
  const results: BatchRowResult[] = [];
  const toWrite: PreparedAddRow[] = [];
  const writtenSoFar: Record<string, unknown>[] = [];

  for (let input_index = 0; input_index < items.length; input_index++) {
    const raw = items[input_index];
    if (!isPlainItem(raw)) {
      results.push({
        input_index,
        ok: false,
        code: "invalid_item",
        message: "Item must be a plain object",
      });
      continue;
    }

    if (database === FAQ_DB_NAME) {
      const v = validateFaqItem(raw);
      if (!v.ok) {
        results.push({
          input_index,
          ok: false,
          code: "validation",
          message: v.message,
        });
        continue;
      }
      const prepared = applyFaqDefaults({ ...raw });
      const pool = [...existing, ...writtenSoFar];
      const dup = findFaqDuplicateIndex(
        pool,
        String(prepared.locale),
        String(prepared.question),
      );
      if (dup >= 0) {
        results.push({
          input_index,
          ok: false,
          code: "duplicate",
          message: `Duplicate FAQ for locale="${prepared.locale}" question (normalized) already exists at global index ${dup}`,
          existing_index: dup,
        });
        continue;
      }
      writtenSoFar.push(prepared);
      toWrite.push({ input_index, item: prepared });
      results.push({
        input_index,
        ok: true,
        index: existing.length + writtenSoFar.length - 1,
        item: prepared,
      });
      continue;
    }

    const prepared = { ...raw };
    writtenSoFar.push(prepared);
    toWrite.push({ input_index, item: prepared });
    results.push({
      input_index,
      ok: true,
      index: existing.length + writtenSoFar.length - 1,
      item: prepared,
    });
  }

  return { results, toWrite };
}

export type BatchUpdateInput = {
  index: unknown;
  item: unknown;
  expect_question?: unknown;
};

export type PreparedPatchRow = {
  input_index: number;
  index: number;
  /** Partial fields sent to PATCH */
  item: Record<string, unknown>;
  /** Merged item after apply */
  merged: Record<string, unknown>;
};

/**
 * Best-effort prepare for bulk update. Working-copy simulation in input_index
 * order; then fail-both on shared FAQ keys among tentatives (or vs untouched rows).
 */
export function prepareBatchUpdate(
  database: string,
  updates: BatchUpdateInput[],
  existing: Record<string, unknown>[],
): { results: BatchRowResult[]; toPatch: PreparedPatchRow[] } {
  const working = existing.map((row) => ({ ...row }));
  const claimed = new Map<number, number>(); // global index → input_index
  const tentatives: PreparedPatchRow[] = [];
  const earlyFails: BatchRowFail[] = [];

  for (let input_index = 0; input_index < updates.length; input_index++) {
    const row = updates[input_index] ?? {};
    const indexRaw = row.index;
    const index =
      typeof indexRaw === "number" && Number.isInteger(indexRaw)
        ? indexRaw
        : NaN;

    if (!Number.isInteger(index) || index < 0) {
      earlyFails.push({
        input_index,
        ok: false,
        code: "not_found",
        message: "index must be a non-negative integer",
      });
      continue;
    }

    if (index >= existing.length) {
      earlyFails.push({
        input_index,
        ok: false,
        code: "not_found",
        message: `Item at index ${index} not found (length=${existing.length})`,
        index,
      });
      continue;
    }

    if (claimed.has(index)) {
      earlyFails.push({
        input_index,
        ok: false,
        code: "duplicate_index",
        message: `Global index ${index} already targeted by input_index ${claimed.get(index)}`,
        index,
      });
      continue;
    }

    if (!isPlainItem(row.item)) {
      earlyFails.push({
        input_index,
        ok: false,
        code: "invalid_item",
        message: "item must be a plain object (partial patch)",
        index,
      });
      continue;
    }

    const currentOriginal = existing[index];
    if (
      row.expect_question !== undefined &&
      String(currentOriginal.question ?? "") !== String(row.expect_question)
    ) {
      earlyFails.push({
        input_index,
        ok: false,
        code: "expect_mismatch",
        message: `expect_question mismatch at index ${index}`,
        index,
      });
      continue;
    }

    const merged = { ...working[index], ...row.item };

    if (database === FAQ_DB_NAME) {
      const v = validateFaqItem(merged);
      if (!v.ok) {
        earlyFails.push({
          input_index,
          ok: false,
          code: "validation",
          message: v.message,
          index,
        });
        continue;
      }
    }

    claimed.set(index, input_index);
    working[index] = merged;
    tentatives.push({
      input_index,
      index,
      item: { ...row.item },
      merged,
    });
  }

  const demoted = new Set<number>(); // input_index
  const tentativeByIndex = new Map(tentatives.map((t) => [t.index, t] as const));

  const rebuildWorking = (): Record<string, unknown>[] => {
    const rebuilt = existing.map((row) => ({ ...row }));
    for (const t of tentatives) {
      if (!demoted.has(t.input_index)) rebuilt[t.index] = { ...t.merged };
    }
    return rebuilt;
  };

  if (database === FAQ_DB_NAME) {
    // Fail-both: any FAQ key with count>1 demotes all tentatives on that key.
    const markCollidingTentatives = (rows: Record<string, unknown>[]) => {
      const keyToIndices = new Map<string, number[]>();
      for (let i = 0; i < rows.length; i++) {
        const loc = String(rows[i].locale ?? "");
        const q = String(rows[i].question ?? "");
        if (!q) continue;
        const key = faqDuplicateKey(loc, q);
        const list = keyToIndices.get(key) ?? [];
        list.push(i);
        keyToIndices.set(key, list);
      }
      let added = false;
      for (const [, indices] of keyToIndices) {
        if (indices.length < 2) continue;
        for (const gi of indices) {
          const t = tentativeByIndex.get(gi);
          if (t && !demoted.has(t.input_index)) {
            demoted.add(t.input_index);
            added = true;
          }
        }
      }
      return added;
    };

    markCollidingTentatives(working);
    let changed = true;
    while (changed) {
      changed = markCollidingTentatives(rebuildWorking());
    }
  }

  const finalWorking = rebuildWorking();

  const results: BatchRowResult[] = new Array(updates.length);
  for (const f of earlyFails) {
    results[f.input_index] = f;
  }

  const toPatch: PreparedPatchRow[] = [];
  for (const t of tentatives) {
    if (demoted.has(t.input_index)) {
      const key = faqDuplicateKey(
        String(t.merged.locale ?? ""),
        String(t.merged.question ?? ""),
      );
      const colliding = finalWorking
        .map((row, i) => ({ row, i }))
        .filter(
          ({ row, i }) =>
            i !== t.index &&
            row.question &&
            faqDuplicateKey(String(row.locale ?? ""), String(row.question)) ===
              key,
        )
        .map(({ i }) => i);
      // Peers demoted for the same key (fail-both) may not appear in finalWorking.
      const demotedPeers = tentatives
        .filter(
          (o) =>
            o.input_index !== t.input_index &&
            demoted.has(o.input_index) &&
            faqDuplicateKey(
              String(o.merged.locale ?? ""),
              String(o.merged.question ?? ""),
            ) === key,
        )
        .map((o) => o.index);
      const allColliding = [...new Set([...colliding, ...demotedPeers])];
      results[t.input_index] = {
        input_index: t.input_index,
        ok: false,
        code: "duplicate",
        message: `Update would create duplicate FAQ key (locale + normalized question); colliding global index(es): ${allColliding.join(", ") || "batch"}`,
        index: t.index,
        existing_index: allColliding[0],
      };
      continue;
    }
    results[t.input_index] = {
      input_index: t.input_index,
      ok: true,
      index: t.index,
      item: t.merged,
    };
    toPatch.push(t);
  }

  for (let i = 0; i < updates.length; i++) {
    if (!results[i]) {
      results[i] = {
        input_index: i,
        ok: false,
        code: "validation",
        message: "Row was not processed",
      };
    }
  }

  return { results, toPatch };
}

/**
 * After an HTTP failure on one prepared patch, mark later prepared rows aborted
 * (mutates `results` in place). Returns count of rows marked aborted.
 */
export function abortRemainingPatches(
  results: BatchRowResult[],
  toPatch: PreparedPatchRow[],
  failedToPatchIndex: number,
  message: string,
): number {
  let count = 0;
  for (let i = failedToPatchIndex + 1; i < toPatch.length; i++) {
    const row = toPatch[i];
    results[row.input_index] = {
      input_index: row.input_index,
      ok: false,
      code: "aborted",
      message,
      index: row.index,
    };
    count += 1;
  }
  return count;
}

/** Max string length kept on list summaries (longer values omitted). */
export const SUMMARY_MAX_STRING_CHARS = 240;

const HEAVY_SUMMARY_KEYS = new Set(["content", "readme", "manifest", "decoded"]);

function isHeavySummaryKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (HEAVY_SUMMARY_KEYS.has(lower)) return true;
  if (lower.endsWith(".decoded") || lower.endsWith("_decoded")) return true;
  return false;
}

/**
 * Project a DB row for list_database_items: keep short identity/meta; drop heavy
 * bodies and long strings. Preserves `index` when present. Same shape for all limits.
 */
export function summarizeDatabaseItem(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (isHeavySummaryKey(key)) continue;
    if (typeof value === "string") {
      if (value.length > SUMMARY_MAX_STRING_CHARS) continue;
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      const keep = value.every((el) => {
        if (el == null) return true;
        if (typeof el === "string") return el.length <= SUMMARY_MAX_STRING_CHARS;
        return typeof el === "number" || typeof el === "boolean";
      });
      if (keep) out[key] = value;
      continue;
    }
    if (value !== null && typeof value === "object") {
      // Nested objects (e.g. readme blobs) omitted from list summaries.
      continue;
    }
    out[key] = value;
  }
  return out;
}

export type DatabaseReadWarning = { code: string; message: string };

/** Stable warning codes for list/get across local and non-local sources. */
export function databaseReadWarnings(opts: {
  sourceType: string | null | undefined;
  refreshed?: boolean;
  refreshFailed?: boolean;
  refreshIgnoredPagination?: boolean;
}): DatabaseReadWarning[] {
  const sourceType = opts.sourceType ?? "unknown";
  const local = sourceType === "local";
  const warnings: DatabaseReadWarning[] = [];

  if (opts.refreshIgnoredPagination) {
    warnings.push({
      code: "refresh_ignored_pagination",
      message:
        "refresh:true is ignored when page > 1 — using cache. Force refresh on page 1 only.",
    });
  }
  if (opts.refreshFailed) {
    warnings.push({
      code: "refresh_failed",
      message:
        "Forced cache refresh failed; returning last available items which may be stale.",
    });
  } else if (opts.refreshed) {
    warnings.push({
      code: "refresh_done",
      message: local
        ? "Forced cache rebuild completed before this read."
        : "Forced cache rebuild completed (external source was fetched).",
    });
  }

  if (local) {
    warnings.push({
      code: "global_index",
      message:
        "Use the `index` field on each row for update_database_item / delete_database_item — not the position within this filtered page.",
    });
  } else {
    warnings.push({
      code: "read_only_cache",
      message:
        "Rows come from the CMS cache of an api/remote database. MCP cannot add/update/delete source rows — customize via field overrides when a content type links this DB, or edit upstream and refresh.",
    });
    warnings.push({
      code: "index_not_writable",
      message:
        "`index` is the cache-array position for get_database_item only — not a mutate key for api/remote databases.",
    });
  }

  return warnings;
}

/** Content-type keys whose database.slug matches this private DB name. */
export function resolveContentTypesForDatabase(
  database: string,
  configs: Record<string, { database?: { slug?: string } | null }>,
): string[] {
  const out: string[] = [];
  for (const [key, config] of Object.entries(configs)) {
    if (config?.database?.slug === database) out.push(key);
  }
  return out.sort();
}

export type OverrideNextAction = {
  tool: string;
  reason: string;
  args_hint?: Record<string, unknown>;
  priority?: "required" | "recommended" | "optional";
};

/**
 * next_actions when mutate is refused for a non-local DB.
 * Requires a linked content type and a row slug to suggest override tools.
 */
export function nonLocalMutateOverrideNextActions(opts: {
  database: string;
  contentTypes: string[];
  slug: string | null | undefined;
  site?: string | null;
}): OverrideNextAction[] {
  const contentType = opts.contentTypes[0];
  const slug =
    typeof opts.slug === "string" && opts.slug.trim() ? opts.slug.trim() : null;
  if (!contentType || !slug) return [];

  const site = opts.site ?? undefined;
  return [
    {
      tool: "get_entry_fields",
      reason: "Inspect field provenance (original vs db_override vs ct_override) before writing",
      args_hint: { slug, contentType, ...(site ? { site } : {}) },
      priority: "recommended",
    },
    {
      tool: "update_entry_field",
      reason:
        "Set a CMS override (level=database for listings+pages, or level=content_type for page-only) — does not edit the upstream API row",
      args_hint: {
        slug,
        contentType,
        field: "title",
        level: "database",
        ...(site ? { site } : {}),
      },
      priority: "recommended",
    },
  ];
}

export function nonLocalMutateFailDetails(opts: {
  database: string;
  sourceType: string | null | undefined;
  contentTypes: string[];
  slug?: string | null;
  site?: string | null;
}): {
  code: string;
  source_type: string;
  linked_content_types: string[];
  entry_slug: string | null;
  warnings: DatabaseReadWarning[];
  next_actions: OverrideNextAction[];
} {
  const contentTypes = opts.contentTypes;
  const slug =
    typeof opts.slug === "string" && opts.slug.trim() ? opts.slug.trim() : null;
  const next_actions = nonLocalMutateOverrideNextActions({
    database: opts.database,
    contentTypes,
    slug,
    site: opts.site,
  });
  const warnings: DatabaseReadWarning[] = [];
  if (contentTypes.length === 0) {
    warnings.push({
      code: "no_linked_content_type",
      message: `No content type links database "${opts.database}" via database.slug — field overrides are not available for this bank. Edit the upstream source (or use a linked type).`,
    });
  } else if (!slug) {
    warnings.push({
      code: "override_needs_slug",
      message:
        "This database is linked to a content type, but no entry slug was available on the row. List/get the item, then call get_entry_fields / update_entry_field with its slug.",
    });
  } else {
    warnings.push({
      code: "use_field_overrides",
      message:
        "Customize mapped fields with update_entry_field (overrides). Do not use update_database_item / delete_database_item on api/remote databases.",
    });
  }
  return {
    code: "not_local_database",
    source_type: opts.sourceType ?? "unknown",
    linked_content_types: contentTypes,
    entry_slug: slug,
    warnings,
    next_actions,
  };
}
