import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { clearSiteSqliteCacheForTests } from "../db";
import { resetPipelineDbCache } from "../pipeline-db/runner";
import { seedDemoPipelineEvents } from "./seed-demo";
import { clearAllEvents, listEvents } from "./event-store";

const TEST_SITE = "site_seed_demo_test";

function testDbPath(): string {
  return path.join("data", TEST_SITE.replace(/\//g, "-"), "app.db");
}

describe("seedDemoPipelineEvents", () => {
  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    const dbPath = testDbPath();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  afterEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    const dbPath = testDbPath();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it("inserts a published historical batch without unpublished rows", () => {
    const { events, mode } = seedDemoPipelineEvents(TEST_SITE, "batch");
    expect(mode).toBe("batch");
    expect(events.length).toBeGreaterThanOrEqual(8);
    expect(events.every((e) => e.published)).toBe(true);
    expect(events.every((e) => e.cause === "demo-seed")).toBe(true);

    const listed = listEvents({ site: TEST_SITE, limit: 50 });
    expect(listed.length).toBe(events.length);
    const times = listed.map((e) => e.created_at);
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(60_000);
  });

  it("inserts a single live drip at now", () => {
    const { events, mode } = seedDemoPipelineEvents(TEST_SITE, "live", 2);
    expect(mode).toBe("live");
    expect(events).toHaveLength(1);
    expect(events[0]!.published).toBe(true);
    expect(events[0]!.payload.live).toBe(true);
    expect(events[0]!.payload.tick).toBe(2);
    clearAllEvents(TEST_SITE);
  });
});
