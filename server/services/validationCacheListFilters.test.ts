import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyCacheIssueRowFilters,
  listCacheIssuesFromStore,
  ValidationCacheService,
} from "./validationCacheService";
import type { ContentFile, ValidatorResult } from "../../scripts/validation/shared/types";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "val-cache-list-"));
}

function validatorResult(
  name: string,
  category: string,
  items: Array<{ type: "error" | "warning"; code: string; message: string; file: string }>,
): ValidatorResult {
  const errors = items.filter((i) => i.type === "error");
  const warnings = items.filter((i) => i.type === "warning");
  return {
    name,
    category,
    errors: errors.map((e) => ({
      type: "error" as const,
      code: e.code,
      message: e.message,
      file: e.file,
    })),
    warnings: warnings.map((w) => ({
      type: "warning" as const,
      code: w.code,
      message: w.message,
      file: w.file,
    })),
  };
}

describe("listCacheIssuesFromStore filters", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  function seedCache(root: string): ValidationCacheService {
    roots.push(root);
    const cache = new ValidationCacheService(root);
    const file: ContentFile = {
      slug: "home",
      title: "Home",
      type: "page",
      locale: "en",
      filePath: path.join(root, "pages/home/en.yml"),
      url: "/en/home",
    };
    const fileEs: ContentFile = {
      slug: "about",
      title: "About",
      type: "page",
      locale: "es",
      filePath: path.join(root, "pages/about/es.yml"),
      url: "/es/about",
    };
    fs.mkdirSync(path.dirname(file.filePath), { recursive: true });
    fs.writeFileSync(file.filePath, "meta: {}\nsections: []\n");
    fs.mkdirSync(path.dirname(fileEs.filePath), { recursive: true });
    fs.writeFileSync(fileEs.filePath, "meta: {}\nsections: []\n");

    cache.applyValidatorResults(
      [
        validatorResult("schema-completeness", "seo", [
          {
            type: "warning",
            code: "SCHEMA_MISSING",
            message: "No schema on /en/home",
            file: file.filePath,
          },
        ]),
        validatorResult("legacy", "content", [
          {
            type: "warning",
            code: "EMPTY_FIELD_VALUE",
            message: "Empty field on /en/home",
            file: file.filePath,
          },
        ]),
        validatorResult("meta", "seo", [
          {
            type: "error",
            code: "MISSING_TITLE",
            message: "Missing title on /es/about",
            file: fileEs.filePath,
          },
        ]),
      ],
      { contentFiles: [file, fileEs], entryKeys: ["page/home/en", "page/about/es"] },
    );
    return cache;
  }

  it("filters by single validator via validators param", () => {
    const cache = seedCache(tempRoot());
    const result = listCacheIssuesFromStore(cache, { validators: ["schema-completeness"] });
    expect(result.issues.every((i) => i.validator === "schema-completeness")).toBe(true);
    expect(result.totals.filtered).toBe(result.issues.length);
    expect(result.totals.open).toBeGreaterThan(result.totals.filtered);
    expect(result.facetsAll.validator).toContain("legacy");
    expect(result.facets.validator).toEqual(["schema-completeness"]);
  });

  it("multi-validator OR filter", () => {
    const cache = seedCache(tempRoot());
    const result = listCacheIssuesFromStore(cache, {
      validators: ["schema-completeness", "meta"],
    });
    const validators = new Set(result.issues.map((i) => i.validator));
    expect(validators.has("schema-completeness")).toBe(true);
    expect(validators.has("meta")).toBe(true);
    expect(validators.has("legacy")).toBe(false);
  });

  it("search and severity filters", () => {
    const cache = seedCache(tempRoot());
    const result = listCacheIssuesFromStore(cache, {
      search: "about",
      severity: "error",
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe("MISSING_TITLE");
    expect(result.totals.errors).toBe(1);
    expect(result.totals.warnings).toBe(0);
  });

  it("urlPath fuzzy match", () => {
    const cache = seedCache(tempRoot());
    const result = listCacheIssuesFromStore(cache, { urlPath: "/en/home" });
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((i) => i.url.includes("/en/home") || i.url === "")).toBe(true);
    const none = listCacheIssuesFromStore(cache, { urlPath: "/zz/nope" });
    expect(none.issues).toHaveLength(0);
    expect(none.totals.open).toBeGreaterThan(0);
  });

  it("backward compat single validator param", () => {
    const cache = seedCache(tempRoot());
    const result = listCacheIssuesFromStore(cache, { validator: "legacy" });
    expect(result.issues.every((i) => i.validator === "legacy")).toBe(true);
  });

  it("applyCacheIssueRowFilters priorAttempts", () => {
    const rows = [
      {
        id: "a",
        url: "/en/x",
        severity: "warning" as const,
        code: "X",
        message: "x",
        attempts: [{ at: "1", by: "u", reason: "released" as const }],
      },
      {
        id: "b",
        url: "/en/y",
        severity: "warning" as const,
        code: "Y",
        message: "y",
      },
    ];
    const filtered = applyCacheIssueRowFilters(rows, { priorAttempts: true });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("a");
  });
});
