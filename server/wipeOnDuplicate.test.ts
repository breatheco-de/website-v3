import { describe, expect, it } from "vitest";
import {
  wipeSectionOnDuplicate,
  wipeDocumentSectionsOnDuplicate,
  resolveBoundFormSettingsPath,
  showEcommerceEditorTab,
} from "../shared/wipeOnDuplicate";
import {
  validateRequiredConversionName,
  collectConversionNames,
} from "../shared/validateFormSection";
import { validateCtaTracking, resolveBoundCtaPaths } from "../shared/validateCtaTracking";

describe("wipeSectionOnDuplicate", () => {
  it("removes nested and routes[].conversion_name", () => {
    const { section, cleared } = wipeSectionOnDuplicate(
      {
        type: "lead_form",
        conversion_name: "newsletter",
        routes: [
          { conditions: [], conversion_name: "route_a" },
          { conditions: [], conversion_name: "route_b" },
        ],
        title: "Keep me",
      },
      { ".": "form-settings" },
    );
    expect(section.conversion_name).toBeUndefined();
    expect((section.routes as Array<Record<string, unknown>>)[0].conversion_name).toBeUndefined();
    expect((section.routes as Array<Record<string, unknown>>)[1].conversion_name).toBeUndefined();
    expect(section.title).toBe("Keep me");
    expect(cleared).toEqual(
      expect.arrayContaining([
        "conversion_name",
        "routes[0].conversion_name",
        "routes[1].conversion_name",
      ]),
    );
  });

  it("clears bound ecommerce-products path at section root", () => {
    const { section, cleared } = wipeSectionOnDuplicate(
      {
        type: "cta_banner",
        form: { conversion_name: "apply", variant: "stacked" },
        ecommerce_products: ["full-stack"],
        headline: "Hello",
      },
      { form: "form-settings", ecommerce_products: "ecommerce-products" },
    );
    expect((section.form as Record<string, unknown>).conversion_name).toBeUndefined();
    expect(section.ecommerce_products).toBeUndefined();
    expect(section.headline).toBe("Hello");
    expect(cleared).toEqual(expect.arrayContaining(["form.conversion_name", "ecommerce_products"]));
  });

  it("deletes CTA tracking only and leaves CTA object", () => {
    const fieldEditors = { "signup_card.cta_button": "cta-tracking" };
    const { section, cleared } = wipeSectionOnDuplicate(
      {
        type: "hero",
        variant: "course",
        signup_card: {
          cta_button: { text: "Apply", url: "/apply", tracking: "add_to_cart" },
        },
      },
      fieldEditors,
    );
    const cta = (section.signup_card as Record<string, unknown>).cta_button as Record<
      string,
      unknown
    >;
    expect(cta.text).toBe("Apply");
    expect(cta.url).toBe("/apply");
    expect(cta.tracking).toBeUndefined();
    expect(cleared).toContain("signup_card.cta_button.tracking");

    const ctaPaths = resolveBoundCtaPaths(fieldEditors, "course");
    expect(validateCtaTracking(section, ctaPaths)).toMatch(/missing required "tracking"/);
  });

  it("does not wipe programs[].id", () => {
    const { section } = wipeSectionOnDuplicate(
      {
        type: "enrollment_selector",
        programs: [{ id: "full-stack", title: "FS" }],
      },
      {},
    );
    expect((section.programs as Array<Record<string, unknown>>)[0].id).toBe("full-stack");
  });

  it("is a no-op when identity fields are absent", () => {
    const { section, cleared } = wipeSectionOnDuplicate(
      { type: "text_block", title: "Only copy" },
      {},
    );
    expect(section).toEqual({ type: "text_block", title: "Only copy" });
    expect(cleared).toEqual([]);
  });
});

