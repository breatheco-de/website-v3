import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ValidationCacheService } from "../../server/services/validationCacheService";
import { buildIssueId } from "../../server/services/validationCacheMerge";
import {
  getValidatorRunClass,
  isCrossEntryValidator,
  isEntryLocalValidator,
} from "./shared/runClass";
import { buildEntryKey } from "./shared/entryKey";
import type { ContentFile, ValidatorResult } from "./shared/types";

function makeFile(
  overrides: Partial<ContentFile> & Pick<ContentFile, "slug" | "type" | "locale" | "filePath">,
): ContentFile {
  return {
    title: overrides.slug,
    url: `/${overrides.locale}/${overrides.slug}`,
    ...overrides,
  };
}

function metaResult(file: ContentFile, missing: boolean): ValidatorResult {
  return {
    name: "meta",
    description: "meta",
    status: missing ? "failed" : "passed",
    duration: 1,
    category: "seo",
    errors: missing
      ? [
          {
            type: "error",
            code: "MISSING_PAGE_TITLE",
            message: "Missing page_title",
            file: file.filePath,
            validator: "meta",
          },
        ]
      : [],
    warnings: [],
  };
}

function redirectsConflict(
  fileA: ContentFile,
  fileB: ContentFile,
): ValidatorResult {
  return {
    name: "redirects",
    description: "redirects",
    status: "failed",
    duration: 1,
    category: "integrity",
    errors: [
      {
        type: "error",
        code: "REDIRECT_CONFLICT",
        message: `Redirect conflict: "/bootcamp/ai" is claimed by both "${fileA.filePath}" and "${fileB.filePath}"`,
        file: fileA.filePath,
        validator: "redirects",
      },
    ],
    warnings: [],
  };
}

