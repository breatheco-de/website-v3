import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSlugRename, renameContentSlug } from "./content-editor";
import { contentIndex } from "./content-index";
import { getFolder } from "./content-types";
import * as seoIndexMod from "./seo-index";
import * as contentEvents from "./content-events";

const tmpDirs: string[] = [];

function makeEntryRoot(extraYaml = ""): { root: string; folderSlug: string } {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-rename-content-slug-"));
  tmpDirs.push(root);
  const folderSlug = "interactive-exercises";
  const entryDir = path.join(root, getFolder("page"), folderSlug);
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(path.join(entryDir, "es.yml"), `slug: interactive-exercises\ntitle: Test\n${extraYaml}`, "utf-8");
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
    vi.spyOn(contentIndex, "isSlowPhaseReady").mockReturnValue(true);
    vi.spyOn(contentIndex, "getRedirects").mockReturnValue([]);
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
    vi.spyOn(seoIndexMod, "clusterHasPillarPathPointers").mockReturnValue(false);

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
    expect(result.data.clusterRewireQueued).toBe(false);
  });

  it("emits cluster rewire when seo-index still points at old URL", async () => {
    const { root, folderSlug } = makeEntryRoot();
    stubIndex(folderSlug, root);
    vi.spyOn(contentIndex, "resolveUrl").mockImplementation((url) => {
      if (url !== "/es/tutoriales-interactivos") return null;
      return {
        contentType: "pages",
        slug: folderSlug,
        entry: { slug: folderSlug, contentType: "page", directory: "", files: [], locales: [] },
      };
    });
    vi.spyOn(contentIndex, "refresh").mockImplementation(() => {});
    vi.spyOn(seoIndexMod, "clusterHasPillarPathPointers").mockReturnValue(true);
    const emitSpy = vi.spyOn(contentEvents, "emitClusterHubPathRewriteStarted").mockReturnValue({
      id: 99,
    } as never);

    const result = await renameContentSlug({
      contentType: "page",
      folderSlug,
      locale: "es",
      newSlug: "tutoriales-interactivos",
      contentRootName: path.relative(process.cwd(), root),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.clusterRewireQueued).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        oldUrl: "/es/interactive-exercises",
        newUrl: "/es/tutoriales-interactivos",
        contentType: "page",
        slug: folderSlug,
        locale: "es",
      }),
    );
  });
});

