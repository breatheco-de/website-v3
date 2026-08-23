import { describe, it, expect } from "vitest";
import type { ContentFile } from "../../../scripts/validation/shared/types";
import { filterContentFilesForEntry } from "./on-save-validation";

function file(partial: Partial<ContentFile> & Pick<ContentFile, "type" | "slug" | "locale">): ContentFile {
  return {
    title: partial.slug,
    filePath: partial.filePath ?? "",
    ...partial,
  };
}

describe("filterContentFilesForEntry", () => {
  it("includes live locale rows without variant", () => {
    const files = [
      file({ type: "page", slug: "home", locale: "en", filePath: "pages/home/en.yml" }),
    ];
    const filtered = filterContentFilesForEntry(files, {
      contentType: "page",
      slug: "home",
      locale: "en",
    });
    expect(filtered).toHaveLength(1);
  });

  it("includes draft variant rows when no live locale exists", () => {
    const files = [
      file({
        type: "page",
        slug: "draft-page",
        locale: "en",
        variant: "draft",
        filePath: "pages/draft-page/draft.en.yml",
        isDraft: true,
      }),
    ];
    const filtered = filterContentFilesForEntry(files, {
      contentType: "page",
      slug: "draft-page",
      locale: "en",
    });
    expect(filtered).toHaveLength(1);
  });

  it("excludes draft variant rows when a live locale exists", () => {
    const files = [
      file({ type: "page", slug: "home", locale: "en", filePath: "pages/home/en.yml" }),
      file({
        type: "page",
        slug: "home",
        locale: "en",
        variant: "b",
        filePath: "pages/home/b.en.yml",
      }),
    ];
    const filtered = filterContentFilesForEntry(files, {
      contentType: "page",
      slug: "home",
      locale: "en",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.variant).toBeUndefined();
  });
});
