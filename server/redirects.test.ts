import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./content-types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./content-types")>();
  return {
    ...actual,
    getAllConfigs: () => ({
      blog: {
        directory: "blog",
        single_template: true,
        field_mapping: {
          title: "title",
          category: { source: "category", default: "general" },
          _slug: "slug",
          _locale: "locale",
        },
        url_pattern: {
          en: "/en/blog/:category/:slug",
          es: "/es/blog/:category/:slug",
        },
      },
    }),
  };
});

import { fallbackRedirectMiddleware, findCanonicalSoftMatch, inspectRedirect, isLivePublicUrl, isSelfRedirectTarget, mergeQueryIntoTarget, redirectTargetFromEntryBag, resolveRedirectRequestLocale, testRedirect } from "./redirects";
import { canonicalizePillarPath } from "./seo-fields";
import { applyRedirectTraceCookie } from "./redirect-trace-cookie";
import {
  REDIRECT_TRACE_COOKIE_NAME,
  REDIRECT_TRACE_MAX_HOPS,
  appendRedirectTraceHop,
  parseRedirectTraceCookie,
  type RedirectTraceHop,
} from "@shared/redirect-trace";
import type { contentIndex as ContentIndexType, RedirectEntry } from "./content-index";

function makeCi(opts: {
  knownSlugs?: Record<string, { es?: string; en?: string }>;
  /** Live non-blog URLs (not soft-matchable). */
  knownUrls?: string[];
  redirects?: RedirectEntry[];
}): typeof ContentIndexType {
  const knownSlugs = opts.knownSlugs ?? {};
  const knownUrls = opts.knownUrls ?? [];
  const redirects = opts.redirects ?? [];
  return {
    findBySlug: (slug: string, filter?: { contentType?: string }) => {
      if (filter?.contentType && filter.contentType !== "blog") return [];
      if (!knownSlugs[slug]) return [];
      return [{ slug, contentType: "blog" }];
    },
    getAlternateUrls: (slug: string) => knownSlugs[slug] ?? {},
    isKnownUrl: (url: string) =>
      knownUrls.includes(url) ||
      Object.values(knownSlugs).some((urls) => Object.values(urls).includes(url)),
    getRedirects: () => redirects,
    refreshCustomRedirects: () => redirects,
  } as unknown as typeof ContentIndexType;
}

describe("redirectTargetFromEntryBag", () => {
  it("leaves a fixed destination unchanged", () => {
    expect(redirectTargetFromEntryBag("/en/home", null)).toBe("/en/home");
  });

  it("reads the visited entry field", () => {
    expect(redirectTargetFromEntryBag("{{ entry.redirectTo }}", { redirectTo: "/en/workshop/day-1" })).toBe(
      "/en/workshop/day-1",
    );
  });

  it("does not redirect when the field is empty or missing", () => {
    expect(redirectTargetFromEntryBag("{{ entry.redirectTo }}", { redirectTo: "" })).toBeNull();
    expect(redirectTargetFromEntryBag("{{ entry.redirectTo }}", {})).toBeNull();
    expect(redirectTargetFromEntryBag("{{ entry.redirectTo }}", null)).toBeNull();
  });

  it("rejects a destination that is not a site path or http(s) URL", () => {
    expect(redirectTargetFromEntryBag("{{ entry.redirectTo }}", { redirectTo: "javascript:alert(1)" })).toBeNull();
    expect(redirectTargetFromEntryBag("{{ entry.redirectTo }}", { redirectTo: "//evil.example/phish" })).toBeNull();
  });
});

