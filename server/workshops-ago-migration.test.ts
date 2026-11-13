import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseConfig } from "./database";
import type { ContentTypeEntry } from "./content-types";
import {
  DEFAULT_AGO_MS,
  NEW_CONSTRAINT,
  planWorkshopContentType,
  planWorkshopsDbConfig,
  preflightAgo,
  runWorkshopsAgoMigration,
  type FetchJson,
  type WorkshopsAgoDeps,
} from "./workshops-ago-migration";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-12T12:00:00Z");
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

const OLD_CONSTRAINT =
  "Only upcoming workshops and ones that ended in the last 12 months have a page; older ones 404. Finished pages offer the recording after signup/login, and finished workshops without a recording are noindex.";

function dbConfig(params: Record<string, unknown>): DatabaseConfig {
  return {
    name: "Workshops",
    source: { type: "api", api: { endpoint: "https://bc.example/v1/events/all", params } },
    field_mapping: { slug: "slug" },
  };
}

function workshopEntry(): ContentTypeEntry {
  return {
    directory: "workshop",
    url_pattern: { en: "/en/workshops/:slug" },
    database: { slug: "workshops" },
    field_mapping: { _slug: "slug", status: "status", is_recent: "function:abc", event_ended: "function:def" },
    entry_filters: [
      { item_property_slug: "status", value: ["ACTIVE", "FINISHED"] },
      { item_property_slug: "is_recent", value: "true" },
    ],
    editor: { is_recent: { type: "text" }, event_ended: { type: "text" } },
    strategy: { purpose: "Register people", constraints: [OLD_CONSTRAINT, "Keep conversion names consistent."] },
  } as unknown as ContentTypeEntry;
}

/** Fake Breathecode: `agoSupported` rejects ago=-1; `lowerBoundOnly` keeps upcoming events in the window. */
function fakeApi(opts: { agoSupported: boolean; lowerBoundOnly: boolean; upcoming?: number }): FetchJson {
  const upcoming = Array.from({ length: opts.upcoming ?? 2 }, (_, i) => ({
    slug: `next-${i}`,
    starting_at: iso(5 + i),
    ending_at: iso(5 + i),
  }));
  const recent = [{ slug: "recent", starting_at: iso(-30), ending_at: iso(-30) }];
  return async (url) => {
    const ago = new URL(url).searchParams.get("ago");
    if (!opts.agoSupported || ago == null) return { status: 200, body: upcoming };
    if (ago === "-1") return { status: 400, body: { detail: "invalid ago" } };
    return { status: 200, body: opts.lowerBoundOnly ? [...recent, ...upcoming] : recent };
  };
}

describe("planWorkshopsDbConfig", () => {
  it("replaces all_time with the default ago window", () => {
    const next = planWorkshopsDbConfig(dbConfig({ all_time: "true", is_public: "true" }));
    expect(next?.source.api?.params).toEqual({ is_public: "true", ago: String(DEFAULT_AGO_MS) });
  });

  it("keeps a staff-chosen ago and only drops all_time", () => {
    const next = planWorkshopsDbConfig(dbConfig({ all_time: "true", ago: "86400000" }));
    expect(next?.source.api?.params).toEqual({ ago: "86400000" });
  });

  it("returns null when the database already uses ago only", () => {
    expect(planWorkshopsDbConfig(dbConfig({ ago: "86400000" }))).toBeNull();
  });
});

describe("planWorkshopContentType", () => {
  it("removes the is_recent field, page filter and editor hint, and rewrites the strategy note", () => {
    const plan = planWorkshopContentType(workshopEntry());
    expect(plan?.field_mapping).not.toHaveProperty("is_recent");
    expect(plan?.field_mapping).toHaveProperty("event_ended");
    expect(plan?.entry_filters).toEqual([{ item_property_slug: "status", value: ["ACTIVE", "FINISHED"] }]);
    expect(plan?.editor).toEqual({ event_ended: { type: "text" } });
    expect(plan?.strategy?.constraints).toEqual([NEW_CONSTRAINT, "Keep conversion names consistent."]);
  });

  it("returns null once nothing is left to remove", () => {
    const entry = workshopEntry();
    const plan = planWorkshopContentType(entry)!;
    expect(planWorkshopContentType({ ...entry, ...plan } as ContentTypeEntry)).toBeNull();
  });
});

