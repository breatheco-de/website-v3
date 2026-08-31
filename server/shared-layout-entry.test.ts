import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  TEMPLATE_VERSIONING_SLUG,
  isTemplateVersioningSlug,
  resolvePreviewBaseSlug,
  stripStructuralOverlayKeys,
  attachedOverlayStructureError,
  hasEntryLevelVersioning,
  resolveVersioningReadSlug,
  resolveWritableVersioningTarget,
  versioningContentSlug,
} from "./shared-layout-entry";
import { applyPerEntryLayer } from "./section-merge";
import { buildHtmlCacheKey } from "./html-page-cache";
import { resetRegistry } from "./content-types";

describe("shared-layout-entry helpers", () => {
  it("recognizes template versioning slug", () => {
    expect(TEMPLATE_VERSIONING_SLUG).toBe("template");
    expect(isTemplateVersioningSlug("template")).toBe(true);
    expect(isTemplateVersioningSlug("single")).toBe(true);
    expect(isTemplateVersioningSlug("my-post")).toBe(false);
  });

  it("resolvePreviewBaseSlug skips the template shell and maps locale slugs", () => {
    const ci = {
      resolveBaseSlug: (slug: string, type: string) =>
        slug === "what-is-cloudflare-os-open-source-agent-workspace" && type === "blog"
          ? "cloudflareos"
          : slug,
    };
    expect(resolvePreviewBaseSlug("template", "blog", ci)).toBe("template");
    expect(resolvePreviewBaseSlug("single", "blog", ci)).toBe("single");
    expect(
      resolvePreviewBaseSlug(
        "what-is-cloudflare-os-open-source-agent-workspace",
        "blog",
        ci,
      ),
    ).toBe("cloudflareos");
    expect(resolvePreviewBaseSlug("cloudflareos", "blog", ci)).toBe("cloudflareos");
  });

  it("strips sections and layout for re-attach", () => {
    const stripped = stripStructuralOverlayKeys({
      title: "Hi",
      sections: [{ type: "hero" }],
      layout: { menu: { top: "nav" } },
      meta: { page_title: "t" },
    });
    expect(stripped).toEqual({ title: "Hi", meta: { page_title: "t" } });
  });

  it("flags attached overlay structure", () => {
    expect(attachedOverlayStructureError({ title: "ok" })).toBeNull();
    expect(attachedOverlayStructureError({ sections: [{ type: "x" }] })).toMatch(/sections/);
    expect(attachedOverlayStructureError({ layout: {} })).toMatch(/layout/);
  });
});

describe("applyPerEntryLayer dataOnly", () => {
  it("ignores sections and layout when dataOnly", () => {
    const base = {
      title: "template",
      sections: [{ type: "hero", section_id: "h1" }],
      layout: { menu: { top: "default" } },
    };
    const overlay = {
      title: "entry",
      sections: [{ section_id: "h1", _remove: true }],
      layout: { menu: { top: "custom" } },
      meta: { description: "d" },
    };
    const merged = applyPerEntryLayer(base, overlay, undefined, undefined, true);
    expect(merged.title).toBe("entry");
    expect(merged.meta).toEqual({ description: "d" });
    expect(merged.sections).toEqual(base.sections);
    expect(merged.layout).toEqual(base.layout);
  });

  it("applies sections when not dataOnly", () => {
    const base = {
      sections: [{ type: "hero", section_id: "h1", heading: "A" }],
    };
    const overlay = {
      sections: [{ section_id: "h1", heading: "B" }],
    };
    const merged = applyPerEntryLayer(base, overlay, undefined, undefined, false);
    expect((merged.sections as Record<string, unknown>[])[0].heading).toBe("B");
  });
});

describe("html-page-cache variant keys", () => {
  it("includes variant in cache key", () => {
    expect(buildHtmlCacheKey("site", "/blog/post")).toBe("site::/blog/post::live");
    expect(buildHtmlCacheKey("site", "/blog/post", "draft")).toBe("site::/blog/post::draft");
    expect(buildHtmlCacheKey("site", "/blog/post?x=1", "default")).toBe("site::/blog/post::live");
  });
});

describe("entry-level versioning vs template", () => {
  const ORIGINAL_CWD = process.cwd();
  let tempDir: string;
  let contentRoot: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "entry-ver-"));
    contentRoot = path.join(tempDir, "site_test");
    fs.mkdirSync(path.join(contentRoot, "blog"), { recursive: true });
    fs.writeFileSync(
      path.join(contentRoot, "content-types.yml"),
      `blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
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

  it("allows writable entry slug while attached (translate drafts)", () => {
    const r = resolveWritableVersioningTarget("blog", "my-post", contentRoot);
    expect(r).toEqual({ ok: true, slug: "my-post", templateMode: false });
  });

  it("allows writable template slug single", () => {
    const r = resolveWritableVersioningTarget("blog", "single", contentRoot);
    expect(r).toEqual({ ok: true, slug: "template", templateMode: true });
    const r2 = resolveWritableVersioningTarget("blog", "template", contentRoot);
    expect(r2).toEqual({ ok: true, slug: "template", templateMode: true });
  });

  it("traffic slug stays template for attached; read slug prefers entry drafts", () => {
    const entryDir = path.join(contentRoot, "blog", "my-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "_common.yml"), "slug: my-post\n");

    expect(versioningContentSlug("blog", "my-post", contentRoot)).toBe("template");
    expect(resolveVersioningReadSlug("blog", "my-post", contentRoot)).toBe("template");
    expect(hasEntryLevelVersioning("blog", "my-post", contentRoot)).toBe(false);

    fs.writeFileSync(path.join(entryDir, "draft.es.yml"), "title: Hola\n");
    fs.writeFileSync(
      path.join(entryDir, "versioning.yml"),
      "es:\n  variants:\n    - slug: draft\n      allocation: 0\n",
    );

    expect(hasEntryLevelVersioning("blog", "my-post", contentRoot)).toBe(true);
    expect(resolveVersioningReadSlug("blog", "my-post", contentRoot)).toBe("my-post");
    // Live traffic assignment must still use the shared template
    expect(versioningContentSlug("blog", "my-post", contentRoot)).toBe("template");
  });
});
