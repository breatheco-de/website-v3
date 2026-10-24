import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { funnelCompletenessValidator } from "./funnel-completeness";
import { invalidateTrackingKeyIndex } from "../../../server/product/tracking-key-index";
import { resetTrackingReadinessMemo } from "../../../server/product/tracking-readiness";
import type { ContentFile, ValidationContext } from "../shared/types";

const persona = (id: string, short_key?: string) => ({
  id,
  ...(short_key ? { short_key } : {}),
  role: id,
  avatar: { fears: ["f"], internal_dialogue: "d", objections: ["o"] },
});

describe("funnel-completeness tracking key checks", () => {
  let tmp = "";

  const write = (rel: string, doc: unknown) => {
    const p = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, yaml.dump(doc));
  };
  const file = (type: string, folder: string, slug: string): ContentFile => ({
    slug,
    title: slug,
    type,
    locale: "en",
    filePath: path.join(tmp, folder, slug, "en.yml"),
  });
  const ctx = (files: ContentFile[]): ValidationContext => ({
    contentRoot: tmp,
    contentFiles: files,
    redirectMap: new Map(),
    availableSchemas: new Set(),
    sitemapEntries: [],
  });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "funnel-tracking-"));
    invalidateTrackingKeyIndex();
    resetTrackingReadinessMemo();
    write("content-types.yml", { program: { directory: "programs" }, landing: { directory: "landings" } });
    write("programs/ai-flex/_product.yml", {
      purchasable: true,
      name: "AI Flex",
      short_key: "afx",
      personas: [persona("the-explorer", "exp"), persona("the-developer")],
    });
    write("programs/ai-engineering/_product.yml", {
      purchasable: true,
      name: "AI Engineering",
      short_key: "aie",
      personas: [persona("the-career-changer", "exp")],
    });
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("reports missing keys (not ready) with the fixer, and duplicate keys", async () => {
    const result = await funnelCompletenessValidator.run(
      ctx([file("program", "programs", "ai-flex"), file("program", "programs", "ai-engineering")]),
    );
    const notReady = result.warnings.filter((w) => w.code === "TRACKING_NOT_READY");
    expect(notReady).toHaveLength(1);
    expect(notReady[0].message).toMatch(/persona the-developer/);
    expect(notReady[0].fix?.fixerName).toBe("assign-tracking-short-keys");
    expect(notReady[0].file).toBe(path.join(tmp, "programs", "ai-flex", "_product.yml"));
    expect(result.warnings.filter((w) => w.code === "DUPLICATE_TRACKING_SHORT_KEY")).toHaveLength(2);
  });

  it("warns when a page's funnel is too long for Google Analytics", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ product: `some-long-product-slug-${i}` }));
    write("landings/apply/_common.yml", { funnel: { stage: "decision", products: many } });
    const result = await funnelCompletenessValidator.run(ctx([file("landing", "landings", "apply")]));
    const long = result.warnings.filter((w) => w.code === "TRACKING_VALUES_TOO_LONG");
    expect(long).toHaveLength(1);
    expect(long[0].file).toBe(path.join(tmp, "landings", "apply", "_common.yml"));
  });
});
