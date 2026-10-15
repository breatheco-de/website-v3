import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import {
  listInboundRedirects,
  removeInboundRedirects,
  suggestRemovedItemRedirect,
} from "./removed-item-redirect";
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

function buildIndex() {
  resetRegistry(contentRoot);
  ci = new ContentIndex(contentRoot);
  vi.spyOn(ci, "getDatabase").mockReturnValue(
    mockDatabase((name) =>
      name === "exercises"
        ? [
            { slug: "bootstrap-exercises", lang: "en", title: "Bootstrap" },
            { slug: "flexbox-exercises", lang: "en", title: "Flexbox" },
          ]
        : null,
    ),
  );
  ci.scan();
}

function writeSeoIndex(entries: Record<string, unknown>) {
  write(
    "seo-index.json",
    JSON.stringify({ version: 1, generated_at: "", entries, by_path: {}, clusters: {}, orphans: [], warnings: [] }),
  );
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "removed-item-test-"));
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
`,
  );
  write("exercises/template.en.yml", `sections:\n  - type: hero\n    title: "{{ entry.title }}"\n`);
  write(
    "exercises/removed-exercise/en.yml",
    yaml.dump({ meta: { redirects: ["/en/old-exercise", { path: "/en/older-exercise", status: 302 }] } }),
  );
  write("exercises/removed-exercise/_common.yml", yaml.dump({ meta: { redirects: ["/legacy-exercise"] } }));
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

describe("suggestRemovedItemRedirect", () => {
  it("prefers the live cluster main page", () => {
    writeSeoIndex({
      "exercise/removed-exercise/en": { pillar_path: "/en/exercise/bootstrap-exercises", pillar_live: true },
    });
    buildIndex();
    expect(suggestRemovedItemRedirect(ci, "exercise", "removed-exercise", "en")).toEqual({
      to: "/en/exercise/bootstrap-exercises",
      reason: "cluster_main_page",
    });
  });

  it("skips a cluster main page that is not live and falls back to the listing page", () => {
    writeSeoIndex({
      "exercise/removed-exercise/en": { pillar_path: "/en/exercise/bootstrap-exercises", pillar_live: false },
    });
    buildIndex();
    expect(suggestRemovedItemRedirect(ci, "exercise", "removed-exercise", "en")).toEqual({
      to: "/en/exercise",
      reason: "listing_page",
    });
  });

  it("skips targets that are themselves redirects and ends at the home page", () => {
    write("custom-redirects.yml", yaml.dump({ redirects: [{ from: "/en/exercise", to: "/en/somewhere" }] }));
    buildIndex();
    const out = suggestRemovedItemRedirect(ci, "exercise", "removed-exercise", "en", { seoIndex: null });
    expect(out.reason).toBe("home_page");
    expect(out.to.startsWith("/")).toBe(true);
  });
});

describe("inbound redirects on the removed page", () => {
  it("lists old addresses from the language file and _common.yml", () => {
    buildIndex();
    const inbound = listInboundRedirects(ci, "exercise", "removed-exercise", "en");
    expect(inbound.map((r) => [r.from, r.status, r.all_languages])).toEqual([
      ["/en/old-exercise", 301, false],
      ["/en/older-exercise", 302, false],
      ["/legacy-exercise", 301, true],
    ]);
    expect(inbound[0].source).toBe("site_test/exercises/removed-exercise/en.yml");
  });

  it("removes moved addresses from the removed page's files", () => {
    buildIndex();
    const changed = removeInboundRedirects(ci, "exercise", "removed-exercise", "en", [
      "/en/old-exercise",
      "/legacy-exercise",
    ]);
    expect(changed).toHaveLength(2);
    expect(listInboundRedirects(ci, "exercise", "removed-exercise", "en").map((r) => r.from)).toEqual([
      "/en/older-exercise",
    ]);
    const common = yaml.load(
      fs.readFileSync(path.join(contentRoot, "exercises/removed-exercise/_common.yml"), "utf-8"),
    ) as { meta: Record<string, unknown> };
    expect(common.meta.redirects).toBeUndefined();
  });
});
