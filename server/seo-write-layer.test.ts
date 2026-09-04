import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRegistry } from "./content-types";
import {
  assertSeoWriteLayerAllowed,
  SEO_DRAFT_WHILE_LIVE_FORBIDDEN,
  SEO_VARIANT_FORBIDDEN,
  yamlForPromotePreservingLiveSeo,
} from "./seo-write-layer";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-write-layer-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(path.join(contentRoot, "blog", "post-a"), { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  url_pattern:
    en: /en/blog/:slug
`,
    "utf-8",
  );
  resetRegistry();
  process.chdir(tempDir);
  resetRegistry(contentRoot);
});

afterEach(() => {
  resetRegistry();
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("assertSeoWriteLayerAllowed", () => {
  it("allows live locale", () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "en.yml"),
      "slug: post-a\n",
      "utf-8",
    );
    const gate = assertSeoWriteLayerAllowed({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      contentRoot,
    });
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.layer).toBe("live");
  });

  it("allows draft when no live locales exist", () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "draft.en.yml"),
      "slug: post-a\n",
      "utf-8",
    );
    const gate = assertSeoWriteLayerAllowed({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      variant: "draft",
      contentRoot,
    });
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.layer).toBe("draft_unpublished");
  });

  it("rejects draft while any live locale exists", () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "en.yml"),
      "slug: post-a\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "draft.en.yml"),
      "slug: post-a\n",
      "utf-8",
    );
    const gate = assertSeoWriteLayerAllowed({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      variant: "draft",
      contentRoot,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe(SEO_DRAFT_WHILE_LIVE_FORBIDDEN);
  });

  it("rejects A/B experiment variants", () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "en.yml"),
      "slug: post-a\n",
      "utf-8",
    );
    const gate = assertSeoWriteLayerAllowed({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      variant: "b",
      contentRoot,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe(SEO_VARIANT_FORBIDDEN);
  });
});

describe("yamlForPromotePreservingLiveSeo", () => {
  it("keeps live seo when promoting over an existing live file", () => {
    const live = `slug: post-a
seo:
  main_keyword: live-kw
  pillar_path: /en/blog/hub
sections:
  - type: hero
    title: Live
`;
    const variant = `slug: post-a
seo:
  main_keyword: variant-kw
  pillar_path: /en/blog/other
sections:
  - type: hero
    title: Variant
`;
    const { content, ignoredVariantSeo } = yamlForPromotePreservingLiveSeo(variant, live);
    expect(ignoredVariantSeo).toBe(true);
    expect(content).toContain("main_keyword: live-kw");
    expect(content).not.toContain("variant-kw");
    expect(content).toContain("title: Variant");
  });

  it("keeps draft seo on first go-live when no live file exists", () => {
    const draft = `slug: post-a
seo:
  main_keyword: draft-kw
sections:
  - type: hero
    title: Draft
`;
    const { content, ignoredVariantSeo } = yamlForPromotePreservingLiveSeo(draft, null);
    expect(ignoredVariantSeo).toBe(false);
    expect(content).toContain("main_keyword: draft-kw");
  });
});
