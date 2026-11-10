import { describe, expect, it } from "vitest";
import {
  buildContentTypeRoutes,
  consensusSitemapContentType,
  contentTypeForSitemapFolder,
  inferPublicPageChunk,
  listingPrefix,
  matchContentTypeRoute,
  type ContentTypeRouteInput,
  type SitemapFolderContentTypes,
} from "./content-type-routes";

const FAKE_TYPES: ContentTypeRouteInput[] = [
  {
    name: "program",
    has_database: false,
    single_template: false,
    url_pattern: {
      en: "/en/career-programs/:slug",
      es: "/es/programas-de-carrera/:slug",
    },
  },
  {
    name: "location",
    has_database: false,
    single_template: false,
    url_pattern: {
      en: "/en/location/:slug",
      es: "/es/ubicacion/:slug",
    },
  },
  {
    name: "page",
    has_database: false,
    single_template: false,
    url_pattern: {
      en: "/en/:slug",
      es: "/es/:slug",
    },
  },
  {
    name: "blog",
    has_database: false,
    single_template: true,
    url_pattern: {
      en: "/en/blog/:category/:slug",
      es: "/es/blog/:category/:slug",
    },
  },
  {
    name: "how-to",
    has_database: true,
    single_template: true,
    url_pattern: {
      en: "/en/how-to/:slug",
      es: "/es/how-to/:slug",
    },
  },
];

function paths(types = FAKE_TYPES) {
  return buildContentTypeRoutes(types).map((r) => r.path);
}

describe("buildContentTypeRoutes", () => {
  it("emits program and location patterns so JSX duplicates are not needed", () => {
    const routes = buildContentTypeRoutes(FAKE_TYPES);
    expect(routes.some((r) => r.path === "/en/career-programs/:slug" && r.type === "program")).toBe(
      true,
    );
    expect(
      routes.some((r) => r.path === "/es/programas-de-carrera/:slug" && r.type === "program"),
    ).toBe(true);
    expect(routes.some((r) => r.path === "/en/location/:slug" && r.type === "location")).toBe(true);
    expect(routes.some((r) => r.path === "/es/ubicacion/:slug" && r.type === "location")).toBe(true);
    expect(
      routes.find((r) => r.path === "/en/career-programs/:slug")?.kind,
    ).toBe("content-type-detail");
  });

  it("sorts page /en/:slug after career-programs and blog multi-param routes", () => {
    const routes = buildContentTypeRoutes(FAKE_TYPES);
    const list = routes.map((r) => r.path);
    const pageEn = list.indexOf("/en/:slug");
    const programsEn = list.indexOf("/en/career-programs/:slug");
    const blogEn = list.indexOf("/en/blog/:category/:slug");
    expect(pageEn).toBeGreaterThan(programsEn);
    expect(pageEn).toBeGreaterThan(blogEn);
    const firstPage = routes.findIndex((r) => r.type === "page");
    expect(firstPage).toBeGreaterThan(programsEn);
    expect(routes.slice(firstPage).every((r) => r.type === "page")).toBe(true);
  });

  it("emits regional /:locale/career-programs/:slug and /:locale/:slug", () => {
    const list = paths();
    expect(list).toContain("/:locale/career-programs/:slug");
    expect(list).toContain("/:locale/:slug");
    const regionalPage = buildContentTypeRoutes(FAKE_TYPES).find(
      (r) => r.path === "/:locale/:slug",
    );
    expect(regionalPage).toMatchObject({ type: "page", regional: true, kind: "template" });
    const regionalProgram = buildContentTypeRoutes(FAKE_TYPES).find(
      (r) => r.path === "/:locale/career-programs/:slug",
    );
    expect(regionalProgram).toMatchObject({
      type: "program",
      regional: true,
      kind: "content-type-detail",
    });
  });

  it("does not emit a blog listing prefix", () => {
    const routes = buildContentTypeRoutes(FAKE_TYPES);
    expect(routes.some((r) => r.path === "/en/blog" || r.path === "/es/blog")).toBe(false);
    expect(routes.some((r) => r.type === "blog" && r.isListingPrefix)).toBe(false);
    expect(routes.find((r) => r.path === "/en/blog/:category/:slug")?.kind).toBe("database-single");
  });

  it("emits a how-to listing prefix because it has_database", () => {
    const routes = buildContentTypeRoutes(FAKE_TYPES);
    expect(routes.some((r) => r.path === "/en/how-to" && r.isListingPrefix && r.kind === "template")).toBe(
      true,
    );
    expect(routes.some((r) => r.path === "/:locale/how-to" && r.isListingPrefix && r.regional)).toBe(
      true,
    );
    expect(routes.find((r) => r.path === "/en/how-to/*")?.kind).toBe("database-single");
  });
});

