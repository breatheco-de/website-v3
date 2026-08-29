import { describe, expect, it } from "vitest";
import { seoDuplicatesValidator } from "./seo-duplicates";
import type { ContentFile, ValidationContext } from "../shared/types";
import { getValidatorRunClass } from "../shared/runClass";

function ctx(files: ContentFile[]): ValidationContext {
  return {
    contentRoot: "/tmp",
    contentFiles: files,
    redirectMap: new Map(),
  } as ValidationContext;
}

function file(
  slug: string,
  meta: { page_title?: string; description?: string },
): ContentFile {
  return {
    slug,
    title: slug,
    type: "page",
    locale: "en",
    filePath: `pages/${slug}/en.yml`,
    url: `/en/${slug}`,
    meta,
  };
}

describe("seo-depth vs seo-duplicates split", () => {
  it("classifies seo-duplicates as cross-entry and seo-depth as entry-local", () => {
    expect(getValidatorRunClass("seo-depth")).toBe("entry-local");
    expect(getValidatorRunClass("seo-duplicates")).toBe("cross-entry");
    expect(seoDuplicatesValidator.runClass).toBe("cross-entry");
  });

  it("seo-duplicates emits DUPLICATE_TITLE across files", async () => {
    const result = await seoDuplicatesValidator.run(
      ctx([
        file("a", { page_title: "Same Title Across Pages Here", description: "a".repeat(80) }),
        file("b", { page_title: "Same Title Across Pages Here", description: "b".repeat(80) }),
      ]),
    );
    expect(result.errors.some((e) => e.code === "DUPLICATE_TITLE")).toBe(true);
  });

  it("seo-duplicates does not flag unique titles", async () => {
    const result = await seoDuplicatesValidator.run(
      ctx([
        file("a", { page_title: "Unique Title Alpha For Page A", description: "a".repeat(80) }),
        file("b", { page_title: "Unique Title Beta For Page B", description: "b".repeat(80) }),
      ]),
    );
    expect(result.errors.some((e) => e.code === "DUPLICATE_TITLE")).toBe(false);
  });
});