describe("isSelfRedirectTarget", () => {
  const host = "business.4geeks.com";

  it("flags a redirect back to the same path", () => {
    expect(isSelfRedirectTarget("/en/home", host, "/en/home")).toBe(true);
  });

  it("flags a same-path target that only adds a query string", () => {
    expect(isSelfRedirectTarget("/en/home", host, "/en/home?utm_source=x")).toBe(true);
  });

  it("flags an absolute same-host target with the same path", () => {
    expect(isSelfRedirectTarget("/en/home", host, "https://business.4geeks.com/en/home")).toBe(true);
  });

  it("allows case and trailing-slash canonicalization", () => {
    expect(isSelfRedirectTarget("/en/Home", host, "/en/home")).toBe(false);
    expect(isSelfRedirectTarget("/en/home/", host, "/en/home")).toBe(false);
  });

  it("allows different paths and other hosts", () => {
    expect(isSelfRedirectTarget("/", host, "/en/home")).toBe(false);
    expect(isSelfRedirectTarget("/en/home", host, "https://4geeks.com/en/home")).toBe(false);
  });
});

describe("resolveRedirectRequestLocale", () => {
  it("prefers /es/ path prefix over English Accept-Language", () => {
    expect(
      resolveRedirectRequestLocale({
        path: "/es/blog/coding-bootcamps/legacy-slug",
        headers: { "accept-language": "en-US,en;q=0.9" },
      }),
    ).toBe("es");
  });

  it("uses Accept-Language when the path has no locale prefix", () => {
    expect(
      resolveRedirectRequestLocale({
        path: "/coding-bootcamps/legacy-slug",
        headers: { "accept-language": "es-ES,es;q=0.9" },
      }),
    ).toBe("es");
  });

  it("defaults to en when path and Accept-Language are ambiguous", () => {
    expect(
      resolveRedirectRequestLocale({
        path: "/coding-bootcamps/legacy-slug",
        headers: {},
      }),
    ).toBe("en");
  });
});

describe("findCanonicalSoftMatch", () => {
  it("returns null when the last segment is not a real slug", () => {
    const ci = makeCi({ knownSlugs: {} });
    expect(
      findCanonicalSoftMatch(
        "/es/blog/herramientas-ia/mejores-agentes-de-codigo8",
        ci,
      ),
    ).toBeNull();
  });

  it("301-soft-matches wrong category when the slug exists", () => {
    const ci = makeCi({
      knownSlugs: {
        "real-post": {
          es: "/es/blog/herramientas-ia/real-post",
          en: "/en/blog/ai-tools/real-post",
        },
      },
    });
    const soft = findCanonicalSoftMatch("/es/blog/wrong-category/real-post", ci);
    expect(soft).toEqual({
      typeName: "blog",
      canonicalUrl: "/es/blog/herramientas-ia/real-post",
    });
  });

  it("returns null when URL is already canonical", () => {
    const ci = makeCi({
      knownSlugs: {
        "real-post": { es: "/es/blog/herramientas-ia/real-post" },
      },
    });
    expect(
      findCanonicalSoftMatch("/es/blog/herramientas-ia/real-post", ci),
    ).toBeNull();
  });

  it("soft-matches when only slug casing differs", () => {
    const ci = makeCi({
      knownSlugs: {
        "cuanto-gana-un-programador-en-colombia": {
          es: "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
        },
      },
    });
    const soft = findCanonicalSoftMatch(
      "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-Colombia",
      ci,
    );
    expect(soft).toEqual({
      typeName: "blog",
      canonicalUrl:
        "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
    });
  });

  it("does not soft-match when the URL is already a known page (cross-type slug collision)", () => {
    const programUrl = "/es/programas-de-carrera/curso-inteligencia-artificial";
    const blogUrl = "/es/blog/aprendizaje-potenciado-con-ia/curso-inteligencia-artificial";
    const ci = makeCi({
      knownSlugs: {
        "curso-inteligencia-artificial": { es: blogUrl },
      },
    });
    (ci as { isKnownUrl: (url: string) => boolean }).isKnownUrl = (url: string) =>
      url === programUrl || url === blogUrl;

    expect(findCanonicalSoftMatch(programUrl, ci)).toBeNull();
    expect(findCanonicalSoftMatch(blogUrl, ci)).toBeNull();
    expect(findCanonicalSoftMatch(`${programUrl}/`, ci)).toBeNull();
  });

  it("does not soft-match onto an alternate URL that is not known", () => {
    const ci = makeCi({
      knownSlugs: {
        // Truncated alternate (missing :category) — must not rewrite a live path.
        "inside-4geeks-platform": {
          en: "/en/blog/inside-4geeks-platform",
        },
      },
    });
    // Override isKnownUrl: only the full category URL is live (truncated is not).
    (ci as { isKnownUrl: (url: string) => boolean }).isKnownUrl = (url: string) =>
      url === "/en/blog/ai-powered-learning/inside-4geeks-platform";
    expect(
      findCanonicalSoftMatch(
        "/en/blog/ai-powered-learning/inside-4geeks-platform",
        ci,
      ),
    ).toBeNull();
  });
});

