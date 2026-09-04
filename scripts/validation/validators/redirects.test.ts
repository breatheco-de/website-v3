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
    expect(result.errors.filter((e) => e.code === "REDIRECT_OVERWRITES_CONTENT")).toEqual([]);
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
    const overwrites = result.errors.filter((e) => e.code === "REDIRECT_OVERWRITES_CONTENT");
    expect(overwrites).toHaveLength(1);
    expect(overwrites[0]?.message).toContain("/en/career-programs/cybersecurity");
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
    expect(result.errors.filter((e) => e.code === "REDIRECT_OVERWRITES_CONTENT")).toEqual([]);
  });
});
