import { describe, expect, it } from "vitest";
import {
  entryPreviewHref,
  parseContentEntryFile,
  variableUsagePathToStaffHref,
} from "./variable-usage-href";

const resolve = (dir: string) => (dir === "pages" ? "page" : dir);

describe("variableUsagePathToStaffHref", () => {
  it("maps entry locale YAML to private preview", () => {
    expect(
      variableUsagePathToStaffHref("site_4geeks-com/blog/my-post/en.yml"),
    ).toBe("/private/preview/blog/my-post?locale=en");
  });

  it("maps disk folder pages to content type page", () => {
    expect(
      variableUsagePathToStaffHref("site_4geeks-com/pages/home/en.yml", resolve),
    ).toBe("/private/preview/page/home?locale=en");
  });

  it("maps draft locale files", () => {
    expect(
      variableUsagePathToStaffHref("site_4geeks-com/pages/home/draft.es.yml", resolve),
    ).toBe("/private/preview/page/home?locale=es");
  });

  it("maps variant locale files", () => {
    expect(
      variableUsagePathToStaffHref(
        "site_4geeks-com/landings/campaign/alt-hero.en.yml",
      ),
    ).toBe("/private/preview/landings/campaign?locale=en&variant=alt-hero");
  });

  it("maps shared template to type manage", () => {
    expect(
      variableUsagePathToStaffHref("site_4geeks-com/blog/template.en.yml"),
    ).toBe("/private/type/blog");
    expect(
      variableUsagePathToStaffHref("site_4geeks-com/pages/template.en.yml", resolve),
    ).toBe("/private/type/page");
  });

  it("maps _common entry file to preview without locale", () => {
    expect(
      variableUsagePathToStaffHref("site_4geeks-com/blog/my-post/_common.yml"),
    ).toBe("/private/preview/blog/my-post");
  });

  it("maps schema-org.yml to SEO Schema org settings", () => {
    expect(variableUsagePathToStaffHref("site_4geeks-com/schema-org.yml")).toBe(
      "/private/settings/seo/schema",
    );
    expect(variableUsagePathToStaffHref("schema-org.yml")).toBe("/private/settings/seo/schema");
  });

  it("returns null for unknown shapes", () => {
    expect(variableUsagePathToStaffHref("variables.yml")).toBeNull();
    expect(variableUsagePathToStaffHref("site_4geeks-com/only")).toBeNull();
  });
});

describe("parseContentEntryFile", () => {
  it("parses live locale files", () => {
    expect(parseContentEntryFile("site_4geeks-com/pages/home/es.yml", resolve)).toEqual({
      contentType: "page",
      slug: "home",
      locale: "es",
    });
  });

  it("parses draft locale files as the draft variant", () => {
    expect(parseContentEntryFile("site_4geeks-com/pages/home/draft.es.yml", resolve)).toEqual({
      contentType: "page",
      slug: "home",
      locale: "es",
      variant: "draft",
    });
  });

  it("parses A/B variant files", () => {
    expect(
      parseContentEntryFile("site_4geeks-com/landings/campaign/alt-hero.en.yml"),
    ).toEqual({ contentType: "landings", slug: "campaign", locale: "en", variant: "alt-hero" });
  });

  it("returns null for templates, _common, registry and unprefixed paths", () => {
    expect(parseContentEntryFile("site_4geeks-com/pages/template.en.yml")).toBeNull();
    expect(parseContentEntryFile("site_4geeks-com/blog/my-post/_common.yml")).toBeNull();
    expect(
      parseContentEntryFile("site_4geeks-com/component-registry/hero/v1.0/schema.yml"),
    ).toBeNull();
    expect(
      parseContentEntryFile("site_4geeks-com/component-registry/hero/examples/en.yml"),
    ).toBeNull();
    expect(parseContentEntryFile("pages/home/es.yml")).toBeNull();
  });
});

describe("entryPreviewHref", () => {
  it("omits force_variant for live entries", () => {
    expect(entryPreviewHref({ contentType: "page", slug: "home", locale: "es" })).toBe(
      "/private/preview/page/home?locale=es",
    );
  });

  it("forces the draft variant", () => {
    expect(
      entryPreviewHref({ contentType: "page", slug: "home", locale: "es", variant: "draft" }),
    ).toBe("/private/preview/page/home?locale=es&force_variant=draft");
  });
});
