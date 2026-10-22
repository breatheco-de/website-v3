import path from "path";
import { describe, expect, it } from "vitest";
import { countEntrySourceBranches } from "./entry-source-guard";

type Allowed = { count: number; reason: string };

const CONFIG = "database config / admin (not entry resolution)";
const CREATE = "creatability: new database items are made in the source, not as files (create_entry block)";

/**
 * Every remaining place that asks "is this entry from a database?". Entry reads
 * go through server/entry-layer.ts; lower the count (or drop the row) when a
 * branch is removed. New rows need a one-line reason.
 */
const ENTRY_SOURCE_ALLOWLIST: Record<string, Allowed> = {
  "server/entry-layer.ts": { count: 5, reason: "the one place that finds a type's database (items, status, listing fetch, delivery refresh)" },
  "server/database.ts": { count: 6, reason: "defines the database readers" },
  "shared/sharedLayoutPaths.ts": { count: 1, reason: "typeUsesSharedTemplate: database types always use a shared template" },
  "server/content-types.ts": { count: 13, reason: "content type registry: getDatabaseName/hasDatabaseSingle definitions + field_mapping reserved keys" },

  "client/src/pages/ContentTypeManagePage.tsx": { count: 44, reason: CONFIG },
  "client/src/components/editing/SingleVariablePickerModal.tsx": { count: 6, reason: "variable picker lists database columns for {{ entry.* }}" },
  "client/src/components/editing/MappingFieldsTab.tsx": { count: 5, reason: CONFIG },
  "client/src/components/editing/DeprecateFieldPanel.tsx": { count: 3, reason: CONFIG },
  "client/src/components/editing/RebuildContentUrlsHint.tsx": { count: 1, reason: CONFIG },
  "mcp-server/lib/content-type-field-mcp.ts": { count: 6, reason: CONFIG },
  "mcp-server/lib/content-type-field-patch.ts": { count: 5, reason: CONFIG },
  "mcp-server/lib/content-type-field-validate.ts": { count: 3, reason: CONFIG },
  "mcp-server/lib/database-items.ts": { count: 1, reason: CONFIG },
  "server/database-usage.ts": { count: 2, reason: CONFIG },
  "server/convert-content-type-to-static.ts": { count: 2, reason: "one-off conversion of a database type into files" },
  "server/routes/webhooks.ts": { count: 3, reason: "webhook refreshes the database behind a type" },
  "server/events/schedule-html-from-event.ts": { count: 1, reason: "database refresh event: maps refreshed rows to the page URLs to rebuild" },
  "server/live-request.ts": { count: 1, reason: "re-runs content type functions against the raw database row (before mapping)" },
  "server/media-gallery.ts": { count: 1, reason: "image usage scan reads database image columns" },
  "server/dynamic-entries.ts": { count: 1, reason: "listing sections that point straight at a database" },
  "server/listing-search.ts": { count: 1, reason: "vector search index is per database" },
  "server/relation-extract.ts": { count: 2, reason: "relation fields point at a database" },
  "scripts/validation/validators/relation-targets.ts": { count: 3, reason: "relation fields point at a database" },
  "scripts/validation/validators/editor-field-types.ts": { count: 2, reason: "relation fields point at a database" },
  "scripts/validation/validators/database-singles.ts": { count: 1, reason: "checks the database template setup" },
  "scripts/validation/fixers/db-template-restore.ts": { count: 1, reason: "restores the database template setup" },
  "server/mapped-fields-storage.ts": { count: 1, reason: "where mapped field values are stored (root keys vs field_overrides)" },
  "server/field-overrides.ts": { count: 2, reason: "field_overrides bag vs static file write target" },
  "scripts/perf/entry-unify-bench.ts": { count: 1, reason: "bench picks a database item to measure" },
  "scripts/stress/run.ts": { count: 1, reason: "stress harness picks a database item to measure" },

  "mcp-server/lib/entry-helpers.ts": { count: 1, reason: CREATE },
  "server/content-proposals/service.ts": { count: 2, reason: CREATE },
  "server/draft-entry.ts": { count: 1, reason: CREATE },
  "scripts/validation/shared/contentLoader.ts": { count: 1, reason: "folder scan: database pages come from listEntryKeys" },
  "scripts/validation/validators/static-field-overrides.ts": { count: 1, reason: "static-only bag check (database pages use field_overrides)" },

  "mcp-server/lib/content.ts": { count: 2, reason: "isDbBacked definition: db_backed flag on type listings + create_entry block" },
  "mcp-server/tools/pages.ts": { count: 7, reason: "create_entry block, db_backed flag, level=database overrides.json path" },
  "server/content-index.ts": { count: 7, reason: "file-path fallbacks for entries without a folder + listing URL match (Phase 2 delivery)" },
  "server/sitemap.ts": { count: 3, reason: "picks which types list pages from items (Phase 2 delivery)" },
  "server/query-entries.ts": { count: 1, reason: "listing reads the type's database rows" },
  "server/content-editor.ts": { count: 2, reason: "Phase 2 delivery" },

  "server/routes/content.ts": { count: 28, reason: "content type manage API: database config, listings, field override writes" },
  "server/initial-data-middleware.ts": { count: 2, reason: "content types payload: has_database flag and database slug" },
  "server/routes/seo.ts": { count: 2, reason: "SEO preview: database pages show merged live meta (no entry file holds it), live-only contexts" },
};

describe("entry source guard", () => {
  const counts = countEntrySourceBranches(path.resolve(__dirname, ".."));

  it("has no new database-source branches outside the allowlist", () => {
    const unexpected = Object.entries(counts)
      .filter(([file, n]) => n > (ENTRY_SOURCE_ALLOWLIST[file]?.count ?? 0))
      .map(([file, n]) => `${file}: ${n} (allowed ${ENTRY_SOURCE_ALLOWLIST[file]?.count ?? 0})`);
    expect(unexpected, "Resolve entries through server/entry-layer.ts or add an allowlist row with a reason").toEqual([]);
  });

  it("shrinks the allowlist when branches are removed", () => {
    const stale = Object.entries(ENTRY_SOURCE_ALLOWLIST)
      .filter(([file, allowed]) => (counts[file] ?? 0) < allowed.count)
      .map(([file, allowed]) => `${file}: ${counts[file] ?? 0} (allowlist says ${allowed.count})`);
    expect(stale, "Lower the allowlist count to match").toEqual([]);
  });

  it("gives every allowlist row a reason", () => {
    const missing = Object.entries(ENTRY_SOURCE_ALLOWLIST).filter(([, a]) => !a.reason.trim());
    expect(missing).toEqual([]);
  });
});