describe("matchContentTypeRoute / inferPublicPageChunk", () => {
  const routes = buildContentTypeRoutes(FAKE_TYPES);

  it("matches blog singles before the page catch-all", () => {
    const match = matchContentTypeRoute(
      "/en/blog/herramientas-ia/mejores-agentes-de-codigo",
      routes,
    );
    expect(match).toMatchObject({ type: "blog", kind: "database-single" });
    expect(inferPublicPageChunk("/en/blog/foo/bar", FAKE_TYPES)).toBe("database-single");
  });

  it("matches regional program URLs and not plain /es/ on the en pattern", () => {
    expect(matchContentTypeRoute("/es-mx/career-programs/full-stack", routes)).toMatchObject({
      type: "program",
      regional: true,
    });
    expect(matchContentTypeRoute("/es/career-programs/full-stack", routes)).toBeNull();
    expect(inferPublicPageChunk("/en/career-programs/full-stack", FAKE_TYPES)).toBe(
      "content-type-detail",
    );
  });

  it("falls back to template when content types are missing", () => {
    expect(inferPublicPageChunk("/en/about")).toBe("template");
  });
});

const FOLDER_TYPES: SitemapFolderContentTypes = {
  authors: {
    directory: "authors",
    url_pattern: { en: "/en/authors/:slug", es: "/es/autores/:slug" },
  },
  blog: {
    directory: "blog",
    url_pattern: { en: "/en/blog/:category/:slug", es: "/es/blog/:category/:slug" },
  },
  page: {
    directory: "pages",
    url_pattern: { en: "/en/:slug", es: "/es/:slug" },
  },
  program: {
    directory: "programs",
    url_pattern: { en: "/en/career-programs/:slug", es: "/es/programas-de-carrera/:slug" },
  },
};

describe("listingPrefix", () => {
  it("strips trailing param segments including category+slug", () => {
    expect(listingPrefix("/en/authors/:slug")).toBe("/en/authors");
    expect(listingPrefix("/en/blog/:category/:slug")).toBe("/en/blog");
    expect(listingPrefix("/en/:slug")).toBe("/en");
  });
});

describe("consensusSitemapContentType", () => {
  it("returns the shared type or null when missing/mixed", () => {
    expect(consensusSitemapContentType([{ content_type: "authors" }, { content_type: "authors" }])).toBe(
      "authors",
    );
    expect(consensusSitemapContentType([{ content_type: "authors" }, { content_type: "blog" }])).toBeNull();
    expect(consensusSitemapContentType([{ content_type: "authors" }, {}])).toBeNull();
    expect(consensusSitemapContentType([])).toBeNull();
  });
});

describe("contentTypeForSitemapFolder", () => {
  it("matches public listing prefixes and translated es paths", () => {
    expect(contentTypeForSitemapFolder("/en/authors", FOLDER_TYPES, "authors")).toBe("authors");
    expect(contentTypeForSitemapFolder("/es/autores", FOLDER_TYPES, "authors")).toBe("authors");
    expect(contentTypeForSitemapFolder("/en/career-programs", FOLDER_TYPES, "program")).toBe("program");
  });

  it("skips locale buckets and category folders", () => {
    expect(contentTypeForSitemapFolder("/en", FOLDER_TYPES, "page")).toBeNull();
    expect(contentTypeForSitemapFolder("/en/blog/ai", FOLDER_TYPES, "blog")).toBeNull();
    expect(contentTypeForSitemapFolder("/en/blog", FOLDER_TYPES, "blog")).toBe("blog");
  });

  it("matches regional xx-yy prefixes", () => {
    expect(contentTypeForSitemapFolder("/us-en/authors", FOLDER_TYPES, "authors")).toBe("authors");
    expect(contentTypeForSitemapFolder("/es-mx/career-programs", FOLDER_TYPES, "program")).toBe(
      "program",
    );
    expect(contentTypeForSitemapFolder("/us-en/blog/ai", FOLDER_TYPES, "blog")).toBeNull();
  });

  it("matches /private/preview/{type} and {directory}", () => {
    expect(contentTypeForSitemapFolder("/private/preview/authors", FOLDER_TYPES, "authors")).toBe(
      "authors",
    );
    expect(contentTypeForSitemapFolder("/private/preview/pages", FOLDER_TYPES, "page")).toBe("page");
    expect(contentTypeForSitemapFolder("/private/preview/page", FOLDER_TYPES, "page")).toBe("page");
    expect(contentTypeForSitemapFolder("/private/preview/programs", FOLDER_TYPES, "program")).toBe(
      "program",
    );
  });

  it("returns null when types are unloaded, consensus is missing, or mixed", () => {
    expect(contentTypeForSitemapFolder("/en/authors", null, "authors")).toBeNull();
    expect(contentTypeForSitemapFolder("/en/authors", FOLDER_TYPES, null)).toBeNull();
    expect(
      contentTypeForSitemapFolder(
        "/en/authors",
        FOLDER_TYPES,
        consensusSitemapContentType([{ content_type: "authors" }, { content_type: "blog" }]),
      ),
    ).toBeNull();
    expect(contentTypeForSitemapFolder("/en/authors", FOLDER_TYPES, "blog")).toBeNull();
  });
});
