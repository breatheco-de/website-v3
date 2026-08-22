import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentIndex } from "./content-index";

const tmpDirs: string[] = [];

function makeSite(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "content-index-refresh-"));
  tmpDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "content-types.yml"),
    [
      "page:",
      "  directory: pages",
      "  url_pattern:",
      "    en: /en/:slug",
      "",
    ].join("\n"),
    "utf-8",
  );
  fs.mkdirSync(path.join(dir, "pages", "home"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "pages", "home", "en.yml"),
    "title: Home\nslug: home\nlayout:\n  menu:\n    top: main\n",
    "utf-8",
  );
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("ContentIndex.refresh serialization", () => {
  it("coalesces an overlapping syncSlow refresh into one follow-up scan", () => {
    const root = makeSite();
    const ci = new ContentIndex(root);

    let scans = 0;
    const originalScan = (ci as any).scan.bind(ci) as () => void;
    (ci as any).scan = () => {
      scans += 1;
      if (scans === 1) {
        ci.refresh({ syncSlow: true });
      }
      originalScan();
    };

    ci.refresh({ syncSlow: true });
    expect(scans).toBe(2);
  });

  it("async refresh calls scanFast and startSlowScanAsync without sync scan", () => {
    const root = makeSite();
    const ci = new ContentIndex(root);
    const scanFast = vi.spyOn(ci, "scanFast");
    const startSlow = vi.spyOn(ci, "startSlowScanAsync");
    const scan = vi.spyOn(ci as any, "scan");

    ci.refresh();

    expect(scanFast).toHaveBeenCalledTimes(1);
    expect(startSlow).toHaveBeenCalledTimes(1);
    expect(scan).not.toHaveBeenCalled();
  });
});

describe("ContentIndex.scanFast preserves slow maps", () => {
  it("keeps menu usage until scanSlow swaps", () => {
    const root = makeSite();
    const ci = new ContentIndex(root);
    ci.scanFast();
    ci.scanSlow();

    expect(ci.getMenuUsageByMenuId("main").length).toBeGreaterThan(0);

    // Mutate live map then scanFast — should still see previous menu usage
    const before = ci.getMenuUsageByMenuId("main");
    ci.scanFast();
    expect(ci.getMenuUsageByMenuId("main")).toEqual(before);

    ci.scanSlow();
    expect(ci.getMenuUsageByMenuId("main").length).toBeGreaterThan(0);
  });
});
