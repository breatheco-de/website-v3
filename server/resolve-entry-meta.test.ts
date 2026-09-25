import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveEntryMeta } from "./resolve-entry-meta";
import { resetVariableManagerCache } from "./variable-manager";

describe("resolveEntryMeta", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-entry-meta-"));
    fs.writeFileSync(
      path.join(root, "content-types.yml"),
      [
        "landing:",
        "  directory: landings",
        "  field_mapping:",
        "    title: hero.title",
        "    _slug: slug",
        "  url_pattern:",
        "    default: /landing/:slug",
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(root, "variables.yml"),
      ["global.brand_suffix:", '  default: "4Geeks Academy"'].join("\n"),
      "utf-8",
    );
    resetVariableManagerCache();
  });

  afterEach(() => {
    resetVariableManagerCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("fills {{ entry.title }} from the mapped field", () => {
    const { meta } = resolveEntryMeta({
      contentType: "landing",
      slug: "ai-engineering",
      locale: "en",
      contentRoot: root,
      pageData: {
        hero: { title: "AI Engineering Bootcamp" },
        meta: { page_title: "{{ entry.title }} | 4Geeks" },
      },
    });
    expect(meta.page_title).toBe("AI Engineering Bootcamp | 4Geeks");
  });

  it("fills site vars (global.*) with default values", () => {
    const { meta } = resolveEntryMeta({
      contentType: "landing",
      slug: "ai-engineering",
      locale: "en",
      contentRoot: root,
      pageData: {
        hero: { title: "AI Engineering" },
        meta: { page_title: "{{ entry.title }} | {{ global.brand_suffix }}" },
      },
    });
    expect(meta.page_title).toBe("AI Engineering | 4Geeks Academy");
  });

  it("uses a given singleEntry as-is instead of mapping the page again", () => {
    const { meta } = resolveEntryMeta({
      contentType: "landing",
      slug: "ai-engineering",
      locale: "en",
      contentRoot: root,
      pageData: {
        hero: { title: "Page hero title" },
        meta: { page_title: "{{ entry.title }} | 4Geeks" },
      },
      singleEntry: { title: "Database item title" },
    });
    expect(meta.page_title).toBe("Database item title | 4Geeks");
  });

  it("fills a mapped field with no value as empty text (same as live delivery)", () => {
    const { meta } = resolveEntryMeta({
      contentType: "landing",
      slug: "ai-engineering",
      locale: "en",
      contentRoot: root,
      pageData: {
        meta: { page_title: "{{ entry.title }} | 4Geeks" },
      },
    });
    expect(meta.page_title).toBe(" | 4Geeks");
  });
});
