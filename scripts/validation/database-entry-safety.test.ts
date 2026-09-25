import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentIndex } from "../../server/content-index";
import { resetRegistry } from "../../server/content-types";
import { resetVariableManagerCache } from "../../server/variable-manager";
import { ValidationService } from "./service";
import { ENTRY_LOCAL_VALIDATOR_NAMES } from "./shared/runClass";

let tempDir: string;
let contentRoot: string;

function write(rel: string, body: string) {
  const full = path.join(contentRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, "utf-8");
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-entry-safety-"));
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
    seats_checkins:
      source: seats_checkins
      default: null
  url_pattern:
    en: /en/exercise/:slug
  editor:
    seats_checkins:
      type: live_request
      required: true
      fill_intent:
        goal: structural
        purpose: Live registrant list fetched on page delivery
      request:
        url: https://example.com/checkins/{{ entry.slug }}
      response:
        items_path: $
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
  resetRegistry(contentRoot);
  resetVariableManagerCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetRegistry(contentRoot);
  resetVariableManagerCache();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("entry-local validators on a database page with no entry file yet", () => {
  it("check the page without throwing", async () => {
    const ci = new ContentIndex(contentRoot);
    ci.scanFast();
    vi.spyOn(ci, "getDatabase").mockReturnValue({
      getMappedItems: (name: string) =>
        name === "exercises"
          ? [
              {
                slug: "bootstrap-exercises",
                lang: "en",
                title: "Bootstrap Exercises",
                description: "Practice Bootstrap layouts step by step.",
              },
            ]
          : null,
    } as unknown as ReturnType<ContentIndex["getDatabase"]>);

    const service = new ValidationService();
    const context = await service.buildContext({ contentRoot, ci });
    const page = context.contentFiles.find((f) => f.slug === "bootstrap-exercises");
    expect(page).toBeDefined();
    expect(fs.existsSync(page!.filePath)).toBe(false);

    const result = await service.runValidators({
      validators: [...ENTRY_LOCAL_VALIDATOR_NAMES],
    });
    const crashes = result.validators.flatMap((v) =>
      v.errors
        .filter((e) => e.code === "VALIDATOR_ERROR")
        .map((e) => `${v.name}: ${e.message}`),
    );
    expect(crashes).toEqual([]);

    const liveFieldIssues = result.validators.flatMap((v) =>
      [...v.errors, ...v.warnings].filter((i) => i.message.includes("seats_checkins")),
    );
    expect(liveFieldIssues).toEqual([]);
  }, 60_000);
});
