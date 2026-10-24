import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import * as yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRegistry } from "../content-types";
import { VersioningManager, VERSIONING_STATE_EPOCH } from "./VersioningManager";
import { pickVariant } from "./assignment";

let tempDir: string;
let contentRoot: string;
let entryDir: string;

const ids = Array.from({ length: 2000 }, (_, i) => crypto.createHash("sha256").update(`v-${i}`).digest("hex"));

function writeVersioning(data: unknown) {
  fs.writeFileSync(path.join(entryDir, "versioning.yml"), yaml.dump(data), "utf-8");
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-assign-"));
  contentRoot = path.join(tempDir, "site_test");
  entryDir = path.join(contentRoot, "landings", "promo");
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    "landing:\n  directory: landings\n  url_pattern:\n    en: /en/landing/:slug\n",
    "utf-8",
  );
  fs.writeFileSync(path.join(entryDir, "_common.yml"), "slug: promo\n", "utf-8");
  fs.writeFileSync(path.join(entryDir, "en.yml"), "title: Live\nsections: []\n", "utf-8");
  fs.writeFileSync(path.join(entryDir, "a.en.yml"), "title: A\nsections: []\n", "utf-8");
  fs.writeFileSync(path.join(entryDir, "b.en.yml"), "title: B\nsections: []\n", "utf-8");
  resetRegistry(contentRoot);
});

afterEach(() => {
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("getAssignment", () => {
  it("returns null and counts nothing without an active test", () => {
    writeVersioning({ en: { variants: [{ slug: "a", allocation: 0 }] } });
    const vm = new VersioningManager(contentRoot);
    expect(vm.getAssignment("landing", "promo", "en", ids[0])).toBeNull();
    expect(vm.getRunCounts("landing", "promo", "en")).toEqual({});
  });

  it("labels Default visitors and counts them as their own group", () => {
    writeVersioning({ en: { variants: [{ slug: "a", allocation: 30 }], started_at: "2026-10-01" } });
    const vm = new VersioningManager(contentRoot);
    const got = ids.map((id) => vm.getAssignment("landing", "promo", "en", id));
    const counts = vm.getRunCounts("landing", "promo", "en");
    expect(new Set(got)).toEqual(new Set(["a", "default"]));
    expect(counts.default + counts.a).toBe(ids.length);
    expect(counts.default / ids.length).toBeGreaterThan(0.65);
  });

  it("keeps everyone's version when the split changes (Default included)", () => {
    writeVersioning({ en: { variants: [{ slug: "a", allocation: 30 }], started_at: "2026-10-01" } });
    const vm = new VersioningManager(contentRoot);
    const first = ids.map((id) => vm.getAssignment("landing", "promo", "en", id)!);

    writeVersioning({ en: { variants: [{ slug: "a", allocation: 60 }], started_at: "2026-10-01" } });
    vm.clearCache();
    ids.forEach((id, i) => {
      expect(vm.getAssignment("landing", "promo", "en", id, { variantSlug: first[i], run: "2026-10-01" })).toBe(first[i]);
    });
  });

  it("re-splits visitors whose variant drops to 0%, keeps the others", () => {
    writeVersioning({
      en: { variants: [{ slug: "a", allocation: 30 }, { slug: "b", allocation: 30 }], started_at: "2026-10-01" },
    });
    const vm = new VersioningManager(contentRoot);
    const first = ids.map((id) => vm.getAssignment("landing", "promo", "en", id)!);

    writeVersioning({
      en: { variants: [{ slug: "a", allocation: 0 }, { slug: "b", allocation: 30 }], started_at: "2026-10-01" },
    });
    vm.clearCache();
    ids.forEach((id, i) => {
      const next = vm.getAssignment("landing", "promo", "en", id, { variantSlug: first[i], run: "2026-10-01" });
      if (first[i] === "a") expect(next).not.toBe("a");
      else expect(next).toBe(first[i]);
    });
  });

  it("re-splits everyone on a new run", () => {
    writeVersioning({ en: { variants: [{ slug: "a", allocation: 50 }], started_at: "2026-11-01" } });
    const vm = new VersioningManager(contentRoot);
    const variants = [{ slug: "a", allocation: 50 }];
    for (const id of ids.slice(0, 300)) {
      const got = vm.getAssignment("landing", "promo", "en", id, { variantSlug: "a", run: "2026-10-01" });
      expect(got).toBe(pickVariant(id, "landing:promo:en@2026-11-01", variants));
    }
  });

  it("moves Default visitors once Default has no share left", () => {
    writeVersioning({ en: { variants: [{ slug: "a", allocation: 100 }], started_at: "2026-10-01" } });
    const vm = new VersioningManager(contentRoot);
    expect(vm.getAssignment("landing", "promo", "en", ids[0], { variantSlug: "default", run: "2026-10-01" })).toBe("a");
  });

  it("does not count requests made with record: false (A/B check traffic)", () => {
    writeVersioning({ en: { variants: [{ slug: "a", allocation: 30 }], started_at: "2026-10-01" } });
    const vm = new VersioningManager(contentRoot);
    for (const id of ids.slice(0, 50)) vm.getAssignment("landing", "promo", "en", id, undefined, { record: false });
    expect(vm.getRunCounts("landing", "promo", "en")).toEqual({});
  });

  it("experiment id carries the run date", () => {
    writeVersioning({ en: { variants: [{ slug: "a", allocation: 30 }], started_at: "2026-10-01" } });
    const vm = new VersioningManager(contentRoot);
    expect(vm.getExperimentId("landing", "promo", "en")).toBe("landing:promo:en@2026-10-01");
  });
});

describe("state epoch", () => {
  it("archives old counts once and starts fresh", () => {
    const statePath = path.join(contentRoot, ".versioning-state.json");
    fs.writeFileSync(
      statePath,
      JSON.stringify({ counts: { "landing/promo/en/a": 99 }, visitors: { "landing/promo/en/a": ["x"] }, lastFlushed: 1 }),
    );
    const vm = new VersioningManager(contentRoot);
    expect(vm.getStats()).toEqual({});
    const archive = vm.getEpochArchivePath(1);
    expect(JSON.parse(fs.readFileSync(archive, "utf-8")).counts["landing/promo/en/a"]).toBe(99);
    expect(JSON.parse(fs.readFileSync(statePath, "utf-8")).epoch).toBe(VERSIONING_STATE_EPOCH);

    // Second load: nothing to archive, counts kept.
    writeVersioning({ en: { variants: [{ slug: "a", allocation: 30 }] } });
    vm.getAssignment("landing", "promo", "en", ids[0]);
    vm.flushState();
    const again = new VersioningManager(contentRoot);
    expect(Object.values(again.getStats()).reduce((n, v) => n + v, 0)).toBe(1);
  });
});