describe("validation issue store v5", () => {
  let tmp: string;
  let cache: ValidationCacheService;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "val-cache-"));
    cache = new ValidationCacheService(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("classifies run classes", () => {
    expect(isEntryLocalValidator("meta")).toBe(true);
    expect(isCrossEntryValidator("redirects")).toBe(true);
    expect(getValidatorRunClass("images")).toBe("media");
    expect(getValidatorRunClass("database-health")).toBe("database");
  });

  it("stable issue ids sort targets", () => {
    const a = buildIssueId("redirects", "REDIRECT_CONFLICT", [
      { type: "entry", entryKey: "program/b/en" },
      { type: "entry", entryKey: "program/a/en" },
      { type: "redirect", from: "/x" },
    ]);
    const b = buildIssueId("redirects", "REDIRECT_CONFLICT", [
      { type: "redirect", from: "/x" },
      { type: "entry", entryKey: "program/a/en" },
      { type: "entry", entryKey: "program/b/en" },
    ]);
    expect(a).toBe(b);
  });

  it("entry-local meta on A does not clear B; re-run meta clears obsolete codes", () => {
    const fileA = makeFile({
      type: "program",
      slug: "alpha",
      locale: "en",
      filePath: "/tmp/programs/alpha/en.yml",
      url: "/en/alpha",
    });
    const fileB = makeFile({
      type: "program",
      slug: "beta",
      locale: "en",
      filePath: "/tmp/programs/beta/en.yml",
      url: "/en/beta",
    });

    cache.applyValidatorResults([metaResult(fileA, true)], {
      contentFiles: [fileA, fileB],
      entryKeys: [buildEntryKey("program", "alpha", "en")],
    });
    cache.applyValidatorResults([metaResult(fileB, true)], {
      contentFiles: [fileA, fileB],
      entryKeys: [buildEntryKey("program", "beta", "en")],
    });

    expect(cache.getIssuesByEntryKey("program/alpha/en").some((i) => i.code === "MISSING_PAGE_TITLE")).toBe(
      true,
    );
    expect(cache.getIssuesByEntryKey("program/beta/en").some((i) => i.code === "MISSING_PAGE_TITLE")).toBe(
      true,
    );

    // Clear meta on A only
    cache.applyValidatorResults([metaResult(fileA, false)], {
      contentFiles: [fileA, fileB],
      entryKeys: [buildEntryKey("program", "alpha", "en")],
    });

    expect(cache.getIssuesByEntryKey("program/alpha/en").some((i) => i.code === "MISSING_PAGE_TITLE")).toBe(
      false,
    );
    expect(cache.getIssuesByEntryKey("program/beta/en").some((i) => i.code === "MISSING_PAGE_TITLE")).toBe(
      true,
    );
  });

  it("redirects fan-out to both parties; meta re-run keeps redirects", () => {
    const fileA = makeFile({
      type: "program",
      slug: "ai-engineering",
      locale: "en",
      filePath: "/tmp/programs/ai-engineering/en.yml",
      url: "/en/ai-engineering",
    });
    const fileB = makeFile({
      type: "program",
      slug: "ai-engineering-devs",
      locale: "en",
      filePath: "/tmp/programs/ai-engineering-devs/en.yml",
      url: "/en/ai-engineering-devs",
    });

    cache.applyValidatorResults([redirectsConflict(fileA, fileB)], {
      contentFiles: [fileA, fileB],
      markSiteWide: true,
    });

    const onA = cache.getIssuesByEntryKey("program/ai-engineering/en");
    const onB = cache.getIssuesByEntryKey("program/ai-engineering-devs/en");
    expect(onA.some((i) => i.code === "REDIRECT_CONFLICT")).toBe(true);
    expect(onB.some((i) => i.code === "REDIRECT_CONFLICT")).toBe(true);

    cache.applyValidatorResults([metaResult(fileA, true)], {
      contentFiles: [fileA, fileB],
      entryKeys: ["program/ai-engineering/en"],
    });

    expect(
      cache.getIssuesByEntryKey("program/ai-engineering/en").some((i) => i.code === "REDIRECT_CONFLICT"),
    ).toBe(true);
    expect(
      cache.getIssuesByEntryKey("program/ai-engineering/en").some((i) => i.code === "MISSING_PAGE_TITLE"),
    ).toBe(true);
  });


  it("redirects fan-out with production-style live labels", () => {
    const fileA = makeFile({
      type: "program",
      slug: "ai-engineering",
      locale: "en",
      filePath: "site_4geeks-com/programs/ai-engineering/en.yml",
      url: "/en/ai-engineering",
    });
    const fileB = makeFile({
      type: "program",
      slug: "ai-engineering-devs",
      locale: "en",
      filePath: "site_4geeks-com/programs/ai-engineering-devs/en.yml",
      url: "/en/ai-engineering-devs",
    });

    const result = redirectsConflict(fileA, fileB);
    result.errors[0]!.message =
      'Redirect conflict: "/bootcamp/ai" is claimed by both "programs/ai-engineering/en.yml (live)" and "programs/ai-engineering-devs/en.yml (live)"';

    cache.applyValidatorResults([result], {
      contentFiles: [fileA, fileB],
      markSiteWide: true,
    });

    expect(
      cache.getIssuesByEntryKey("program/ai-engineering/en").some((i) => i.code === "REDIRECT_CONFLICT"),
    ).toBe(true);
    expect(
      cache.getIssuesByEntryKey("program/ai-engineering-devs/en").some((i) => i.code === "REDIRECT_CONFLICT"),
    ).toBe(true);
  });


  it("cross-entry redirects clear site-wide when re-run clean", () => {
    const fileA = makeFile({
      type: "program",
      slug: "ai-engineering",
      locale: "en",
      filePath: "/tmp/programs/ai-engineering/en.yml",
      url: "/en/ai-engineering",
    });
    const fileB = makeFile({
      type: "program",
      slug: "ai-engineering-devs",
      locale: "en",
      filePath: "/tmp/programs/ai-engineering-devs/en.yml",
      url: "/en/ai-engineering-devs",
    });

    cache.applyValidatorResults([redirectsConflict(fileA, fileB)], {
      contentFiles: [fileA, fileB],
      markSiteWide: true,
    });

    cache.applyValidatorResults(
      [
        {
          name: "redirects",
          description: "redirects",
          status: "passed",
          duration: 1,
          category: "integrity",
          errors: [],
          warnings: [],
        },
      ],
      { contentFiles: [fileA, fileB], markSiteWide: true },
    );

    expect(cache.getAllIssues().filter((i) => i.validator === "redirects")).toHaveLength(0);
  });

  it("getAllByEntryKey includes entries that only have run meta", () => {
    const fileA = makeFile({
      type: "program",
      slug: "draft-only",
      locale: "es",
      filePath: "/tmp/programs/draft-only/draft.es.yml",
      url: "/es/draft-only",
      isDraft: true,
    });
    cache.applyValidatorResults([metaResult(fileA, true)], {
      contentFiles: [fileA],
      entryKeys: [buildEntryKey("program", "draft-only", "es")],
    });
    const byEntry = cache.getAllByEntryKey();
    expect(byEntry.get("program/draft-only/es")?.errors.length).toBe(1);
  });

  it("partial section-variants clears file-only cached issues", () => {
    const fileA = makeFile({
      type: "program",
      slug: "alpha",
      locale: "en",
      filePath: "/tmp/programs/alpha/en.yml",
      url: "/en/alpha",
    });
    const templatePath = "/tmp/interactive-exercise/single.en.yml";

    cache.applyValidatorResults(
      [
        {
          name: "section-variants",
          description: "section-variants",
          status: "failed",
          duration: 1,
          category: "integrity",
          errors: [
            {
              type: "error",
              code: "UNKNOWN_SECTION_VARIANT",
              message: "Unknown variant cards",
              file: templatePath,
              validator: "section-variants",
            },
          ],
          warnings: [],
        },
      ],
      { contentFiles: [fileA], entryKeys: [buildEntryKey("program", "alpha", "en")] },
    );

    expect(
      cache.getAllIssues().some((i) => i.validator === "section-variants" && i.file === templatePath),
    ).toBe(true);

    cache.applyValidatorResults(
      [
        {
          name: "section-variants",
          description: "section-variants",
          status: "passed",
          duration: 1,
          category: "integrity",
          errors: [],
          warnings: [],
        },
      ],
      { contentFiles: [fileA], entryKeys: [buildEntryKey("program", "alpha", "en")] },
    );

    expect(cache.getAllIssues().filter((i) => i.validator === "section-variants")).toHaveLength(0);
  });

  it("purgeLegacyIssues removes only validator:legacy rows", async () => {
    const fileA = makeFile({
      type: "program",
      slug: "alpha",
      locale: "en",
      filePath: "/tmp/programs/alpha/en.yml",
      url: "/en/alpha",
    });

    cache.applyValidatorResults([metaResult(fileA, true)], {
      contentFiles: [fileA],
      entryKeys: [buildEntryKey("program", "alpha", "en")],
    });
    await cache.flush();

    const now = new Date().toISOString();
    const raw = JSON.parse(
      fs.readFileSync(path.join(tmp, "validation-cache.json"), "utf-8"),
    ) as {
      issues: Record<string, unknown>;
      runMeta?: { byEntry?: Record<string, { byValidator?: Record<string, string> }> };
    };
    raw.issues["legacy:UNKNOWN_SECTION_VARIANT:orphan"] = {
      id: "legacy:UNKNOWN_SECTION_VARIANT:orphan",
      code: "UNKNOWN_SECTION_VARIANT",
      severity: "error",
      message: 'Section [3] type "cta_banner" sets variant "form" but schema declares no variants',
      validator: "legacy",
      scopes: ["entry"],
      targets: [
        {
          type: "entry",
          entryKey: "legacy__en__blog__orphan",
          url: "/en/blog/orphan",
          file: "/tmp/blog/orphan/en.yml",
        },
      ],
      file: "/tmp/blog/orphan/en.yml",
      category: "components",
      lastSeenAt: now,
      lastRunAt: now,
    };
    const ek = buildEntryKey("program", "alpha", "en");
    raw.runMeta = raw.runMeta ?? { byEntry: {} };
    raw.runMeta.byEntry = raw.runMeta.byEntry ?? {};
    raw.runMeta.byEntry[ek] = {
      ...(raw.runMeta.byEntry[ek] as object),
      byValidator: {
        ...((raw.runMeta.byEntry[ek] as { byValidator?: Record<string, string> })?.byValidator ?? {}),
        legacy: now,
        meta: now,
      },
    };
    fs.writeFileSync(path.join(tmp, "validation-cache.json"), JSON.stringify(raw, null, 2));
    cache.reloadFromDisk();

    expect(cache.getAllIssues().some((i) => i.validator === "legacy")).toBe(true);
    expect(cache.getAllIssues().some((i) => i.validator === "meta")).toBe(true);

    const { removed } = await cache.purgeLegacyIssues();
    expect(removed).toBe(1);
    expect(cache.getAllIssues().filter((i) => i.validator === "legacy")).toHaveLength(0);
    expect(cache.getAllIssues().some((i) => i.validator === "meta")).toBe(true);

    const again = await cache.purgeLegacyIssues();
    expect(again.removed).toBe(0);
  });
});
