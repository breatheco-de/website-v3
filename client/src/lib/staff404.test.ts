import { describe, expect, it } from "vitest";
import type { RedirectTraceHop } from "@shared/redirect-trace";
import {
  applyRebuiltQueryToUrl,
  buildStaff404Model,
  defaultStaff404Facts,
  hasRebuiltQueryParam,
  sortVariantsForModal,
  staff404DashboardHref,
  staff404PreviewHref,
  staff404RedirectsHref,
} from "./staff404";

function hop(from: string, to: string): RedirectTraceHop {
  return { from, to, status: 301, matchType: "fallback" };
}

describe("rebuilt query helpers", () => {
  it("detects rebuilt=1", () => {
    expect(hasRebuiltQueryParam("?locale=en&rebuilt=1")).toBe(true);
    expect(hasRebuiltQueryParam("locale=en")).toBe(false);
  });

  it("sets rebuilt=1 without dropping other params", () => {
    const next = applyRebuiltQueryToUrl("https://example.test/private/preview/blog/foo?locale=en");
    expect(next).toContain("rebuilt=1");
    expect(next).toContain("locale=en");
  });
});

describe("staff404PreviewHref", () => {
  it("opens the shared template slug for Live instead of the missing entry", () => {
    expect(
      staff404PreviewHref({
        contentType: "blog",
        slug: "pruebas-unitarias-en-typescript-es",
        listingSharedTemplate: true,
        option: { locale: "en", isPromoted: true, variantSlug: "promoted", version: null },
      }),
    ).toBe("/private/preview/blog/template?locale=en");
  });

  it("keeps the entry slug for entry-level drafts", () => {
    expect(
      staff404PreviewHref({
        contentType: "landing",
        slug: "campaign",
        listingSharedTemplate: false,
        option: { locale: "es", isPromoted: false, variantSlug: "alt-hero", version: 2 },
      }),
    ).toBe("/private/preview/landing/campaign?locale=es&variant=alt-hero&version=2");
  });
});

