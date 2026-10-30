import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editContent, liveLocaleFunnelWriteError } from "./content-editor";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

const EN_WITH_LEGACY_FUNNEL = `meta:
  page_title: Home
  description: Home page for tests.
funnel:
  stage: consideration
  products:
    - product: ai-flex
      persona: the-explorer
sections:
  - type: hero
    section_id: hero-1
    title: Hello
`;

function writePageSite(enYml: string) {
  fs.mkdirSync(path.join(contentRoot, "pages", "home"), { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `page:
  directory: pages
  field_mapping:
    title: title
    _slug: slug
    _locale: locale
  url_pattern:
    en: /en/:slug
`,
    "utf-8",
  );
  fs.writeFileSync(path.join(contentRoot, "pages", "home", "_common.yml"), "title: Home\nslug: home\n", "utf-8");
  fs.writeFileSync(path.join(contentRoot, "pages", "home", "en.yml"), enYml, "utf-8");
}

describe("liveLocaleFunnelWriteError", () => {
  const funnel = { stage: "awareness", products: [{ product: "ai-flex" }] };

  it("blocks adding or changing a funnel", () => {
    expect(liveLocaleFunnelWriteError({}, { funnel })).toMatch(/_common\.yml/);
    expect(liveLocaleFunnelWriteError({ funnel }, { funnel: { ...funnel, stage: "decision" } })).toMatch(/_common\.yml/);
  });

  it("allows an untouched legacy copy and its removal", () => {
    expect(liveLocaleFunnelWriteError({ funnel }, { funnel, title: "x" })).toBeNull();
    expect(liveLocaleFunnelWriteError({ funnel }, { title: "x" })).toBeNull();
    expect(liveLocaleFunnelWriteError({}, { title: "x" })).toBeNull();
  });
});

describe("editContent: funnel in a live language file", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "funnel-guard-"));
    contentRoot = path.join(tempDir, "site_test");
    fs.mkdirSync(contentRoot, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    resetRegistry(contentRoot);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects an op that changes a legacy language funnel and leaves the file alone", async () => {
    writePageSite(EN_WITH_LEGACY_FUNNEL);
    resetRegistry(contentRoot);
    const result = await editContent({
      contentType: "page",
      slug: "home",
      locale: "en",
      operations: [{ action: "add_item", path: "funnel.products", item: { product: "ai-engineering" } }],
      contentRoot,
      ci: new ContentIndex(contentRoot),
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("funnel_in_language_file");
    expect(fs.readFileSync(path.join(contentRoot, "pages", "home", "en.yml"), "utf-8")).toBe(EN_WITH_LEGACY_FUNNEL);
  });

  it("an unrelated edit still saves while the legacy copy is untouched", async () => {
    writePageSite(EN_WITH_LEGACY_FUNNEL);
    resetRegistry(contentRoot);
    const result = await editContent({
      contentType: "page",
      slug: "home",
      locale: "en",
      operations: [{ action: "update_field", path: "sections.0.title", value: "Hi" }],
      contentRoot,
      ci: new ContentIndex(contentRoot),
    });
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(contentRoot, "pages", "home", "en.yml"), "utf-8")).toMatch(/title: Hi/);
  });
});
