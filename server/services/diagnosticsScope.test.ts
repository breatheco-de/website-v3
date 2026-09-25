import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentIndex } from "../content-index";
import { resetRegistry } from "../content-types";
import { resetVariableManagerCache } from "../variable-manager";
import { resolveUrlTargets } from "../../scripts/validation/runDiagnosticsJob";
import { DiagnosticsScopeError, startDiagnosticsJob } from "./diagnosticsJobService";
import { ValidationCacheService } from "./validationCacheService";

let tempDir: string;
let contentRoot: string;
let cachedItems: Record<string, unknown>[] | null;

function write(rel: string, body: string) {
  const full = path.join(contentRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, "utf-8");
}

function buildIndex(): ContentIndex {
  resetRegistry(contentRoot);
  const ci = new ContentIndex(contentRoot);
  ci.scanFast();
  vi.spyOn(ci, "getDatabase").mockReturnValue({
    getMappedItems: (name: string) => (name === "exercises" ? cachedItems : null),
  } as unknown as ReturnType<ContentIndex["getDatabase"]>);
  return ci;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagnostics-scope-"));
  contentRoot = path.join(tempDir, "site_test");
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
  write("exercises/template.en.yml", 'meta:\n  page_title: "{{ entry.title }}"\n');
  cachedItems = [{ slug: "bootstrap-exercises", lang: "en", title: "Bootstrap Exercises" }];
  resetVariableManagerCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetRegistry(contentRoot);
  resetVariableManagerCache();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("diagnostics scope for database-backed pages", () => {
  it("finds a database slug like any other page", async () => {
    const ci = buildIndex();
    const targets = await resolveUrlTargets(contentRoot, ci, ["bootstrap-exercises"]);
    expect(targets.map((t) => t.url)).toEqual(["/en/exercise/bootstrap-exercises"]);
  }, 60_000);

  it("rejects an unknown slug with a not-found scope error", async () => {
    cachedItems = null;
    const ci = buildIndex();
    const err = await startDiagnosticsJob({
      contentRoot,
      contentRootName: "site_test",
      ci,
      cache: new ValidationCacheService(contentRoot),
      slugs: ["bootstrap-exercises"],
      confirm: true,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DiagnosticsScopeError);
    expect((err as DiagnosticsScopeError).code).toBe("diagnostics_slug_not_found");
    expect((err as DiagnosticsScopeError).details).toMatchObject({
      slugs: ["bootstrap-exercises"],
      empty_databases: ["exercises"],
    });
  }, 60_000);
});
