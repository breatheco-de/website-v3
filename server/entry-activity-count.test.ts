import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { ENTRY_ACTIVITY_WINDOW_DAYS } from "@shared/event-log-filters";
import { clearAllEvents, emitEvent, singleAttribution } from "./events/event-store";
import { clearSiteSqliteCacheForTests } from "./db";
import { resetPipelineDbCache } from "./pipeline-db/runner";
import { countEntryActivityWrites } from "./seo-cluster-metrics";

describe("entry activity count (Ask gate API source)", () => {
  const site = "site_test-ask-activity-count";

  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    const dbPath = path.join("data", site, "app.db");
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  afterEach(() => {
    clearAllEvents(site);
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
  });

  it("returns writeCount for an entry in the rolling window", () => {
    emitEvent({
      site,
      type: "entry_locale_saved",
      resource: { contentType: "page", slug: "home", locale: "en" },
      attribution: singleAttribution("jane", { type: "ui" }),
    });
    emitEvent({
      site,
      type: "entry_locale_saved",
      payload: { entryKey: "page/home/en" },
      attribution: singleAttribution("claude", {
        type: "mcp",
        client: "Cursor",
        model: "claude-4-sonnet",
      }),
    });
    const counts = countEntryActivityWrites({ site });
    expect(counts.get("page/home/en")).toBe(2);
    expect({
      entryKey: "page/home/en",
      writeCount: counts.get("page/home/en") ?? 0,
      windowDays: ENTRY_ACTIVITY_WINDOW_DAYS,
    }).toEqual({
      entryKey: "page/home/en",
      writeCount: 2,
      windowDays: 14,
    });
  });

  it("defaults missing entries to 0", () => {
    const counts = countEntryActivityWrites({ site });
    expect(counts.get("page/missing/en") ?? 0).toBe(0);
  });
});
