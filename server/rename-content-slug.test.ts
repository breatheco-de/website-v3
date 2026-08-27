import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renameContentSlug } from "./content-editor";
import { contentIndex } from "./content-index";
import { getFolder } from "./content-types";

const tmpDirs: string[] = [];

function makeEntryRoot(): { root: string; folderSlug: string } {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-rename-content-slug-"));
  tmpDirs.push(root);
  const folderSlug = "interactive-exercises";
  const entryDir = path.join(root, getFolder("page"), folderSlug);
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(path.join(entryDir, "es.yml"), "slug: interactive-exercises\ntitle: Test\n", "utf-8");
  return { root, folderSlug };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("renameContentSlug ownership and routing checks", () => {
  function stubIndex(folderSlug: string, root: string) {
    const entryDir = path.join(root, getFolder("page"), folderSlug);
    vi.spyOn(contentIndex, "resolveBaseSlug").mockReturnValue(folderSlug);
    vi.spyOn(contentIndex, "getContentFolderPath").mockReturnValue(entryDir);
    vi.spyOn(contentIndex, "getFolderName").mockReturnValue(getFolder("page"));
    vi.spyOn(contentIndex, "loadCommonData").mockReturnValue(null);
    vi.spyOn(contentIndex, "buildUrl").mockImplementation((_ct, locale, slug) => `/${locale}/${slug}`);
  }

  it("refuses when new URL resolves to another entry", async () => {
    const { root, folderSlug } = makeEntryRoot();
    stubIndex(folderSlug, root);
    vi.spyOn(contentIndex, "resolveUrl").mockImplementation((url) => {
      if (url === "/es/tutoriales-interactivos") {
        return {
          contentType: "pages",
          slug: "someone-else",
          entry: { slug: "someone-else", contentType: "page", directory: "", files: [], locales: [] },
        };
      }
      return null;
    });

    const result = await renameContentSlug({
      contentType: "page",
      folderSlug,
      locale: "es",
      newSlug: "tutoriales-interactivos",
      contentRootName: path.relative(process.cwd(), root),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.statusCode).toBe(409);
    expect(result.error).toContain("slug_already_owned_by_other_entry");
  });

  it("returns routed=true when refreshed URL resolves to the same folder", async () => {
    const { root, folderSlug } = makeEntryRoot();
    stubIndex(folderSlug, root);
    let resolveCalls = 0;
    vi.spyOn(contentIndex, "resolveUrl").mockImplementation((url) => {
      if (url !== "/es/tutoriales-interactivos") return null;
      resolveCalls += 1;
      if (resolveCalls === 1) return null;
      return {
        contentType: "pages",
        slug: folderSlug,
        entry: { slug: folderSlug, contentType: "page", directory: "", files: [], locales: [] },
      };
    });
    vi.spyOn(contentIndex, "refresh").mockImplementation(() => {});

    const result = await renameContentSlug({
      contentType: "page",
      folderSlug,
      locale: "es",
      newSlug: "tutoriales-interactivos",
      contentRootName: path.relative(process.cwd(), root),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.routed).toBe(true);
    expect(result.data.newUrl).toBe("/es/tutoriales-interactivos");
  });
});
