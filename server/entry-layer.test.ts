import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import { listEntryKeys, loadEntry } from "./entry-layer";
import { resolveEntryMeta } from "./resolve-entry-meta";
import { resetVariableManagerCache } from "./variable-manager";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;
let ci: ContentIndex;
let cachedItems: Record<string, unknown>[] | null;

function write(rel: string, body: string) {
  const full = path.join(contentRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, "utf-8");
}

function buildIndex() {
  resetRegistry(contentRoot);
  ci = new ContentIndex(contentRoot);
  ci.scanFast();
  vi.spyOn(ci, "getDatabase").mockReturnValue({
    getMappedItems: (name: string) => (name === "exercises" ? cachedItems : null),
  } as unknown as ReturnType<ContentIndex["getDatabase"]>);
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "entry-layer-test-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  write(
    "content-types.yml",
    `exercise:
  directory: exercises
  single_template: true
  database:
    slug: exercises
  field_mapping:
    _slug: slug
    _locale: lang
    title: title
    description: description
  url_pattern:
    en: /en/exercise/:slug
    es: /es/ejercicio/:slug
`,
  );
  write(
    "exercises/template.en.yml",
    `meta:
  page_title: "{{ entry.title }} | Exercises"
  description: "{{ entry.description }}"
sections:
  - type: hero
    title: "{{ entry.title }}"
`,
  );
  cachedItems = [
    {
      slug: "bootstrap-exercises",
      lang: "en",
      title: "Bootstrap Exercises",
      description: "Practice Bootstrap layouts step by step.",
    },
  ];
  process.chdir(tempDir);
  resetVariableManagerCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(ORIGINAL_CWD);
  resetRegistry(contentRoot);
  resetVariableManagerCache();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("entry layer (static and database entries resolve the same way)", () => {
  it("lists a database item as a page and fills the template meta from its fields", () => {
    buildIndex();
    const list = listEntryKeys(ci);
    expect(list.keys).toContainEqual({
      contentType: "exercise",
      slug: "bootstrap-exercises",
      locales: ["en"],
    });
    expect(list.emptyDatabases).toEqual([]);

    const entry = loadEntry(ci, "exercise", "bootstrap-exercises", "en", list.itemsByType);
    expect(entry).not.toBeNull();
    expect(entry!.filePath).toBe(
      path.join(contentRoot, "exercises", "bootstrap-exercises", "en.yml"),
    );
    expect(entry!.singleEntry?.title).toBe("Bootstrap Exercises");
    expect(Array.isArray(entry!.data.sections)).toBe(true);

    const { meta } = resolveEntryMeta({
      contentType: "exercise",
      slug: "bootstrap-exercises",
      locale: "en",
      contentRoot,
      pageData: entry!.data,
      singleEntry: entry!.singleEntry,
    });
    expect(meta.page_title).toBe("Bootstrap Exercises | Exercises");
    expect(meta.description).toBe("Practice Bootstrap layouts step by step.");
  });

  it("keeps unmapped source columns off the page fields (templates can still read them)", () => {
    cachedItems = [{ ...(cachedItems?.[0] ?? {}), id: 42, readme_url: "https://example.com/readme" }];
    buildIndex();
    const list = listEntryKeys(ci);
    const entry = loadEntry(ci, "exercise", "bootstrap-exercises", "en", list.itemsByType);
    expect(entry!.data.title).toBe("Bootstrap Exercises");
    expect(entry!.data).not.toHaveProperty("id");
    expect(entry!.data).not.toHaveProperty("readme_url");
    expect(entry!.singleEntry?.id).toBe(42);
  });

  it("merges an overlay folder and its item into one page", () => {
    write("exercises/bootstrap-exercises/en.yml", "hero_note: Staff note\n");
    buildIndex();
    const list = listEntryKeys(ci);
    const rows = list.keys.filter(
      (k) => k.contentType === "exercise" && k.slug === "bootstrap-exercises",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.locales).toEqual(["en"]);

    const entry = loadEntry(ci, "exercise", "bootstrap-exercises", "en", list.itemsByType);
    expect(entry!.data.hero_note).toBe("Staff note");
    expect(entry!.singleEntry?.title).toBe("Bootstrap Exercises");
  });

  it("lets field_overrides win over the item value", () => {
    write(
      "exercises/bootstrap-exercises/en.yml",
      "field_overrides:\n  title: Bootstrap Layout Drills\n",
    );
    buildIndex();
    const list = listEntryKeys(ci);
    const entry = loadEntry(ci, "exercise", "bootstrap-exercises", "en", list.itemsByType);
    expect(entry!.singleEntry?.title).toBe("Bootstrap Layout Drills");
  });

  it("reports an empty cache and lists no pages for that database", () => {
    cachedItems = null;
    buildIndex();
    const list = listEntryKeys(ci);
    expect(list.emptyDatabases).toEqual(["exercises"]);
    expect(list.skippedContentTypes).toEqual(["exercise"]);
    expect(list.keys.filter((k) => k.contentType === "exercise")).toEqual([]);
  });

  it("skips item languages that have no URL", () => {
    cachedItems = [
      ...(cachedItems ?? []),
      { slug: "bootstrap-uebungen", lang: "de", title: "Bootstrap Übungen" },
    ];
    buildIndex();
    const list = listEntryKeys(ci);
    expect(list.keys.some((k) => k.slug === "bootstrap-uebungen")).toBe(false);
  });
});
