import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  absolutizePath,
  fillLlmsTxtPrompt,
  LLMS_TXT_PROMPT_BASENAME,
  pageSectionForSlug,
  PAGES_DENYLIST,
  readLlmsTxtPrompt,
  writeLlmsTxtPrompt,
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
  it("injects input blocks from the caller-supplied template", () => {
    const template = [
      "ORG={{company_profile}}",
      "FACTS={{site_facts}}",
      "PRODS={{products}}",
      "PAGES={{pages}}",
      "PREV={{previous_llms_txt}}",
    ].join("\n");
    const out = fillLlmsTxtPrompt(template, {
      company_profile: "ORG",
      site_facts: "FACTS",
      products: "PRODS",
      pages: "PAGES",
      previous_llms_txt: "PREV",
    });
    expect(out).toContain("ORG=ORG");
    expect(out).toContain("FACTS=FACTS");
    expect(out).toContain("PRODS=PRODS");
    expect(out).toContain("PAGES=PAGES");
    expect(out).toContain("PREV=PREV");
    expect(out).not.toContain("{{company_profile}}");
  });
});

describe("read/write LlmsTxtPrompt", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp && fs.existsSync(tmp)) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns null when missing or empty", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llms-prompt-"));
    expect(readLlmsTxtPrompt(tmp)).toBeNull();
    fs.writeFileSync(path.join(tmp, LLMS_TXT_PROMPT_BASENAME), "   \n", "utf-8");
    expect(readLlmsTxtPrompt(tmp)).toBeNull();
  });

  it("creates and updates the prompt file", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llms-prompt-"));
    writeLlmsTxtPrompt("Use {{products}}\n", tmp);
    expect(readLlmsTxtPrompt(tmp)).toContain("{{products}}");
    writeLlmsTxtPrompt("Updated {{pages}}", tmp);
    const body = readLlmsTxtPrompt(tmp);
    expect(body).toContain("Updated {{pages}}");
    expect(body?.endsWith("\n")).toBe(true);
  });
});