describe("wipeDocumentSectionsOnDuplicate", () => {
  it("wipes every section and records indexes", () => {
    const doc: Record<string, unknown> = {
      sections: [
        { type: "lead_form", conversion_name: "a" },
        { type: "text_block", title: "x" },
      ],
    };
    const cleared = wipeDocumentSectionsOnDuplicate(
      doc,
      { lead_form: { ".": "form-settings" } },
      { file: "en.yml" },
    );
    expect((doc.sections as Array<Record<string, unknown>>)[0].conversion_name).toBeUndefined();
    expect(cleared.some((c) => c.sectionIndex === 0 && c.file === "en.yml")).toBe(true);
  });
});

describe("validateRequiredConversionName", () => {
  it("fails when form-settings bind exists and names are missing after wipe", () => {
    const { section } = wipeSectionOnDuplicate(
      { type: "lead_form", conversion_name: "x", routes: [{ conversion_name: "y" }] },
      { ".": "form-settings" },
    );
    const formPath = resolveBoundFormSettingsPath({ ".": "form-settings" });
    expect(formPath).toBe("");
    expect(collectConversionNames(section)).toEqual([]);
    expect(validateRequiredConversionName(section, formPath)).toMatch(/required/);
  });

  it("passes when root conversion_name is set", () => {
    expect(
      validateRequiredConversionName(
        { type: "lead_form", conversion_name: "newsletter" },
        "",
      ),
    ).toBeNull();
  });

  it("passes when only a route has conversion_name", () => {
    expect(
      validateRequiredConversionName(
        {
          type: "cta_banner",
          form: { routes: [{ conversion_name: "apply_now" }] },
        },
        "form",
      ),
    ).toBeNull();
  });

  it("passes when conversion_name is null (explicit off)", () => {
    expect(
      validateRequiredConversionName(
        { type: "lead_form", conversion_name: null },
        "",
      ),
    ).toBeNull();
  });

  it("passes when nested form-settings path is absent (CTA-only)", () => {
    expect(
      validateRequiredConversionName(
        {
          type: "hero",
          variant: "course",
          signup_card: {
            cta_button: {
              text: "Send Me the Details",
              url: "#modal-ubwgcj",
              tracking: "none",
            },
          },
        },
        "signup_card.form",
      ),
    ).toBeNull();
  });

  it("fails when nested form exists without conversion_name", () => {
    expect(
      validateRequiredConversionName(
        {
          type: "hero",
          variant: "course",
          signup_card: { form: { variant: "stacked" } },
        },
        "signup_card.form",
      ),
    ).toMatch(/required/);
  });

  it("fails when is_signup is true but conversion_name is missing", () => {
    expect(
      validateRequiredConversionName(
        { type: "lead_form", is_signup: true },
        "",
      ),
    ).toMatch(/required/);
  });

  it("passes when is_signup is true and conversion_name is null (explicit off)", () => {
    expect(
      validateRequiredConversionName(
        { type: "lead_form", is_signup: true, conversion_name: null },
        "",
      ),
    ).toBeNull();
  });
});

describe("showEcommerceEditorTab", () => {
  const heroEditors = {
    "course:signup_card.cta_button": "cta-tracking",
    "course:signup_card.form": "form-settings",
    "productShowcase:form": "form-settings",
  };

  it("is true for hero course (variant-prefixed cta-tracking)", () => {
    expect(showEcommerceEditorTab(heroEditors, "course")).toBe(true);
  });

  it("is false for hero orbit (no matching ecommerce editors)", () => {
    expect(showEcommerceEditorTab(heroEditors, "orbit")).toBe(false);
  });

  it("is true for enrollment unprefixed cta-tracking", () => {
    expect(
      showEcommerceEditorTab(
        {
          "programs[].summary.cta": "cta-tracking",
          "programs[].plans[].summary.cta": "cta-tracking",
        },
        "default",
      ),
    ).toBe(true);
  });

  it("is true for pricing_plans ecommerce-products only", () => {
    expect(
      showEcommerceEditorTab({ ecommerce_products: "ecommerce-products" }, "default"),
    ).toBe(true);
  });
});
