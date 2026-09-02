import { describe, expect, it } from "vitest";
import { variableUsagePathToStaffHref } from "./variable-usage-href";

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

  it("returns null for unknown shapes", () => {
    expect(variableUsagePathToStaffHref("variables.yml")).toBeNull();
    expect(variableUsagePathToStaffHref("site_4geeks-com/only")).toBeNull();
  });
});
