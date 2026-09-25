import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ValidationCacheService } from "./validationCacheService";
import type { ContentFile, ValidatorResult } from "../../scripts/validation/shared/types";

function validator(
  name: string,
  errors: Array<{ code: string; file: string }>,
): ValidatorResult {
  return {
    name,
    category: "seo",
    errors: errors.map((e) => ({
      type: "error" as const,
      code: e.code,
      message: `${e.code} on ${e.file}`,
      file: e.file,
    })),
    warnings: [],
  } as ValidatorResult;
}

describe("validation cache: content types skipped for an empty database cache", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "val-cache-skipped-"));
    roots.push(root);
    const page: ContentFile = {
      slug: "home",
      title: "Home",
      type: "page",
      locale: "en",
      filePath: path.join(root, "pages/home/en.yml"),
      url: "/en/home",
    };
    const exercise: ContentFile = {
      slug: "bootstrap-exercises",
      title: "Bootstrap Exercises",
      type: "exercise",
      locale: "en",
      filePath: path.join(root, "exercises/bootstrap-exercises/en.yml"),
      url: "/en/exercise/bootstrap-exercises",
    };
    return { cache: new ValidationCacheService(root), page, exercise };
  }

  it("keeps entry-local issues of skipped pages on a full run and does not mark them checked", () => {
    const { cache, page, exercise } = setup();
    cache.applyValidatorResults(
      [
        validator("meta", [
          { code: "MISSING_DESCRIPTION", file: page.filePath },
          { code: "MISSING_DESCRIPTION", file: exercise.filePath },
        ]),
      ],
      { contentFiles: [page, exercise] },
    );
    const exerciseKey = "exercise/bootstrap-exercises/en";
    expect(cache.getIssuesByEntryKey(exerciseKey)).toHaveLength(1);
    const checkedAt = cache.getRunMetaForEntry(exerciseKey)?.byValidator.meta;

    cache.applyValidatorResults([validator("meta", [])], {
      contentFiles: [page],
      skippedContentTypes: ["exercise"],
    });

    expect(cache.getIssuesByEntryKey("page/home/en")).toHaveLength(0);
    expect(cache.getIssuesByEntryKey(exerciseKey)).toHaveLength(1);
    expect(cache.getRunMetaForEntry(exerciseKey)?.byValidator.meta).toBe(checkedAt);
  });

  it("keeps cross-entry issues that only point at skipped pages", () => {
    const { cache, page, exercise } = setup();
    cache.applyValidatorResults(
      [
        validator("seo-duplicates", [
          { code: "DUPLICATE_TITLE", file: page.filePath },
          { code: "DUPLICATE_TITLE", file: exercise.filePath },
        ]),
      ],
      { contentFiles: [page, exercise], markSiteWide: true },
    );

    cache.applyValidatorResults([validator("seo-duplicates", [])], {
      contentFiles: [page],
      markSiteWide: true,
      skippedContentTypes: ["exercise"],
    });

    expect(cache.getIssuesByEntryKey("page/home/en")).toHaveLength(0);
    expect(cache.getIssuesByEntryKey("exercise/bootstrap-exercises/en")).toHaveLength(1);
  });

  it("clears skipped-type issues again once the pages load", () => {
    const { cache, page, exercise } = setup();
    cache.applyValidatorResults(
      [validator("meta", [{ code: "MISSING_DESCRIPTION", file: exercise.filePath }])],
      { contentFiles: [page, exercise] },
    );
    cache.applyValidatorResults([validator("meta", [])], {
      contentFiles: [page, exercise],
    });
    expect(cache.getIssuesByEntryKey("exercise/bootstrap-exercises/en")).toHaveLength(0);
  });
});
