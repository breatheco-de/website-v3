import { describe, it, expect, vi } from "vitest";

vi.mock("./single-resolver", () => ({
  resolveSingleVars: (page: unknown) => page,
}));
vi.mock("./build-single-entry", () => ({
  buildSingleEntryFromContent: () => ({}),
}));
vi.mock("./content-types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./content-types")>()),
  finalizeSingleEntryForTemplates: (x: unknown) => x,
  getContentTypeConfig: () => ({
    editor: {
      title: { required: true },
      description: { required: true },
    },
  }),
  getFolder: () => "blog",
  resolveContentTypeUrl: (type: string, record: { slug?: string }) =>
    type === "landing" ? `/landing/${record.slug}` : null,
}));
vi.mock("./draft-entry", () => ({
  isDraftEntry: () => false,
}));
vi.mock("./shared-layout-entry", () => ({
  isEntryDetached: () => false,
  isSharedLayoutType: () => false,
}));
vi.mock("./database-single-loader", () => ({
  mergeSingleTemplate: () => null,
}));
vi.mock("./utils/deepMerge", () => ({
  deepMerge: (a: object, b: object) => ({ ...a, ...b }),
}));
vi.mock("./site-config", () => ({
  getDefaultContentRoot: () => "/tmp",
  getDefaultContentFolder: () => "site_test",
  getSiteConfigs: () => [{ domain: "4geeks.com", contentFolder: "site_test" }],
}));
vi.mock("./content-index", () => ({
  contentIndex: {
    loadMergedContent: () => ({ data: null }),
    getLocaleUrls: () => ({}),
    getRedirects: () => [],
    refreshCustomRedirects: () => [],
  },
}));
vi.mock("./schema-org-requirements", () => ({
  formatSchemaOrgCompanionGateError: (opts: { sections: unknown }) => {
    const sections = Array.isArray(opts.sections) ? opts.sections : [];
    const hasHeroCourse = sections.some(
      (s) =>
        !!s &&
        typeof s === "object" &&
        (s as { type?: string }).type === "hero" &&
        (s as { variant?: string }).variant === "course",
    );
    const hasCourse = sections.some(
      (s) =>
        !!s &&
        typeof s === "object" &&
        (s as { type?: string }).type === "schema_org" &&
        (s as { schema_type?: string }).schema_type === "Course",
    );
    if (hasHeroCourse && !hasCourse) {
      return "hero variant course requires companion schema_org Course section";
    }
    return null;
  },
}));

import { evaluateLiveEntrySeoAndRequiredFields } from "./live-entry-seo-gate";
import { LIVE_REQUIRED_FIELDS_CODE } from "@shared/liveSeoGate";