describe("canonicalizePillarPath with broken blog alternate", () => {
  it("keeps a live /:category/:slug pillar path instead of truncating", () => {
    const full = "/en/blog/ai-powered-learning/inside-4geeks-platform";
    const ci = makeCi({
      knownSlugs: {
        "inside-4geeks-platform": { en: "/en/blog/inside-4geeks-platform" },
      },
    });
    (ci as { isKnownUrl: (url: string) => boolean }).isKnownUrl = (url: string) =>
      url === full;
    expect(canonicalizePillarPath(full, "en", ci as never).path).toBe(full);
  });
});

describe("testRedirect includes canonical soft-match", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reports no match for a missing blog slug", () => {
    const ci = makeCi({ knownSlugs: {} });
    const result = testRedirect(
      "/es/blog/herramientas-ia/mejores-agentes-de-codigo8",
      "es",
      ci,
    );
    expect(result.match).toBe(false);
    expect(result.pageExists).toBe(false);
  });

  it("reports canonical match for wrong category + existing slug", () => {
    const ci = makeCi({
      knownSlugs: {
        "real-post": {
          es: "/es/blog/herramientas-ia/real-post",
        },
      },
    });
    const result = testRedirect("/es/blog/wrong-category/real-post", "es", ci);
    expect(result.match).toBe(true);
    expect(result.matchType).toBe("canonical");
    expect(result.status).toBe(301);
    expect(result.resolvedTo).toBe("/es/blog/herramientas-ia/real-post");
    expect(result.destinationExists).toBe(true);
    expect(isLivePublicUrl(result)).toBe(true);
  });

  it("reports canonical match when slug case differs (Colombia vs colombia)", () => {
    const ci = makeCi({
      knownSlugs: {
        "cuanto-gana-un-programador-en-colombia": {
          es: "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
        },
      },
    });
    const result = testRedirect(
      "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-Colombia",
      "es",
      ci,
    );
    expect(result.match).toBe(true);
    expect(result.matchType).toBe("canonical");
    expect(result.resolvedTo).toBe(
      "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
    );
    expect(result.destinationExists).toBe(true);
    expect(isLivePublicUrl(result)).toBe(true);
  });
});

describe("regex capture groups lowercase for relative destinations", () => {
  it("lowercases $n when substituting into a site path", () => {
    const ci = {
      findBySlug: () => [],
      getAlternateUrls: () => ({}),
      isKnownUrl: (url: string) =>
        url ===
        "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
      getRedirects: () => [
        {
          from: "/es/(?!blog/|how-to/)([a-z_-]+)/([a-z0-9_-]+)",
          to: "/es/blog/$1/$2",
          type: "custom",
          source: "test",
          status: 301,
          priority: "fallback",
        },
      ],
      refreshCustomRedirects: () => [
        {
          from: "/es/(?!blog/|how-to/)([a-z_-]+)/([a-z0-9_-]+)",
          to: "/es/blog/$1/$2",
          type: "custom",
          source: "test",
          status: 301,
          priority: "fallback",
        },
      ],
    } as unknown as typeof ContentIndexType;

    const result = testRedirect(
      "/es/cuanto-gana-un-programador/cuanto-gana-un-programador-en-Colombia",
      "es",
      ci,
    );
    expect(result.match).toBe(true);
    expect(result.resolvedTo).toBe(
      "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
    );
    expect(result.destinationExists).toBe(true);
  });
});

