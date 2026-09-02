import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import type { ContentEvent } from "./types";
import { clearAllEvents, listEvents, replaceEventsFromSnapshot } from "./event-store";

const TEST_SITE = "site_pull_prod_test";

function dbPath(): string {
  return path.join("data", TEST_SITE.replace(/\//g, "-"), "app.db");
}

function sampleEvent(id: number, createdAt: number): ContentEvent {
  return {
    id,
    type: "entry_locale_saved",
    site: TEST_SITE,
    resource: { contentType: "blog", slug: "post", locale: "en" },
    attribution: [{ author: "staff", actor: { type: "ui" } }],
    payload: { demo: true },
    published: false,
    created_at: createdAt,
  };
}

describe("replaceEventsFromSnapshot", () => {
  beforeEach(() => {
    try {
      fs.rmSync(path.dirname(dbPath()), { recursive: true, force: true });
    } catch {
      /* ok */
    }
  });

  afterEach(() => {
    clearAllEvents(TEST_SITE);
    try {
      fs.rmSync(path.dirname(dbPath()), { recursive: true, force: true });
    } catch {
      /* ok */
    }
  });

  it("replaces local rows and preserves ids and timestamps", () => {
    const events = [sampleEvent(42, 1_700_000_000_000), sampleEvent(99, 1_700_000_100_000)];
    const count = replaceEventsFromSnapshot(TEST_SITE, events);
    expect(count).toBe(2);

    const listed = listEvents({ site: TEST_SITE, limit: 10 });
    expect(listed.map((e) => e.id).sort((a, b) => a - b)).toEqual([42, 99]);
    expect(listed.every((e) => e.published)).toBe(true);
  });
});

describe("pullProductionEvents", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    try {
      fs.rmSync(path.dirname(dbPath()), { recursive: true, force: true });
    } catch {
      /* ok */
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    try {
      fs.rmSync(path.dirname(dbPath()), { recursive: true, force: true });
    } catch {
      /* ok */
    }
  });

  it("requires a staff token", async () => {
    const { pullProductionEvents } = await import("./pull-production");
    const result = await pullProductionEvents(TEST_SITE, null, "https://prod.example");
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/login/i);
  });

  it("imports paginated production events", async () => {
    const page1 = {
      events: Array.from({ length: 500 }, (_, i) => sampleEvent(1000 - i, 1000 - i)),
    };
    const page2 = { events: [sampleEvent(500, 500)] };

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const before = url.searchParams.get("before");
      const body = before ? page2 : page1;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;

    const { pullProductionEvents } = await import("./pull-production");
    const result = await pullProductionEvents(TEST_SITE, "token-abc", "https://prod.example");

    expect(result.success).toBe(true);
    expect(result.imported).toBe(501);
    expect(listEvents({ site: TEST_SITE, limit: 600 })).toHaveLength(501);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