describe("preflightAgo", () => {
  const api = dbConfig({ is_public: "true", ago: String(DEFAULT_AGO_MS) }).source.api!;

  it("fails while Breathecode ignores ago", async () => {
    const res = await preflightAgo(api, fakeApi({ agoSupported: false, lowerBoundOnly: true }), NOW);
    expect(res).toMatchObject({ ok: false });
    expect(!res.ok && res.reason).toContain("does not support ago");
  });

  it("fails when ago drops upcoming workshops", async () => {
    const res = await preflightAgo(api, fakeApi({ agoSupported: true, lowerBoundOnly: false }), NOW);
    expect(!res.ok && res.reason).toContain("drops upcoming workshops");
  });

  it("fails when there is no upcoming workshop to confirm with", async () => {
    const res = await preflightAgo(api, fakeApi({ agoSupported: true, lowerBoundOnly: true, upcoming: 0 }), NOW);
    expect(!res.ok && res.reason).toContain("No upcoming workshops");
  });

  it("fails when the window returns events older than ago", async () => {
    const fetchJson: FetchJson = async (url) => {
      const ago = new URL(url).searchParams.get("ago");
      if (ago === "-1") return { status: 400, body: null };
      const next = [{ slug: "next", ending_at: iso(3) }];
      return { status: 200, body: ago == null ? next : [...next, { slug: "old", ending_at: iso(-500) }] };
    };
    const res = await preflightAgo(api, fetchJson, NOW);
    expect(!res.ok && res.reason).toContain("ended before the window");
  });

  it("passes when ago is live and keeps upcoming workshops", async () => {
    const res = await preflightAgo(api, fakeApi({ agoSupported: true, lowerBoundOnly: true }), NOW);
    expect(res).toEqual({ ok: true, windowCount: 3, upcoming: 2 });
  });
});

describe("runWorkshopsAgoMigration", () => {
  let tempDir: string;
  let root: string;
  let entry: ContentTypeEntry;
  let push: ReturnType<typeof vi.fn>;
  let refreshDb: ReturnType<typeof vi.fn>;
  let marked: string[];

  const dbPath = () => path.join(root, "db", "workshops", "config.yml");

  function deps(fetchJson: FetchJson): WorkshopsAgoDeps {
    return {
      sites: () => [{ name: "site_test", contentRoot: root }],
      pending: () => [],
      markModified: (abs) => marked.push(abs),
      push,
      fetchJson,
      contentType: () => entry,
      updateContentType: (_root, update) => {
        entry = { ...entry, ...update } as ContentTypeEntry;
      },
      refreshDb,
    };
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workshops-ago-"));
    root = path.join(tempDir, "site_test");
    fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
    fs.writeFileSync(dbPath(), yaml.dump(dbConfig({ all_time: "true", is_public: "true" }), { lineWidth: 120 }), "utf-8");
    entry = workshopEntry();
    push = vi.fn(async () => ({ success: true, commitHash: "abc123" }));
    refreshDb = vi.fn(async () => 3);
    marked = [];
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("changes nothing when Breathecode is not ready", async () => {
    const before = fs.readFileSync(dbPath(), "utf-8");
    const res = await runWorkshopsAgoMigration({
      dryRun: false,
      log: () => {},
      error: () => {},
      deps: deps(fakeApi({ agoSupported: false, lowerBoundOnly: true })),
    });
    expect(res.failed).toBe(true);
    expect(fs.readFileSync(dbPath(), "utf-8")).toBe(before);
    expect(entry.field_mapping).toHaveProperty("is_recent");
    expect(refreshDb).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("dry run checks the API but writes nothing", async () => {
    const before = fs.readFileSync(dbPath(), "utf-8");
    const res = await runWorkshopsAgoMigration({
      dryRun: true,
      log: () => {},
      error: () => {},
      deps: deps(fakeApi({ agoSupported: true, lowerBoundOnly: true })),
    });
    expect(res).toEqual({ failed: false, changed: 1 });
    expect(fs.readFileSync(dbPath(), "utf-8")).toBe(before);
    expect(push).not.toHaveBeenCalled();
  });

  it("switches to ago, refreshes before dropping the page rule, pushes, and is idempotent", async () => {
    const order: string[] = [];
    refreshDb.mockImplementation(async () => {
      order.push(`refresh:${entry.field_mapping && "is_recent" in entry.field_mapping ? "gated" : "ungated"}`);
      return 3;
    });
    const run = () =>
      runWorkshopsAgoMigration({
        dryRun: false,
        log: () => {},
        error: () => {},
        deps: deps(fakeApi({ agoSupported: true, lowerBoundOnly: true })),
      });

    const first = await run();
    expect(first).toEqual({ failed: false, changed: 1 });
    const written = yaml.load(fs.readFileSync(dbPath(), "utf-8")) as DatabaseConfig;
    expect(written.source.api?.params).toEqual({ is_public: "true", ago: String(DEFAULT_AGO_MS) });
    expect(order).toEqual(["refresh:gated"]);
    expect(entry.field_mapping).not.toHaveProperty("is_recent");
    expect(push).toHaveBeenCalledWith(
      "site_test",
      ["site_test/db/workshops/config.yml", "site_test/content-types.yml"],
      expect.any(String),
    );

    push.mockClear();
    const second = await run();
    expect(second).toEqual({ failed: false, changed: 0 });
    expect(push).not.toHaveBeenCalled();
  });
});
