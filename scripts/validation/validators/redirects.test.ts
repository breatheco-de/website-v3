import { describe, expect, it, vi } from "vitest";
import type { ContentFile, ValidationContext } from "../shared/types";

const isKnownUrl = vi.fn((_url: string) => false);

vi.mock("../../../server/content-index", () => ({
  contentIndex: {
    isKnownUrl: (url: string) => isKnownUrl(url),
    getLocaleUrls: () => ({}),
    buildUrl: (_type: string, locale: string, slug: string) =>
      `/${locale}/career-programs/${slug}`,
  },
}));

import { redirectValidator } from "./redirects";

function makeFile(partial: Partial<ContentFile> & Pick<ContentFile, "filePath" | "meta">): ContentFile {
  return {
    slug: "cybersecurity",
    title: "Cybersecurity",
    type: "program",
    locale: "es",
    url: "/es/programas-de-carrera/ciberseguridad",
    ...partial,
  };
}

function context(files: ContentFile[]): ValidationContext {
  return {
    contentFiles: files,
    redirectMap: new Map(),
    availableSchemas: new Set(),
    sitemapEntries: [],
    contentIndex: {
      isKnownUrl: (url: string) => isKnownUrl(url),
    } as ValidationContext["contentIndex"],
  };
}

function overwritesIssues(result: Awaited<ReturnType<typeof redirectValidator.run>>) {
  return [...result.errors, ...result.warnings].filter((e) => e.code === "REDIRECT_OVERWRITES_CONTENT");
}

describe("redirectValidator REDIRECT_OVERWRITES_CONTENT", () => {
  it("does not flag a folder-derived short path that isKnownUrl rejects", async () => {
    isKnownUrl.mockImplementation(() => false);
    const file = makeFile({
      filePath: "site_4geeks-com/programs/cybersecurity/es.yml",
      meta: {
        redirects: ["/es/cybersecurity"],
      },
    });

    const result = await redirectValidator.run(context([file]));
    expect(overwritesIssues(result)).toEqual([]);
  });

  it("flags a redirect from a path that isKnownUrl treats as live content", async () => {
    isKnownUrl.mockImplementation((url: string) => url === "/en/career-programs/cybersecurity");
    const file = makeFile({
      locale: "en",
      url: "/en/career-programs/other",
      filePath: "site_4geeks-com/programs/other/en.yml",
      slug: "other",
      meta: {
        redirects: ["/en/career-programs/cybersecurity"],
      },
    });

    const result = await redirectValidator.run(context([file]));
    // Reported as a warning so agents do not "fix" it by deleting approved redirects.
    expect(result.errors.filter((e) => e.code === "REDIRECT_OVERWRITES_CONTENT")).toEqual([]);
    const overwrites = result.warnings.filter((e) => e.code === "REDIRECT_OVERWRITES_CONTENT");
    expect(overwrites).toHaveLength(1);
    expect(overwrites[0]?.type).toBe("warning");
    // validationCacheMerge / RedirectConflictResolver read the first quoted path as `from`.
    expect(overwrites[0]?.message.match(/"(\/[^"]+)"/)?.[1]).toBe("/en/career-programs/cybersecurity");
    expect(overwrites[0]?.suggestion).toContain("Delete the old page");
  });

  it("does not treat locale-home aliases as live content", async () => {
    isKnownUrl.mockImplementation(() => true);
    const file = makeFile({
      filePath: "site_4geeks-com/programs/cybersecurity/es.yml",
      meta: {
        redirects: ["/es"],
      },
    });

    const result = await redirectValidator.run(context([file]));
    expect(overwritesIssues(result)).toEqual([]);
  });
});