describe("evaluateLiveEntrySeoAndRequiredFields", () => {
  it("publish: returns missing_fields for both meta and editor.required gaps together", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "blog",
      slug: "how-to-pay-a-coding-bootcamp-2022",
      locale: "en",
      pageData: {
        meta: { page_title: "", description: "" },
        title: "",
        description: "",
      },
      intent: "publish",
      isDraftWrite: false,
    });
    expect(failure).not.toBeNull();
    expect(failure?.code).toBe(LIVE_REQUIRED_FIELDS_CODE);
    expect(failure?.missing_fields).toEqual([
      "meta.page_title",
      "meta.description",
      "title",
      "description",
    ]);
    expect(failure?.message).toContain("CIRCULAR_REQUIRED_FIELDS");
    expect(failure?.message).toContain("update_fields");
  });

  it("micro with empty touchedPaths skips required meta (structural add path)", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "blog",
      slug: "how-to-pay-a-coding-bootcamp-2022",
      locale: "en",
      pageData: {
        meta: { page_title: "", description: "" },
        title: "",
        description: "",
        sections: [{ type: "hero", variant: "course" }],
      },
      intent: "micro",
      touchedPaths: [],
      isDraftWrite: false,
    });
    expect(failure).toBeNull();
  });

  it("publish fails when Course companion missing for hero course", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "program",
      slug: "full-stack",
      locale: "en",
      pageData: {
        meta: {
          page_title: "Full Stack",
          description: "A complete program description for SEO gate.",
        },
        title: "Full Stack",
        description: "A complete program description for SEO gate.",
        sections: [{ type: "hero", variant: "course" }],
      },
      intent: "publish",
      isDraftWrite: false,
    });
    expect(failure).not.toBeNull();
    expect(failure?.code).toBe("schema_org_companion");
    expect(failure?.message).toContain("companion schema_org Course");
  });

  it("micro empty touchedPaths allows missing Course companion", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "program",
      slug: "full-stack",
      locale: "en",
      pageData: {
        meta: {
          page_title: "Full Stack",
          description: "A complete program description for SEO gate.",
        },
        title: "Full Stack",
        description: "A complete program description for SEO gate.",
        sections: [
          { type: "schema_org", schema_type: "WebSite", properties: {} },
          { type: "hero", variant: "course" },
        ],
      },
      intent: "micro",
      touchedPaths: [],
      isDraftWrite: false,
    });
    expect(failure).toBeNull();
  });

  it("passes when meta and required fields are populated", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "blog",
      slug: "ok-post",
      locale: "en",
      pageData: {
        meta: {
          page_title: "How to pay",
          description: "A helpful overview of financing options.",
        },
        title: "How to pay",
        description: "A helpful overview of financing options.",
        sections: [{ type: "hero" }],
      },
      intent: "publish",
      isDraftWrite: false,
    });
    expect(failure).toBeNull();
  });

  it("publish refuses an empty section-built page (empty_page); micro save does not", () => {
    const pageData = {
      meta: {
        page_title: "Free AI Engineering Interview Kit",
        description: "Practice questions and a score card used by students.",
      },
      title: "Kit",
      description: "Kit description.",
    };
    const publish = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "downloadable",
      slug: "kit",
      locale: "en",
      pageData,
      intent: "publish",
      isDraftWrite: false,
    });
    expect(publish?.code).toBe("empty_page");
    expect(publish?.message).toMatch(/^EMPTY_PAGE: downloadable\/kit \(en\)/);

    const micro = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "downloadable",
      slug: "kit",
      locale: "en",
      pageData,
      intent: "micro",
      touchedPaths: ["title"],
      isDraftWrite: false,
    });
    expect(micro).toBeNull();
  });

  it("passes after meta.robots patch when title and description remain on meta", () => {
    const pageData = {
      slug: "ai-engineering-program-ad-mx",
      title: "Programa de Ingeniería de IA en MX",
      description: "Landing program description for gate.",
      meta: {
        page_title: "Ingeniería en IA | Programa en México con 4Geeks",
        description:
          "Desarrolla soluciones de IA con mentoría y comunidad profesional en 4Geeks Academy.",
        robots: "index, follow",
        change_frequency: "weekly",
      },
      sections: [{ type: "hero" }],
    };
    pageData.meta.robots = "noindex, nofollow";

    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "landing",
      slug: "ai-engineering-program-ad-mx",
      locale: "es",
      pageData,
      intent: "publish",
      isDraftWrite: false,
    });
    expect(failure).toBeNull();
  });

  it("micro save with meta.robots only passes when snippet meta empty on merged page", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "landing",
      slug: "ai-engineering-program-ad-mx",
      locale: "es",
      pageData: {
        slug: "ai-engineering-program-ad-mx",
        meta: {
          robots: "noindex, nofollow",
          change_frequency: "weekly",
        },
      },
      intent: "micro",
      touchedPaths: ["meta.robots"],
      isDraftWrite: false,
    });
    expect(failure).toBeNull();
  });

  it("micro save with locations only skips required meta", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "landing",
      slug: "ai-engineering-program-ad-mx",
      locale: "es",
      pageData: {
        slug: "ai-engineering-program-ad-mx",
        locations: ["mexicocity-mexico"],
        meta: {},
      },
      intent: "micro",
      touchedPaths: ["locations"],
      isDraftWrite: false,
    });
    expect(failure).toBeNull();
  });

  it("publish intent fails when meta missing", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "landing",
      slug: "ai-engineering-program-ad-mx",
      locale: "es",
      pageData: {
        slug: "ai-engineering-program-ad-mx",
        meta: { robots: "index, follow" },
        title: "",
        description: "",
      },
      intent: "publish",
      isDraftWrite: false,
    });
    expect(failure).not.toBeNull();
    expect(failure?.missing_fields).toEqual(
      expect.arrayContaining(["meta.page_title", "meta.description"]),
    );
  });

  it("publish does not block on missing cluster hub back-link", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "blog",
      slug: "spoke",
      locale: "en",
      pageData: {
        meta: {
          page_title: "Spoke article",
          description: "A helpful spoke article for SEO cluster testing.",
        },
        title: "Spoke article",
        description: "A helpful spoke article for SEO cluster testing.",
        content: "No hub link in body",
        seo: { pillar_path: "/en/blog/hub", is_pillar: false },
      },
      intent: "publish",
      isDraftWrite: false,
    });
    expect(failure).toBeNull();
  });

  describe("schema_org page url", () => {
    const landingPage = (url: string, extraMeta: Record<string, unknown> = {}) => ({
      slug: "foo",
      title: "Foo",
      description: "Landing description for the gate.",
      meta: {
        page_title: "Foo | 4Geeks",
        description: "Landing description long enough for the gate.",
        ...extraMeta,
      },
      sections: [
        {
          type: "schema_org",
          section_id: "schema_org-1",
          schema_type: "WebPage",
          properties: { name: "Foo", url },
        },
        { type: "hero" },
      ],
    });

    it("publish blocks a WebPage url built from the wrong pattern", () => {
      const failure = evaluateLiveEntrySeoAndRequiredFields({
        contentType: "landing",
        slug: "foo",
        locale: "en",
        pageData: landingPage("https://4geeks.com/en/landing/foo"),
        intent: "publish",
        isDraftWrite: false,
      });
      expect(failure?.code).toBe("schema_org_page_url_mismatch");
      expect(failure?.message).toContain("/landing/foo");
      expect(failure?.schema_org_page_url_mismatches?.[0]).toMatchObject({
        section_id: "schema_org-1",
        field: "url",
        key_path: "properties.url",
      });
    });

    it("publish passes own address with www / trailing slash, and the canonical address", () => {
      for (const pageData of [
        landingPage("http://www.4geeks.com/landing/foo/"),
        landingPage("https://4geeks.com/en/main", { canonical_url: "https://4geeks.com/en/main" }),
      ]) {
        const failure = evaluateLiveEntrySeoAndRequiredFields({
          contentType: "landing",
          slug: "foo",
          locale: "en",
          pageData,
          intent: "publish",
          isDraftWrite: false,
        });
        expect(failure).toBeNull();
      }
    });

    it("micro live save and draft write are not blocked", () => {
      const pageData = landingPage("https://4geeks.com/en/landing/foo");
      expect(
        evaluateLiveEntrySeoAndRequiredFields({
          contentType: "landing",
          slug: "foo",
          locale: "en",
          pageData,
          intent: "micro",
          touchedPaths: ["sections[0].properties.url"],
          isDraftWrite: false,
        })?.code,
      ).not.toBe("schema_org_page_url_mismatch");
      expect(
        evaluateLiveEntrySeoAndRequiredFields({
          contentType: "landing",
          slug: "foo",
          locale: "en",
          pageData,
          intent: "publish",
          isDraftWrite: true,
        }),
      ).toBeNull();
    });
  });

  it("publish fails when full meta replace drops title and description", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "landing",
      slug: "ai-engineering-program-ad-mx",
      locale: "es",
      pageData: {
        slug: "ai-engineering-program-ad-mx",
        meta: {
          robots: "noindex, nofollow",
          change_frequency: "weekly",
        },
      },
      intent: "publish",
      isDraftWrite: false,
    });
    expect(failure).not.toBeNull();
    expect(failure?.missing_fields).toEqual(
      expect.arrayContaining(["meta.page_title", "meta.description"]),
    );
  });
});
