import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dump } from "js-yaml";
import type { ContentFile, ValidationContext } from "../shared/types";
import { resetRegistry } from "../../../server/content-types";

vi.mock("../../../server/redirects", () => ({
  createPublicUrlResolver: () => ({
    test: () => ({ pageExists: false }),
    isLive: (raw: string) => {
      const pathOnly = (raw.split(/[?#]/)[0] ?? raw).trim();
      return pathOnly === "/en/payment-component" || pathOnly === "/en/apply";
    },
  }),
}));

import { contentQualityValidator } from "./content-quality";

function tempYaml(data: Record<string, unknown>): { filePath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "content-quality-"));
  const filePath = join(dir, "en.yml");
  writeFileSync(filePath, dump(data));
  return { filePath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function context(file: ContentFile): ValidationContext {
  return {
    contentFiles: [file],
    redirectMap: new Map(),
    validUrls: new Set(),
    availableSchemas: new Set(),
    sitemapEntries: [],
  };
}

describe("contentQualityValidator SECTION_MISSING_TYPE", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
    resetRegistry();
  });

  it("flags a typeless leftover on a standalone page", async () => {
    const { filePath, cleanup } = tempYaml({
      sections: [
        { type: "hero", section_id: "hero-1", title: "Hi" },
        { section_id: "hero-1", title: "orphan copy" },
      ],
    });
    cleanups.push(cleanup);

    const result = await contentQualityValidator.run(
      context({
        slug: "home",
        title: "Home",
        type: "page",
        locale: "en",
        filePath,
      }),
    );
    const missing = result.errors.filter((e) => e.code === "SECTION_MISSING_TYPE");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.suggestion).toMatch(/does not render/i);
  });

  it("allows typeless overlay patches with section_id on attached shared-layout entries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "content-quality-overlay-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      join(dir, "content-types.yml"),
      `blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
    _slug: slug
    _locale: locale
  url_pattern:
    en: /en/blog/:slug
`,
    );
    const postDir = join(dir, "blog", "demo-post");
    mkdirSync(postDir, { recursive: true });
    writeFileSync(join(postDir, "_common.yml"), "title: Demo\nslug: demo-post\n");
    const filePath = join(postDir, "en.yml");
    writeFileSync(
      filePath,
      dump({
        title: "Demo",
        sections: [
          { section_id: "hero-1", title: "Custom" },
          { maxWidth: { desktop: "sm" } },
        ],
      }),
    );
    resetRegistry(dir);

    const result = await contentQualityValidator.run({
      contentFiles: [
        {
          slug: "demo-post",
          title: "Demo",
          type: "blog",
          locale: "en",
          filePath,
        },
      ],
      redirectMap: new Map(),
      validUrls: new Set(),
      availableSchemas: new Set(),
      sitemapEntries: [],
      contentRoot: dir,
    });

    const missing = result.errors.filter((e) => e.code === "SECTION_MISSING_TYPE");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toMatch(/identity-less stub/);
  });
});

describe("contentQualityValidator broken internal links", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it("does not flag a known path with query or hash", async () => {
    const { filePath, cleanup } = tempYaml({
      sections: [
        {
          type: "hero",
          cta: { url: "/en/payment-component?program=ai-fluency" },
        },
      ],
    });
    cleanups.push(cleanup);

    const file: ContentFile = {
      slug: "apply",
      title: "Apply",
      type: "page",
      locale: "en",
      filePath,
    };

    const result = await contentQualityValidator.run(context(file));
    expect(result.errors.filter((e) => e.code === "BROKEN_INTERNAL_LINK")).toEqual([]);
  });

  it("does not flag /en/apply (folder slug vs locale slug)", async () => {
    const { filePath, cleanup } = tempYaml({
      sections: [{ type: "hero", cta: { url: "/en/apply" } }],
    });
    cleanups.push(cleanup);

    const file: ContentFile = {
      slug: "payment-component",
      title: "Pay",
      type: "page",
      locale: "en",
      filePath,
    };

    const result = await contentQualityValidator.run(context(file));
    expect(result.errors.filter((e) => e.code === "BROKEN_INTERNAL_LINK")).toEqual([]);
  });

  it("still flags a path that does not resolve", async () => {
    const { filePath, cleanup } = tempYaml({
      sections: [
        {
          type: "hero",
          cta: { url: "/en/missing-page-xyz-not-real?program=ai-fluency" },
        },
      ],
    });
    cleanups.push(cleanup);

    const file: ContentFile = {
      slug: "apply",
      title: "Apply",
      type: "page",
      locale: "en",
      filePath,
    };

    const result = await contentQualityValidator.run(context(file));
    const broken = result.errors.filter((e) => e.code === "BROKEN_INTERNAL_LINK");
    expect(broken.length).toBeGreaterThan(0);
    expect(broken[0]?.message).toContain("/en/missing-page-xyz-not-real");
    expect(broken[0]?.message).toContain('component "hero"');
    expect(broken[0]?.suggestion).toMatch(/sections\[0\]/);
  });
});
