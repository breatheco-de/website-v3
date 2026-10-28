import fs from "fs";
import os from "os";
import path from "path";
import * as yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRegistry } from "../content-types";
import { VersioningManager } from "./VersioningManager";
import { applyRunTransitions, latestRun, splitOf, type TestRuns } from "./test-runs";

const on = (allocation: number, started_at = "2026-10-01", slug = "a") => ({ en: { variants: [{ slug, allocation }], started_at } });

describe("applyRunTransitions", () => {
  it("opens a run when traffic starts and records its versions", () => {
    const runs: TestRuns = {};
    applyRunTransitions(runs, { contentType: "landing", slug: "promo", before: { en: { variants: [{ slug: "a", allocation: 0 }] } }, after: on(50), today: "2026-10-01" });
    expect(runs["landing:promo:en@2026-10-01"]).toMatchObject({ versions: ["a"], started_at: "2026-10-01", ended_at: null, split_changes: [] });
  });

  it("records split changes without restarting the run", () => {
    const runs: TestRuns = {};
    applyRunTransitions(runs, { contentType: "landing", slug: "promo", before: null, after: on(50), today: "2026-10-01" });
    applyRunTransitions(runs, { contentType: "landing", slug: "promo", before: on(50), after: on(10), today: "2026-10-05" });
    const run = runs["landing:promo:en@2026-10-01"]!;
    expect(run.ended_at).toBeNull();
    expect(run.split_changes).toEqual([{ day: "2026-10-05", from: { default: 50, a: 50 }, to: { default: 90, a: 10 } }]);
  });

  it("keeps a version that drops to 0% mid-run in the version list", () => {
    const runs: TestRuns = {};
    const two = (a: number, b: number) => ({ en: { variants: [{ slug: "a", allocation: a }, { slug: "b", allocation: b }], started_at: "2026-10-01" } });
    applyRunTransitions(runs, { contentType: "landing", slug: "promo", before: null, after: two(30, 30), today: "2026-10-01" });
    applyRunTransitions(runs, { contentType: "landing", slug: "promo", before: two(30, 30), after: two(0, 30), today: "2026-10-03" });
    expect(runs["landing:promo:en@2026-10-01"]!.versions).toEqual(["a", "b"]);
  });

  it("ends the run at 0% traffic and when versioning.yml is deleted", () => {
    const runs: TestRuns = {};
    applyRunTransitions(runs, { contentType: "landing", slug: "promo", before: on(50), after: on(0), today: "2026-10-09" });
    expect(runs["landing:promo:en@2026-10-01"]!.ended_at).toBe("2026-10-09");

    const other: TestRuns = {};
    applyRunTransitions(other, { contentType: "landing", slug: "promo", before: on(50), after: null, today: "2026-10-10" });
    expect(other["landing:promo:en@2026-10-01"]).toMatchObject({ ended_at: "2026-10-10", versions: ["a"] });
  });

  it("ignores writes that never had traffic", () => {
    const runs: TestRuns = {};
    expect(applyRunTransitions(runs, { contentType: "landing", slug: "promo", before: null, after: on(0), today: "2026-10-01" })).toBe(false);
    expect(runs).toEqual({});
  });
});

describe("latestRun", () => {
  it("prefers the running run, then the most recently ended", () => {
    const base = { content_type: "landing", slug: "promo", locale: "en", versions: ["a"], split_changes: [] };
    const runs: TestRuns = {
      "landing:promo:en@2026-08-01": { ...base, started_at: "2026-08-01", ended_at: "2026-08-20" },
      "landing:promo:en@2026-09-01": { ...base, started_at: "2026-09-01", ended_at: "2026-09-20" },
    };
    expect(latestRun(runs, "landing", "promo", "en")?.experiment_id).toBe("landing:promo:en@2026-09-01");
    runs["landing:promo:en@2026-10-01"] = { ...base, started_at: "2026-10-01", ended_at: null };
    expect(latestRun(runs, "landing", "promo", "en")?.experiment_id).toBe("landing:promo:en@2026-10-01");
    expect(latestRun(runs, "landing", "promo", "es")).toBeNull();
  });
});

describe("splitOf", () => {
  it("gives Default the remainder and drops it at 100%", () => {
    expect(splitOf({ variants: [{ slug: "a", allocation: 30 }] })).toEqual({ default: 70, a: 30 });
    expect(splitOf({ variants: [{ slug: "a", allocation: 100 }] })).toEqual({ a: 100 });
  });
});

describe("VersioningManager run history", () => {
  let tempDir: string;
  let contentRoot: string;
  let entryDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-runs-"));
    contentRoot = path.join(tempDir, "site_test");
    entryDir = path.join(contentRoot, "landings", "promo");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(contentRoot, "content-types.yml"),
      "landing:\n  directory: landings\n  url_pattern:\n    en: /en/landing/:slug\n",
      "utf-8",
    );
    fs.writeFileSync(path.join(entryDir, "en.yml"), "title: Live\nsections: []\n", "utf-8");
    resetRegistry(contentRoot);
  });

  afterEach(() => {
    resetRegistry(contentRoot);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("records runs from updateVersioning / deleteVersioningConfig and keeps them across an epoch reset", () => {
    fs.writeFileSync(path.join(entryDir, "versioning.yml"), yaml.dump({ en: { variants: [{ slug: "a", allocation: 0 }] } }), "utf-8");
    const vm = new VersioningManager(contentRoot);
    vm.updateVersioning("landing", "promo", on(50), { contentRoot });
    expect(vm.getLatestRun("landing", "promo", "en")).toMatchObject({ experiment_id: "landing:promo:en@2026-10-01", ended_at: null });

    vm.deleteVersioningConfig("landing", "promo", "agent", contentRoot);
    expect(vm.getLatestRun("landing", "promo", "en")?.ended_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    vm.flushState();

    const statePath = path.join(contentRoot, ".versioning-state.json");
    const saved = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    fs.writeFileSync(statePath, JSON.stringify({ ...saved, epoch: 1, counts: { x: 1 } }));
    const again = new VersioningManager(contentRoot);
    expect(again.getStats()).toEqual({});
    expect(again.getLatestRun("landing", "promo", "en")?.experiment_id).toBe("landing:promo:en@2026-10-01");
  });
});