describe("guarded custom regex fallbacks", () => {
  const custom = (from: string, to: string, priority: "before" | "fallback" = "fallback"): RedirectEntry => ({
    from,
    to,
    type: "custom",
    source: "site_4geeks-com/custom-redirects.yml",
    status: 301,
    priority,
  });

  const rules: RedirectEntry[] = [
    custom("/us/landing/([a-z\\-_\\d]+)", "/landing/$1"),
    custom("/us/coding-bootcamps/(.*)", "/en/career-programs/$1"),
    custom("/us/([a-z\\-_]+)/([a-z\\-_\\d]+)", "/en/blog/$1/$2"),
    custom("/us/(.*)", "/en/$1"),
    custom("/en/signup", "https://learn.4geeks.com/login", "before"),
    custom(
      "/es/(?!blog/|how-to/|career-programs/|programas-de-carrera/|program-comparison|ubicacion/|location/|landing/)([a-z_-]+)/([a-z0-9_-]+)",
      "/es/blog/$1/$2",
    ),
    custom("/loop/([a-z]+)", "/en/a-$1"),
    custom("/en/a-x", "/en/b-x", "before"),
    custom("/en/b-x", "/en/a-x", "before"),
  ];

  const makeGuardCi = () =>
    makeCi({
      knownSlugs: {
        "become-an-ai-engineer": { en: "/en/blog/ai-powered-learning/become-an-ai-engineer" },
        "cuanto-gana-un-programador-en-colombia": {
          es: "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
        },
      },
      knownUrls: ["/en/apply"],
      redirects: rules,
    });

  function runMiddleware(ci: typeof ContentIndexType, path: string): string | null {
    let location: string | null = null;
    const req = { path, originalUrl: path, headers: { host: "4geeks.com" }, cookies: {}, hostname: "4geeks.com" } as any;
    const res = {
      locals: { site: { contentIndex: ci } },
      cookie: () => {},
      redirect: (_status: number, to: string) => {
        location = to;
      },
    } as any;
    fallbackRedirectMiddleware(req, res, () => {});
    return location;
  }

  const cases: Array<[string, string | null]> = [
    ["/us/ai-powered-learning/become-an-ai-engineer", "/en/blog/ai-powered-learning/become-an-ai-engineer"],
    ["/us/blog/foo", null],
    ["/us/apply", "/en/apply"],
    ["/us/wrong-cat/become-an-ai-engineer", "/en/blog/ai-powered-learning/become-an-ai-engineer"],
    ["/us/signup", "https://learn.4geeks.com/login"],
    ["/us/coding-bootcamps/renamed-program", null],
    ["/es/seccion-inexistente/x", null],
    [
      "/es/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
      "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
    ],
    ["/loop/x", null],
  ];

  it.each(cases)("Test a URL: %s -> %s", (path, expected) => {
    const result = testRedirect(path, path.startsWith("/es/") ? "es" : "en", makeGuardCi());
    if (expected === null) {
      expect(result.match).toBe(false);
    } else {
      expect(result.match).toBe(true);
      expect(result.resolvedTo).toBe(expected);
      expect(isLivePublicUrl(result)).toBe(true);
    }
  });

  it.each(cases)("middleware matches Test a URL: %s -> %s", (path, expected) => {
    expect(runMiddleware(makeGuardCi(), path)).toBe(expected);
  });
});

describe("isLivePublicUrl matches Test a URL", () => {
  it("treats a known page with query string as live", () => {
    const ci = makeCi({
      knownSlugs: { apply: { en: "/en/apply" } },
    });
    const result = testRedirect("/en/apply?program=ai-fluency", "en", ci);
    expect(result.match).toBe(false);
    expect(result.pageExists).toBe(true);
    expect(isLivePublicUrl(result)).toBe(true);
  });

  it("treats an unknown path as not live", () => {
    const ci = makeCi({ knownSlugs: {} });
    const result = testRedirect("/en/missing-page", "en", ci);
    expect(isLivePublicUrl(result)).toBe(false);
  });
});

