import { describe, it, expect, vi } from "vitest";

vi.mock("./single-resolver", () => ({
  resolveSingleVars: (page: unknown) => page,
}));
vi.mock("./build-single-entry", () => ({
  buildSingleEntryFromContent: () => ({}),
}));
vi.mock("./content-types", () => ({
  finalizeSingleEntryForTemplates: (x: unknown) => x,
  getContentTypeConfig: () => ({
    editor: {
      title: { required: true },
      description: { required: true },
    },
  }),
  getFolder: () => "blog",
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
}));
vi.mock("./content-index", () => ({
  contentIndex: {
    loadMergedContent: () => ({ data: null }),
    getRedirects: () => [],
    refreshCustomRedirects: () => [],
  },
}));
vi.mock("./seo-cluster-link-check", () => ({
  evaluateClusterLinksForEntry: () => null,
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
      },
      intent: "publish",
      isDraftWrite: false,
    });
    expect(failure).toBeNull();
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
