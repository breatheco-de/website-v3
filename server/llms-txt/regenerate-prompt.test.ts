import { describe, expect, it } from "vitest";
import {
  absolutizePath,
  fillLlmsTxtPrompt,
  pageSectionForSlug,
  PAGES_DENYLIST,
} from "./regenerate-prompt";

describe("pageSectionForSlug", () => {
  it("maps admissions-like slugs", () => {
    expect(pageSectionForSlug("financials")).toBe("admissions");
    expect(pageSectionForSlug("contact-us")).toBe("admissions");
    expect(pageSectionForSlug("faq")).toBe("admissions");
  });

  it("maps company_learn slugs", () => {
    expect(pageSectionForSlug("the-academy")).toBe("company_learn");
    expect(pageSectionForSlug("partners")).toBe("company_learn");
  });

  it("maps outcomes_or_resources slugs", () => {
    expect(pageSectionForSlug("blog")).toBe("outcomes_or_resources");
    expect(pageSectionForSlug("graduates")).toBe("outcomes_or_resources");
  });

  it("defaults to company", () => {
    expect(pageSectionForSlug("home")).toBe("company");
  });
});

describe("PAGES_DENYLIST", () => {
  it("includes legal/sample slugs", () => {
    expect(PAGES_DENYLIST.has("cookies")).toBe(true);
    expect(PAGES_DENYLIST.has("privacy-policy")).toBe(true);
    expect(PAGES_DENYLIST.has("terms-conditions")).toBe(true);
    expect(PAGES_DENYLIST.has("sample-page")).toBe(true);
  });
});

describe("absolutizePath", () => {
  it("prefixes relative paths", () => {
    expect(absolutizePath("/us/coding-bootcamp", "https://4geeks.com")).toBe(
      "https://4geeks.com/us/coding-bootcamp",
    );
  });

  it("leaves absolute URLs", () => {
    expect(absolutizePath("https://x.test/a", "https://4geeks.com")).toBe("https://x.test/a");
  });
});

describe("fillLlmsTxtPrompt", () => {
  it("injects input blocks and keeps En español section", () => {
    const out = fillLlmsTxtPrompt({
      company_profile: "ORG",
      site_facts: "FACTS",
      products: "PRODS",
      pages: "PAGES",
      previous_llms_txt: "PREV",
    });
    expect(out).toContain("ORG");
    expect(out).toContain("FACTS");
    expect(out).toContain("PRODS");
    expect(out).toContain("PAGES");
    expect(out).toContain("PREV");
    expect(out).not.toContain("{{company_profile}}");
    expect(out).toMatch(/## En español/);
    expect(out).toMatch(/ONLY from <products>/);
    expect(out).toMatch(/do not put ES product/);
    expect(out).toMatch(/Do NOT name or describe specific products here/);
  });
});