describe("inspectRedirect", () => {
  it("reports /us winner from homepage en.yml without overwrites_content (locale-home alias)", () => {
    const ci = makeCi({
      redirects: [
        {
          from: "/us",
          to: "/en/home",
          type: "page",
          source: "site_4geeks-com/pages/home/en.yml",
          status: 301,
          priority: "before",
        },
      ],
    });
    const result = inspectRedirect("/us", "en", ci);
    expect(result.winner.match).toBe(true);
    expect(result.winner.from).toBe("/us");
    expect(result.winner.source).toBe("site_4geeks-com/pages/home/en.yml");
    expect(result.live_content).toBe(false);
    expect(result.conflicts.some((c) => c.kind === "overwrites_content")).toBe(false);
  });

  it("reports /en winner without overwrites_content (locale-home alias)", () => {
    const ci = makeCi({
      redirects: [
        {
          from: "/en",
          to: "/en/home",
          type: "page",
          source: "site_4geeks-com/pages/home/en.yml",
          status: 301,
          priority: "before",
        },
      ],
    });
    const result = inspectRedirect("/en", "en", ci);
    expect(result.winner.match).toBe(true);
    expect(result.live_content).toBe(false);
    expect(result.conflicts.some((c) => c.kind === "overwrites_content")).toBe(false);
  });

  it("flags overwrites_content when redirect source is a known content URL", () => {
    const ci = makeCi({
      knownSlugs: { apply: { en: "/en/apply" } },
      redirects: [
        {
          from: "/en/apply",
          to: "/en/home",
          type: "page",
          source: "site_4geeks-com/pages/home/en.yml",
          status: 301,
          priority: "before",
        },
      ],
    });
    const result = inspectRedirect("/en/apply", "en", ci);
    expect(result.winner.match).toBe(true);
    expect(result.live_content).toBe(true);
    expect(result.conflicts.some((c) => c.kind === "overwrites_content")).toBe(true);
  });

  it("matches /us/foo with custom /us/(.*)", () => {
    const ci = makeCi({
      redirects: [
        {
          from: "/us/(.*)",
          to: "/en/$1",
          type: "custom",
          source: "site_4geeks-com/custom-redirects.yml",
          status: 301,
          priority: "before",
        },
      ],
    });
    const result = inspectRedirect("/us/foo", "en", ci);
    expect(result.winner.match).toBe(true);
    expect(result.winner.from).toBe("/us/(.*)");
    expect(result.winner.resolvedTo).toBe("/en/foo");
    expect(result.winner.source).toBe("site_4geeks-com/custom-redirects.yml");
    expect(result.conflicts.some((c) => c.kind === "overwrites_content")).toBe(false);
  });

  it("keeps one winner and flags duplicate_from", () => {
    const ci = makeCi({
      redirects: [
        {
          from: "/old-path",
          to: "/en/a",
          type: "page",
          source: "site_4geeks-com/pages/a/en.yml",
          status: 301,
          priority: "before",
        },
        {
          from: "/old-path",
          to: "/en/b",
          type: "custom",
          source: "site_4geeks-com/custom-redirects.yml",
          status: 301,
          priority: "before",
        },
      ],
    });
    const result = inspectRedirect("/old-path", "en", ci);
    expect(result.winner.source).toBe("site_4geeks-com/pages/a/en.yml");
    expect(result.conflicts.filter((c) => c.kind === "duplicate_from")).toHaveLength(1);
    expect(result.conflicts[0]?.source).toBe("site_4geeks-com/custom-redirects.yml");
    const deleteFix = result.fixes.find((f) => f.kind === "duplicate_from");
    expect(deleteFix?.args_hint).toMatchObject({
      tool: "update_redirect",
      action: "delete",
      from: "/old-path",
      source: "site_4geeks-com/custom-redirects.yml",
    });
  });

  it("flags regex_shadowed with update_redirect action: move hint", () => {
    const ci = makeCi({
      redirects: [
        {
          from: "/en/(.*)",
          to: "/x/$1",
          type: "custom",
          source: "site_4geeks-com/custom-redirects.yml",
          status: 301,
          priority: "before",
        },
        {
          from: "/en/blog/(.*)",
          to: "/y/$1",
          type: "custom",
          source: "site_4geeks-com/custom-redirects.yml",
          status: 301,
          priority: "before",
        },
      ],
    });
    const result = inspectRedirect("/en/blog/foo", "en", ci);
    expect(result.winner.from).toBe("/en/(.*)");
    const shadowed = result.conflicts.find((c) => c.kind === "regex_shadowed");
    expect(shadowed?.from).toBe("/en/blog/(.*)");
    const moveFix = result.fixes.find((f) => f.kind === "regex_shadowed");
    expect(moveFix?.args_hint).toMatchObject({
      tool: "update_redirect",
      action: "move",
      from: "/en/blog/(.*)",
      before_from: "/en/(.*)",
    });
  });
});