describe("buildStaff404Model", () => {
  it("shared + missing slug → current-type miss; back, dashboard, edit templates, rebuild", () => {
    const model = buildStaff404Model(
      defaultStaff404Facts({
        listingSharedTemplate: true,
        hasTemplateVariants: true,
      }),
    );
    expect(model.title).toBe("Blog not found");
    expect(model.happened).toEqual([
      "The Blog entry `foo` was not found. Blogs share a common template you can edit if you like.",
    ]);
    expect(model.actions).toEqual(["goBack", "dashboard", "editTemplates", "rebuild"]);
  });

  it("shared + hops → redirect first, then current type/slug miss (not inferred original type)", () => {
    const model = buildStaff404Model(
      defaultStaff404Facts({
        listingSharedTemplate: true,
        hasTemplateVariants: true,
        hops: [
          hop(
            "/es/interactive-exercise/pruebas-unitarias-en-typescript-es",
            "/es/blog/interactive-exercise/pruebas-unitarias-en-typescript-es",
          ),
        ],
        slug: "pruebas-unitarias-en-typescript-es",
      }),
    );
    expect(model.happened[0]).toContain("/es/interactive-exercise/");
    expect(model.happened[1]).toContain("The Blog entry `pruebas-unitarias-en-typescript-es` was not found");
    expect(model.happened.join(" ")).not.toContain("interactive-exercise entry");
    expect(model.actions).toContain("openRedirects");
    expect(staff404RedirectsHref(model.actions.includes("openRedirects") ? [
      hop("/es/interactive-exercise/pruebas-unitarias-en-typescript-es", "/es/blog/foo"),
    ] : [])).toContain(encodeURIComponent("/es/interactive-exercise/pruebas-unitarias-en-typescript-es"));
  });

  it("rebuilt=1 + still miss → rebuild-finished sentence then miss", () => {
    const model = buildStaff404Model(
      defaultStaff404Facts({
        listingSharedTemplate: true,
        hasTemplateVariants: true,
        rebuilt: true,
      }),
    );
    expect(model.happened[0]).toBe(
      "Rebuild finished. This URL is still unknown. Refetch the database from the type dashboard.",
    );
    expect(model.happened[1]).toContain("The Blog entry `foo` was not found");
  });

  it("shared template + isDraftOnly both true → shared-template sentence only (7B)", () => {
    const model = buildStaff404Model(
      defaultStaff404Facts({
        listingSharedTemplate: true,
        isDraftOnly: true,
        hasTemplateVariants: true,
        hasEntryVariants: true,
      }),
    );
    expect(model.title).toBe("Blog not found");
    expect(model.happened.join(" ")).not.toContain("no published");
    expect(model.happened[0]).toContain("share a common template");
    expect(model.actions).toContain("editTemplates");
    expect(model.actions).not.toContain("openDraft");
  });

  it("landing draft-only + entry variants (not shared) → open draft of this entry", () => {
    const model = buildStaff404Model(
      defaultStaff404Facts({
        typeLabel: "Landing",
        contentType: "landing",
        slug: "new-campaign",
        isDraftOnly: true,
        hasEntryVariants: true,
      }),
    );
    expect(model.title).toBe("No published landing yet");
    expect(model.happened).toEqual(["`new-campaign` has no published (live) version yet."]);
    expect(model.actions).toContain("openDraft");
    expect(model.actions).not.toContain("editTemplates");
  });

  it("requested variant missing + entry variants → variant sentence + open draft modal", () => {
    const model = buildStaff404Model(
      defaultStaff404Facts({
        typeLabel: "Landing",
        contentType: "landing",
        slug: "campaign",
        requestedVariantMissing: true,
        requestedVariant: "alt-hero",
        locale: "es",
        hasEntryVariants: true,
      }),
    );
    expect(model.happened[0]).toBe(
      "Variant `alt-hero` for `es` could not be loaded for `campaign`.",
    );
    expect(model.actions).toContain("openDraft");
  });

  it("no variants, YAML exists → Edit YAML", () => {
    const model = buildStaff404Model(defaultStaff404Facts({ yamlExists: true }));
    expect(model.actions).toContain("editYaml");
    expect(model.actions).not.toContain("editTemplates");
    expect(model.actions).not.toContain("openDraft");
  });

  it("yaml load failed → distinct title and Edit YAML even without yamlExists", () => {
    const model = buildStaff404Model(
      defaultStaff404Facts({
        yamlExists: false,
        yamlLoadFailed: true,
        yamlLoadDetails: "bad indentation (line 12, column 3)",
        yamlLoadFile: "site_4geeks-com/landings/x/draft.es.yml",
        requestedVariant: "draft",
        typeLabel: "Landing",
      }),
    );
    expect(model.title).toBe("This draft’s YAML couldn’t be loaded");
    expect(model.happened[0]).toContain("could not be read");
    expect(model.happened[0]).not.toContain("was not found");
    expect(model.actions).toContain("editYaml");
  });

  it("invalid type → no dashboard; Go back only if history; plus rebuild", () => {
    const model = buildStaff404Model(
      defaultStaff404Facts({
        isValidType: false,
        contentType: "not-a-type",
        typeLabel: "Not-a-type",
        slug: undefined,
      }),
    );
    expect(model.title).toBe("Invalid Content Type");
    expect(model.happened[0]).toBe("`not-a-type` is not a valid content type.");
    expect(model.actions).toEqual(["goBack", "rebuild"]);
  });

  it("historyLength <= 1 → omit Go back; dashboard still present when type is valid", () => {
    const model = buildStaff404Model(
      defaultStaff404Facts({
        listingSharedTemplate: true,
        hasTemplateVariants: true,
        historyLength: 1,
      }),
    );
    expect(model.actions).not.toContain("goBack");
    expect(model.actions).toContain("dashboard");
    expect(staff404DashboardHref("blog")).toBe("/private/type/blog");
  });

  it("public edit-mode 404 → back (if history), rebuild; Open in Redirects if hops; no templates, no dashboard", () => {
    const model = buildStaff404Model(
      defaultStaff404Facts({
        surface: "public",
        isValidType: false,
        contentType: undefined,
        hops: [hop("/es/old", "/es/missing")],
      }),
    );
    expect(model.happened[0]).toContain("You opened /es/old");
    expect(model.happened).toContain("This URL is not a known page on our Content URLs.");
    expect(model.actions).toEqual(["goBack", "rebuild", "openRedirects"]);
    expect(model.actions).not.toContain("dashboard");
    expect(model.actions).not.toContain("editTemplates");
  });

  it("databaseSingle offers dashboard when type is known", () => {
    const model = buildStaff404Model(
      defaultStaff404Facts({
        surface: "databaseSingle",
        typeLabel: "Interactive Exercise",
        contentType: "interactive-exercise",
        slug: "pruebas",
      }),
    );
    expect(model.actions).toContain("dashboard");
    expect(model.actions).not.toContain("editTemplates");
    expect(model.happened[0]).toContain("The Interactive Exercise entry `pruebas` was not found");
  });

  it("puts Live last for shared-template modal sort", () => {
    const sorted = sortVariantsForModal(
      [
        { variantSlug: "promoted", isPromoted: true, locale: "en", allocation: 80 },
        { variantSlug: "alt", isPromoted: false, locale: "en", allocation: 20 },
      ],
      true,
    );
    expect(sorted.map((v) => v.variantSlug)).toEqual(["alt", "promoted"]);
  });

  it("edit templates stays listed while variants are loading", () => {
    const model = buildStaff404Model(
      defaultStaff404Facts({
        listingSharedTemplate: true,
        variantsLoading: true,
        hasTemplateVariants: false,
      }),
    );
    expect(model.actions).toContain("editTemplates");
  });
});