describe("checkSlugRename (live availability + Apply gate)", () => {
  const NEW_URL = "/es/tutoriales-interactivos";

  function stubIndex(folderSlug: string, root: string, redirects: ReturnType<typeof contentIndex.getRedirects> = []) {
    const entryDir = path.join(root, getFolder("page"), folderSlug);
    vi.spyOn(contentIndex, "resolveBaseSlug").mockReturnValue(folderSlug);
    vi.spyOn(contentIndex, "getContentFolderPath").mockReturnValue(entryDir);
    vi.spyOn(contentIndex, "getFolderName").mockReturnValue(getFolder("page"));
    vi.spyOn(contentIndex, "loadCommonData").mockReturnValue(null);
    vi.spyOn(contentIndex, "buildUrl").mockImplementation((_ct, locale, slug) => `/${locale}/${slug}`);
    vi.spyOn(contentIndex, "resolveUrl").mockReturnValue(null);
    vi.spyOn(contentIndex, "isSlowPhaseReady").mockReturnValue(true);
    vi.spyOn(contentIndex, "getRedirects").mockReturnValue(redirects);
  }

  const input = (folderSlug: string) => ({
    contentType: "page",
    folderSlug,
    locale: "es",
    newSlug: "tutoriales-interactivos",
  });

  it("is available when no entry or redirect claims the URL", async () => {
    const { root, folderSlug } = makeEntryRoot();
    stubIndex(folderSlug, root);
    const result = await checkSlugRename(input(folderSlug));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newUrl).toBe(NEW_URL);
    expect(result.ownRedirectHit).toBe(false);
  });

  it("refuses a new slug that is another spelling of another page's address", async () => {
    const { root, folderSlug } = makeEntryRoot();
    stubIndex(folderSlug, root);
    vi.spyOn(contentIndex, "findSlugAliases").mockImplementation((_ct, ref) =>
      ref === "tutoriales-interactivos"
        ? [{ entryId: "someone-else", kind: "locale_slug", value: "Tutoriales_Interactivos", locale: "es" }]
        : [],
    );
    const result = await checkSlugRename(input(folderSlug));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.statusCode).toBe(409);
    expect(result.code).toBe("slug_already_owned_by_other_entry");
    expect(result.error).toContain("someone-else");
  });

  it("reports the conflicting URL when another entry owns it", async () => {
    const { root, folderSlug } = makeEntryRoot();
    stubIndex(folderSlug, root);
    vi.spyOn(contentIndex, "resolveUrl").mockImplementation((url) =>
      url === NEW_URL
        ? {
            contentType: "pages",
            slug: "someone-else",
            entry: { slug: "someone-else", contentType: "page", directory: "", files: [], locales: [] },
          }
        : null,
    );
    const result = await checkSlugRename(input(folderSlug));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.statusCode).toBe(409);
    expect(result.code).toBe("slug_already_owned_by_other_entry");
    expect(result.conflictUrl).toBe(NEW_URL);
  });

  it("blocks a URL that is a redirect source in the site redirects file", async () => {
    const { root, folderSlug } = makeEntryRoot();
    stubIndex(folderSlug, root, [
      { from: NEW_URL, to: "/es/otra-pagina", type: "custom", status: 301, source: "site_x/custom-redirects.yml" },
    ]);
    const result = await checkSlugRename(input(folderSlug));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.statusCode).toBe(409);
    expect(result.code).toBe("redirect_conflict");
    expect(result.redirectTo).toBe("/es/otra-pagina");
    expect(result.redirectSource).toBe("site_x/custom-redirects.yml");
    expect(result.error).toContain("the site redirects file");
  });

  it("still blocks a redirect from another page even when it points at this page", async () => {
    const { root, folderSlug } = makeEntryRoot();
    stubIndex(folderSlug, root, [
      {
        from: NEW_URL,
        to: "/es/interactive-exercises",
        type: "page",
        status: 301,
        source: "site_x/pages/other-page/es.yml",
      },
    ]);
    const result = await checkSlugRename(input(folderSlug));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("redirect_conflict");
    expect(result.error).toContain("page pages/other-page");
  });

  it("allows renaming back to one of this entry's own redirects", async () => {
    const { root, folderSlug } = makeEntryRoot("meta:\n  redirects:\n    - /es/tutoriales-interactivos/\n");
    stubIndex(folderSlug, root, [
      {
        from: NEW_URL,
        to: "/es/interactive-exercises",
        type: "page",
        status: 301,
        source: `site_x/pages/${folderSlug}/es.yml`,
      },
    ]);
    const result = await checkSlugRename(input(folderSlug));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ownRedirectHit).toBe(true);
  });

  it("refuses with index_warming while redirects are still loading", async () => {
    const { root, folderSlug } = makeEntryRoot();
    stubIndex(folderSlug, root);
    vi.spyOn(contentIndex, "isSlowPhaseReady").mockReturnValue(false);
    const result = await checkSlugRename(input(folderSlug));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.statusCode).toBe(503);
    expect(result.code).toBe("index_warming");
  });

  it("renameContentSlug refuses a redirect conflict and passes code + details", async () => {
    const { root, folderSlug } = makeEntryRoot();
    stubIndex(folderSlug, root, [
      { from: NEW_URL, to: "/es/otra-pagina", type: "custom", status: 301, source: "site_x/custom-redirects.yml" },
    ]);
    const result = await renameContentSlug({
      ...input(folderSlug),
      contentRootName: path.relative(process.cwd(), root),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.statusCode).toBe(409);
    expect(result.code).toBe("redirect_conflict");
    expect(result.details).toMatchObject({ conflictUrl: NEW_URL, redirectTo: "/es/otra-pagina" });
    const onDisk = fs.readFileSync(path.join(root, getFolder("page"), folderSlug, "es.yml"), "utf-8");
    expect(onDisk).toContain("slug: interactive-exercises");
  });

  it("renameContentSlug strips its own redirect when renaming back to an old slug", async () => {
    const { root, folderSlug } = makeEntryRoot(
      "meta:\n  redirects:\n    - /es/tutoriales-interactivos\n    - /es/legacy-path\n",
    );
    stubIndex(folderSlug, root);
    vi.spyOn(contentIndex, "refresh").mockImplementation(() => {});
    vi.spyOn(seoIndexMod, "clusterHasPillarPathPointers").mockReturnValue(false);
    const result = await renameContentSlug({
      ...input(folderSlug),
      contentRootName: path.relative(process.cwd(), root),
    });
    expect(result.success).toBe(true);
    const onDisk = fs.readFileSync(path.join(root, getFolder("page"), folderSlug, "es.yml"), "utf-8");
    expect(onDisk).toContain("slug: tutoriales-interactivos");
    expect(onDisk).not.toContain("/es/tutoriales-interactivos");
    expect(onDisk).toContain("/es/legacy-path");
  });
});