describe("redirect trace cookie", () => {
  it("appends hops and caps at REDIRECT_TRACE_MAX_HOPS", () => {
    let hops: RedirectTraceHop[] = [];
    for (let i = 0; i < REDIRECT_TRACE_MAX_HOPS + 2; i++) {
      hops = appendRedirectTraceHop(hops, {
        from: `/from-${i}`,
        to: `/to-${i}`,
        status: 301,
        matchType: "fallback",
        source: "site_4geeks-com/custom-redirects.yml",
      });
    }
    expect(hops).toHaveLength(REDIRECT_TRACE_MAX_HOPS);
    expect(hops[0]?.from).toBe("/from-0");
  });

  it("applyRedirectTraceCookie writes a parseable cookie", () => {
    const cookies: Record<string, string> = {};
    const req = { cookies: {}, hostname: "localhost" } as any;
    const res = {
      cookie: (name: string, value: string) => {
        cookies[name] = value;
      },
    } as any;
    applyRedirectTraceCookie(req, res, {
      from: "/es/interactive-exercise/foo",
      to: "/es/blog/interactive-exercise/foo",
      status: 301,
      matchType: "fallback",
      priority: "fallback",
      source: "site_4geeks-com/custom-redirects.yml",
    });
    const parsed = parseRedirectTraceCookie(cookies[REDIRECT_TRACE_COOKIE_NAME]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.from).toBe("/es/interactive-exercise/foo");
    expect(parsed[0]?.matchType).toBe("fallback");
  });
});

describe("mergeQueryIntoTarget", () => {
  it("appends the inbound query when the target has none", () => {
    expect(mergeQueryIntoTarget("/en/landing", "/old?utm_source=fb&utm_medium=paid_social")).toBe(
      "/en/landing?utm_source=fb&utm_medium=paid_social",
    );
  });

  it("merges into a target that already has a query instead of adding a second ?", () => {
    const out = mergeQueryIntoTarget("/en/landing?foo=1", "/old?utm_source=fb");
    expect(out).toBe("/en/landing?foo=1&utm_source=fb");
    expect(out.split("?")).toHaveLength(2);
  });

  it("lets the inbound value win on the same key", () => {
    expect(mergeQueryIntoTarget("/en/landing?utm_source=site&foo=1", "/old?utm_source=fb")).toBe(
      "/en/landing?utm_source=fb&foo=1",
    );
  });

  it("leaves the target alone when neither side has a query", () => {
    expect(mergeQueryIntoTarget("/en/landing", "/old")).toBe("/en/landing");
    expect(mergeQueryIntoTarget("/en/landing?foo=1", "/old")).toBe("/en/landing?foo=1");
  });

  it("keeps the target hash after the merged query", () => {
    expect(mergeQueryIntoTarget("https://x.com/a?foo=1#top", "/old?utm_id=9")).toBe("https://x.com/a?foo=1&utm_id=9#top");
  });
});
