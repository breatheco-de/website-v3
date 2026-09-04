import { describe, it, expect } from "vitest";
import { updatedAtValidator } from "./updated-at";
import type { ContentFile, ValidationContext } from "../shared/types";

function makeContext(files: ContentFile[]): ValidationContext {
  return {
    contentFiles: files,
    redirectMap: new Map(),
    availableSchemas: new Set(),
    sitemapEntries: [],
  };
}

function makeFile(partial: Partial<ContentFile> & { entryFields?: Record<string, unknown> }): ContentFile {
  return {
    slug: partial.slug || "post",
    title: partial.title || "Post",
    type: partial.type || "blog",
    locale: partial.locale || "en",
    filePath: partial.filePath || "/tmp/blog/post/en.yml",
    entryFields: partial.entryFields,
    ...partial,
  };
}

describe("updatedAtValidator", () => {
  it("passes when updated_at is empty or missing", async () => {
    const result = await updatedAtValidator.run(
      makeContext([
        makeFile({
          entryFields: { updated_at: "", sections: [{ type: "article", content: "hi" }] },
        }),
        makeFile({
          slug: "other",
          filePath: "/tmp/blog/other/en.yml",
          entryFields: { sections: [{ type: "article", content: "hi" }] },
        }),
      ]),
    );
    expect(result.status).toBe("passed");
    expect(result.warnings).toHaveLength(0);
  });

  it("passes for valid ISO updated_at on entry and article", async () => {
    const result = await updatedAtValidator.run(
      makeContext([
        makeFile({
          entryFields: {
            updated_at: "2026-03-15T12:00:00Z",
            sections: [
              {
                type: "article",
                section_id: "article-1",
                updated_at: "2026-03-15",
                content: "body",
              },
            ],
          },
        }),
      ]),
    );
    expect(result.status).toBe("passed");
    expect(result.warnings).toHaveLength(0);
  });

  it("warns on garbage entry updated_at", async () => {
    const result = await updatedAtValidator.run(
      makeContext([
        makeFile({
          entryFields: { updated_at: "not-a-date", sections: [] },
        }),
      ]),
    );
    expect(result.status).toBe("warning");
    expect(result.warnings.some((w) => w.code === "INVALID_UPDATED_AT")).toBe(true);
  });

  it("warns on unparseable article updated_at; template mapping with empty single is fine", async () => {
    const garbage = await updatedAtValidator.run(
      makeContext([
        makeFile({
          entryFields: {
            sections: [
              {
                type: "article",
                section_id: "article-main",
                updated_at: "01/02/2024",
                content: "body",
              },
            ],
          },
        }),
      ]),
    );
    expect(garbage.status).toBe("warning");
    expect(garbage.warnings).toHaveLength(1);
    expect(garbage.warnings[0].code).toBe("INVALID_UPDATED_AT");

    const mappedEmpty = await updatedAtValidator.run(
      makeContext([
        makeFile({
          slug: "tpl",
          filePath: "/tmp/blog/tpl/en.yml",
          entryFields: {
            updated_at: "",
            sections: [
              {
                type: "article",
                section_id: "article-tpl",
                updated_at: "{{ single.updated_at }}",
                content: "body",
              },
            ],
          },
        }),
      ]),
    );
    expect(mappedEmpty.status).toBe("passed");
    expect(mappedEmpty.warnings).toHaveLength(0);
  });

  it("warns when a non-empty unresolved template remains (non-single or broken)", async () => {
    const result = await updatedAtValidator.run(
      makeContext([
        makeFile({
          entryFields: {
            sections: [
              {
                type: "article",
                section_id: "article-bad-tpl",
                updated_at: "{{ meta.foo }}",
                content: "body",
              },
            ],
          },
        }),
      ]),
    );
    expect(result.status).toBe("warning");
    expect(result.warnings[0].code).toBe("INVALID_UPDATED_AT");
  });
});
