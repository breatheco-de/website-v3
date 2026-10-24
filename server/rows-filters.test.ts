import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeFunctionMapping } from "@shared/functionEncoding";
import { ROWS_FILTER_MAX } from "@shared/validateEditorFieldTypes";
import { getRowsFilterFields, resetRegistry } from "./content-types";
import { applyRowsFilterFields, mapDatabaseItemsForEntry } from "./database-single-loader";
import { applyEntryFilters } from "./entry-layer";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

const seriesTotal = encodeFunctionMapping(`(value, item) => {
  const group = item && item.event_group;
  if (group == null || String(group).trim() === "") return 1;
  const sessions = Array.isArray(item.group_sessions) ? item.group_sessions : [];
  return sessions.length === 0 ? 1 : sessions.length;
}`);

const redirectTo = encodeFunctionMapping(`(value, item) => {
  const group = item && item.event_group;
  const sessions = Array.isArray(item.group_sessions) ? item.group_sessions : [];
  if (group == null || String(group).trim() === "" || sessions.length === 0) return "";
  const start = (e) => new Date(e && e.starting_at).getTime();
  const end = (e) => new Date(e && (e.ending_at || e.ended_at)).getTime();
  const now = Date.now();
  const byStart = sessions.slice().sort((a, b) => start(a) - start(b));
  const inProgress = byStart.find((e) => start(e) <= now && now < end(e));
  const upcoming = byStart.find((e) => start(e) > now);
  const rep = inProgress || upcoming || byStart[byStart.length - 1];
  if (!rep) return "";
  if (item.id != null && rep.id === item.id) return "";
  if (item.slug && rep.slug === item.slug) return "";
  const slug = String(rep.slug || "").trim();
  if (!slug) return "";
  const es = String(rep.lang || "").toLowerCase().startsWith("es");
  return (es ? "/es/workshop/" : "/en/workshop/") + slug;
}`);

const seriesSignupNote = encodeFunctionMapping(`(value, item) => {
  const group = item && item.event_group;
  if (group == null || String(group).trim() === "") return "";
  const sessions = Array.isArray(item.group_sessions) ? item.group_sessions : [];
  const count = sessions.length;
  if (count < 2) return "";
  const es = String((item && item.lang) || "").toLowerCase().startsWith("es");
  if (es) return "Este workshop forma parte de una serie de " + count + " sesiones, así que quedaste inscrito en las sesiones que siguen abiertas.";
  return "This workshop is part of a series of " + count + " sessions, so you were registered for the sessions that are still open.";
}`);

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rows-filters-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `workshop:
  directory: workshop
  url_pattern:
    en: /en/workshop/:slug
  database:
    slug: workshops
  entry_filters:
    - item_property_slug: status
      value: ACTIVE
  field_mapping:
    _slug: slug
    group_sessions:
      rows_filters:
        - rows_property_slug: event_group
          value_from_current_row: event_group
    series_total: ${JSON.stringify(seriesTotal)}
    series_signup_note: ${JSON.stringify(seriesSignupNote)}
    redirectTo: ${JSON.stringify(redirectTo)}
`,
    "utf-8",
  );
  process.chdir(tempDir);
  resetRegistry(contentRoot);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function row(partial: Record<string, unknown>) {
  return { status: "ACTIVE", featured: true, ...partial };
}

describe("applyRowsFilterFields", () => {
  const filters = [{ rows_property_slug: "event_group", value_from_current_row: "event_group" }];

  it("groups every language and finished row, and skips an empty event_group", () => {
    const items = [
      row({ slug: "a", event_group: "g", lang: "en" }),
      row({ slug: "b", event_group: "g", lang: "es", status: "FINISHED" }),
      row({ slug: "c", event_group: "", lang: "en" }),
      row({ slug: "d", event_group: "other", lang: "en" }),
    ];
    const mapped = applyRowsFilterFields(items, [{ field: "group_sessions", filters }]);
    expect(mapped[0]!.group_sessions).toHaveLength(2);
    expect(mapped[0]!.group_sessions).toBe(mapped[1]!.group_sessions);
    expect(mapped[2]!.group_sessions).toEqual([]);
    expect(mapped[3]!.group_sessions).toHaveLength(1);
    expect(items[0]).not.toHaveProperty("group_sessions");
  });

  it("leaves the field empty when a bucket is over the cap", () => {
    const items = Array.from({ length: ROWS_FILTER_MAX + 1 }, (_, i) =>
      row({ slug: `s${i}`, event_group: "big" }),
    );
    const mapped = applyRowsFilterFields(items, [{ field: "group_sessions", filters }], {
      contentType: "workshop",
    });
    expect(mapped[0]!.group_sessions).toEqual([]);
    expect(mapped[ROWS_FILTER_MAX]!.group_sessions).toBe(mapped[0]!.group_sessions);
  });
});

describe("mapDatabaseItemsForEntry series fields", () => {
  it("computes series_total from group_sessions before functions", () => {
    const items = [
      row({ slug: "day-1", id: 1, event_group: "g", lang: "en", starting_at: "2026-01-01T00:00:00Z" }),
      row({ slug: "day-2", id: 2, event_group: "g", lang: "es", starting_at: "2026-01-02T00:00:00Z", status: "FINISHED" }),
      row({ slug: "solo", id: 3, event_group: "" }),
    ];
    const mapped = mapDatabaseItemsForEntry(items, "workshop", contentRoot);
    const day1 = mapped.find((item) => item.slug === "day-1");
    const finished = mapped.find((item) => item.slug === "day-2");
    const solo = mapped.find((item) => item.slug === "solo");
    expect(day1?.series_total).toBe(2);
    expect(finished?.series_total).toBe(2);
    expect(solo?.series_total).toBe(1);
    expect(day1?.series_signup_note).toBe(
      "This workshop is part of a series of 2 sessions, so you were registered for the sessions that are still open.",
    );
    expect(finished?.series_signup_note).toBe(
      "Este workshop forma parte de una serie de 2 sesiones, así que quedaste inscrito en las sesiones que siguen abiertas.",
    );
    expect(solo?.series_signup_note).toBe("");
    expect(getRowsFilterFields("workshop", contentRoot)).toEqual([
      { field: "group_sessions", filters },
    ]);
  });
});

const filters = [{ rows_property_slug: "event_group", value_from_current_row: "event_group" }];

describe("mapDatabaseItemsForEntry redirectTo", () => {
  it("points other sessions at the representative URL and leaves the representative empty", () => {
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const later = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const items = [
      row({ slug: "day-1", id: 1, event_group: "g", lang: "es", starting_at: soon, ending_at: later }),
      row({ slug: "day-2", id: 2, event_group: "g", lang: "en", starting_at: later, ending_at: later }),
      row({ slug: "solo", id: 3, event_group: "" }),
    ];
    const mapped = mapDatabaseItemsForEntry(items, "workshop", contentRoot);
    expect(mapped.find((item) => item.slug === "day-1")?.redirectTo).toBe("");
    expect(mapped.find((item) => item.slug === "day-2")?.redirectTo).toBe("/es/workshop/day-1");
    expect(mapped.find((item) => item.slug === "solo")?.redirectTo).toBe("");
  });
});

describe("applyEntryFilters", () => {
  it("keeps active rows and drops finished ones", () => {
    const items = [
      row({ slug: "live" }),
      row({ slug: "done", status: "FINISHED" }),
      row({ slug: "plain" }),
    ];
    const pages = applyEntryFilters(items, "workshop", contentRoot);
    expect(pages.map((item) => item.slug)).toEqual(["live", "plain"]);
  });
});
