import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import { listTypePages, loadEntry } from "./entry-layer";
import { writeRedirectOnDestinationPage } from "./redirect-destination";
import { resetVariableManagerCache } from "./variable-manager";
import { mockDatabase } from "./test-helpers/mock-database";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;
let ci: ContentIndex;

function write(rel: string, body: string) {
  const full = path.join(contentRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, "utf-8");
}

function readYaml(rel: string): Record<string, unknown> {
  return yaml.load(fs.readFileSync(path.join(contentRoot, rel), "utf-8")) as Record<string, unknown>;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "redirect-dest-test-"));
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
  url_pattern:
    en: /en/exercise/:slug
    es: /es/ejercicio/:slug
page:
  directory: pages
  url_pattern:
    en: /en/:slug
    es: /es/:slug
landing:
  directory: landings
  url_pattern:
    default: /landing/:slug
`,
  );
  write("landings/solo-es/es.yml", yaml.dump({ title: "Solo español", sections: [] }));
  write("landings/both/en.yml", yaml.dump({ title: "Both", sections: [] }));
  write("landings/both/es.yml", yaml.dump({ title: "Ambos", sections: [] }));
  write("exercises/template.en.yml", `sections:\n  - type: hero\n    title: "{{ entry.title }}"\n`);
  write("exercises/template.es.yml", `sections:\n  - type: hero\n    title: "{{ entry.title }}"\n`);
  write("exercises/flexbox/en.yml", yaml.dump({ field_overrides: { title: "Flexbox (edited)" } }));
  write("pages/about/en.yml", yaml.dump({ title: "About", sections: [] }));
  process.chdir(tempDir);
  resetVariableManagerCache();
  resetRegistry(contentRoot);
  ci = new ContentIndex(contentRoot);
  vi.spyOn(ci, "getDatabase").mockReturnValue(
    mockDatabase((name) =>
      name === "exercises"
        ? [
            { slug: "flexbox", lang: "en", title: "Flexbox" },
            { slug: "bootstrap", lang: "en", title: "Bootstrap" },
          ]
        : null,
    ),
  );
  ci.scan();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(ORIGINAL_CWD);
  resetRegistry(contentRoot);
  resetVariableManagerCache();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("redirects are saved on the destination page (any source)", () => {
  it("creates the language file of a database page that has no folder yet", () => {
    const out = writeRedirectOnDestinationPage({
      ci,
      destUrl: "/en/exercise/bootstrap",
      from: "/en/old-bootstrap",
      statusCode: 301,
      allLanguages: false,
    });
    expect(out).toEqual({
      kind: "page",
      files: ["site_test/exercises/bootstrap/en.yml"],
      created: ["site_test/exercises/bootstrap/en.yml"],
      skippedLocales: [],
    });
    expect(readYaml("exercises/bootstrap/en.yml")).toEqual({ meta: { redirects: ["/en/old-bootstrap"] } });
  });

  it("keeps existing overrides when adding to a database page's file, and refuses duplicates", () => {
    writeRedirectOnDestinationPage({ ci, destUrl: "/en/exercise/flexbox", from: "/en/old", statusCode: 302, allLanguages: false });
    expect(readYaml("exercises/flexbox/en.yml")).toEqual({
      field_overrides: { title: "Flexbox (edited)" },
      meta: { redirects: [{ path: "/en/old", status: 302 }] },
    });
    const dup = writeRedirectOnDestinationPage({ ci, destUrl: "/en/exercise/flexbox", from: "/en/old", statusCode: 301, allLanguages: false });
    expect(dup).toMatchObject({ kind: "error", status: 409 });
  });

  it("all languages: writes _common.yml and reports languages without the page", () => {
    const out = writeRedirectOnDestinationPage({ ci, destUrl: "/en/exercise/flexbox", from: "/old-flexbox", statusCode: 301, allLanguages: true });
    expect(out).toMatchObject({ kind: "page", files: ["site_test/exercises/flexbox/_common.yml"], skippedLocales: ["es"] });
  });

  it("one language where the page does not exist is a 404; unknown URLs are not pages", () => {
    expect(
      writeRedirectOnDestinationPage({ ci, destUrl: "/es/ejercicio/flexbox", from: "/es/old", statusCode: 301, allLanguages: false }),
    ).toMatchObject({ kind: "error", status: 404, code: "destination_missing_in_language" });
    expect(
      writeRedirectOnDestinationPage({ ci, destUrl: "https://example.com/x", from: "/x", statusCode: 301, allLanguages: false }),
    ).toEqual({ kind: "not_page" });
  });

  it("static pages use the same rule", () => {
    const out = writeRedirectOnDestinationPage({ ci, destUrl: "/en/about", from: "/en/about-us", statusCode: 301, allLanguages: false });
    expect(out).toMatchObject({ kind: "page", files: ["site_test/pages/about/en.yml"], created: [] });
  });
});

describe("addresses shared by all languages (url_pattern.default)", () => {
  it("a Spanish-only page saves to es.yml, with or without the viewed language", () => {
    for (const locale of ["es", undefined]) {
      fs.rmSync(path.join(contentRoot, "landings/solo-es/es.yml"));
      write("landings/solo-es/es.yml", yaml.dump({ title: "Solo español", sections: [] }));
      const out = writeRedirectOnDestinationPage({
        ci,
        destUrl: "/landing/solo-es",
        from: "/viejo",
        statusCode: 301,
        allLanguages: false,
        locale,
      });
      expect(out).toMatchObject({ kind: "page", files: ["site_test/landings/solo-es/es.yml"] });
      expect(readYaml("landings/solo-es/es.yml").meta).toEqual({ redirects: ["/viejo"] });
    }
  });

  it("a page in both languages saves to the language staff are viewing", () => {
    const es = writeRedirectOnDestinationPage({
      ci,
      destUrl: "/landing/both",
      from: "/viejo",
      statusCode: 301,
      allLanguages: false,
      locale: "es",
    });
    expect(es).toMatchObject({ kind: "page", files: ["site_test/landings/both/es.yml"] });
    const en = writeRedirectOnDestinationPage({ ci, destUrl: "/landing/both", from: "/old", statusCode: 301, allLanguages: false });
    expect(en).toMatchObject({ kind: "page", files: ["site_test/landings/both/en.yml"] });
  });

  it("the viewed language does not override a URL that names its own language", () => {
    const out = writeRedirectOnDestinationPage({
      ci,
      destUrl: "/en/exercise/flexbox",
      from: "/en/old",
      statusCode: 301,
      allLanguages: false,
      locale: "es",
    });
    expect(out).toMatchObject({ kind: "page", files: ["site_test/exercises/flexbox/en.yml"] });
  });
});

describe("listings show the same overrides as the page", () => {
  it("listTypePages and loadEntry agree on overridden fields", () => {
    const listed = listTypePages(ci, "exercise")!;
    const flexbox = listed.pages.find((p) => p.slug === "flexbox")!;
    const entry = loadEntry(ci, "exercise", "flexbox", "en")!;
    expect(flexbox.item.title).toBe("Flexbox (edited)");
    expect(entry.data.title).toBe(flexbox.item.title);
  });
});
