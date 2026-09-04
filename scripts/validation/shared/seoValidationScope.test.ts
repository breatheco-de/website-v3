import { describe, expect, it } from "vitest";
import {
  buildCacheIssueFacets,
  type CacheIssueListRow,
} from "../../../server/services/validationCacheService";
import { isSeoValidationTarget, liveFilesForSeo } from "../shared/seoValidationScope";
import type { ContentFile, ValidationContext } from "../shared/types";

describe("buildCacheIssueFacets", () => {
  it("derives unique sorted facets from issue rows", () => {
    const rows: CacheIssueListRow[] = [
      {
        url: "/a",
        code: "ORPHAN_PAGE",
        severity: "warning",
        message: "x",
        validator: "seo-cluster",
        category: "seo",
      },
      {
        url: "/b",
        code: "DUPLICATE_PILLAR",
        severity: "error",
        message: "y",
        validator: "seo-cluster",
        category: "seo",
      },
      {
        url: "/c",
        code: "MISSING_PAGE_TITLE",
        severity: "error",
        message: "z",
        validator: "meta",
        category: "seo",
      },
    ];
    const facets = buildCacheIssueFacets(rows);
    expect(facets.validator).toEqual(["meta", "seo-cluster"]);
    expect(facets.category).toEqual(["seo"]);
    expect(facets.code).toEqual(["DUPLICATE_PILLAR", "MISSING_PAGE_TITLE", "ORPHAN_PAGE"]);
    expect(facets.severity).toEqual(["error", "warning"]);
  });
});

describe("seoValidationScope", () => {
  it("excludes published variants", () => {
    const live: ContentFile = {
      slug: "a",
      title: "A",
      type: "blog",
      locale: "en",
      url: "/en/a",
      filePath: "blog/a/en.yml",
    };
    const variant: ContentFile = {
      ...live,
      filePath: "blog/a/draft.en.yml",
      variant: "draft",
    };
    expect(isSeoValidationTarget(live)).toBe(true);
    expect(isSeoValidationTarget(variant)).toBe(false);
    const ctx: ValidationContext = {
      contentFiles: [live, variant],
      redirectMap: new Map(),
      availableSchemas: new Set(),
      sitemapEntries: [],
    };
    expect(liveFilesForSeo(ctx)).toEqual([live]);
  });
});
