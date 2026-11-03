import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import {
  authorizeLiveRedirectWrite,
  resolveRedirectSourcePage,
} from "./redirect-page-scope";

const tmpDirs: string[] = [];

function write(root: string, rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

function makeSite(): ContentIndex {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "redirect-page-scope-"));
  tmpDirs.push(root);
  write(
    root,
    "content-types.yml",
    [
      "landing:",
      "  directory: landings",
      "  url_pattern:",
      "    en: /en/landing/:slug",
      "how-to:",
      "  directory: how-to",
      "  url_pattern:",
      "    en: /en/how-to/:slug",
      "",
    ].join("\n"),
  );
  write(root, "landings/promo/en.yml", "slug: promo\ntitle: Promo\nmeta:\n  redirects:\n    - /en/old-promo\n");
  write(root, "landings/other/en.yml", "slug: other\ntitle: Other\n");
  write(root, "how-to/install-js/en.yml", "slug: install-js\ntitle: Install\n");
  write(
    root,
    "custom-redirects.yml",
    ["redirects:", "  - from: /en/legacy", "    to: /en/landing/other", "  - from: /us/(.*)", "    to: /en/$1", ""].join("\n"),
  );
  const ci = new ContentIndex(root);
  resetRegistry();
  ci.scanFast();
  ci.scanSlow();
  return ci;
}

const landingsOnly = (type: string) => type === "landing";

function add(ci: ContentIndex, body: Record<string, unknown>, hasGlobal = false) {
  return authorizeLiveRedirectWrite({ ci, action: "add", hasGlobal, canEditPage: landingsOnly, body, allowedHosts: ["4geeks.com"] });
}

function del(ci: ContentIndex, source: string, hasGlobal = false) {
  return authorizeLiveRedirectWrite({ ci, action: "delete", hasGlobal, canEditPage: landingsOnly, sourceRelToContentRoot: source });
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  resetRegistry();
});

describe("authorizeLiveRedirectWrite (add)", () => {
  it("global edit_redirects skips page checks", () => {
    const ci = makeSite();
    expect(add(ci, { from: "/us/x", to: "https://example.com", isCustomDestination: true }, true)).toEqual({
      ok: true,
      mode: "global",
    });
  });

  it("allows a free address on a page of an allowed type", () => {
    const ci = makeSite();
    expect(add(ci, { from: "/en/Promo-2024/", to: "/en/landing/promo", allLanguages: true })).toEqual({
      ok: true,
      mode: "page",
      contentType: "landing",
      slug: "promo",
      normalizedFrom: "/en/promo-2024",
    });
  });

  it("refuses a page of another content type", () => {
    const ci = makeSite();
    expect(add(ci, { from: "/en/old-guide", to: "/en/how-to/install-js" })).toMatchObject({
      ok: false,
      status: 403,
      code: "page_scope_refused",
      reason: "wrong_content_type",
      contentType: "how-to",
    });
  });

  it("refuses a destination that is not a page", () => {
    const ci = makeSite();
    expect(add(ci, { from: "/en/old", to: "https://example.com/x" })).toMatchObject({ status: 403, reason: "not_a_page" });
    expect(add(ci, { from: "/en/old", to: "/en/landing/missing" })).toMatchObject({ status: 403, reason: "not_a_page" });
  });

  it("refuses options that need edit_redirects", () => {
    const ci = makeSite();
    for (const option of ["isCustomDestination", "before_from", "removed_entry", "priority"]) {
      const value = option === "removed_entry" ? { content_type: "landing", slug: "x", locale: "en" } : option === "priority" ? "fallback" : option === "before_from" ? "/en/legacy" : true;
      expect(add(ci, { from: "/en/new-old", to: "/en/landing/promo", [option]: value })).toMatchObject({
        status: 400,
        reason: "option_not_allowed",
        option,
      });
    }
  });

  it("refuses taking over a live page, an existing redirect or a pattern", () => {
    const ci = makeSite();
    expect(add(ci, { from: "/en/landing/other", to: "/en/landing/promo" })).toMatchObject({ status: 409, reason: "live_content" });
    expect(add(ci, { from: "/en/legacy", to: "/en/landing/promo" })).toMatchObject({
      status: 409,
      reason: "already_redirected",
      conflict_to: "/en/landing/other",
    });
    expect(add(ci, { from: "/us/anything", to: "/en/landing/promo" })).toMatchObject({ status: 409, reason: "pattern_match" });
    expect(add(ci, { from: "/en/old/(.*)", to: "/en/landing/promo" })).toMatchObject({ status: 400, reason: "invalid_path" });
  });
});

describe("authorizeLiveRedirectWrite (delete)", () => {
  it("allows a page file of an allowed type", () => {
    const ci = makeSite();
    expect(del(ci, "landings/promo/en.yml")).toEqual({ ok: true, mode: "page", contentType: "landing", slug: "promo" });
    expect(del(ci, "landings/promo/_common.yml")).toMatchObject({ ok: true, mode: "page" });
  });

  it("refuses custom-redirects.yml, other types and non-page files", () => {
    const ci = makeSite();
    expect(del(ci, "custom-redirects.yml")).toMatchObject({ status: 403, reason: "custom_file" });
    expect(del(ci, "how-to/install-js/en.yml")).toMatchObject({ status: 403, reason: "wrong_content_type" });
    expect(del(ci, "landings/promo/draft-a.en.yml")).toMatchObject({ status: 403, reason: "not_a_page" });
    expect(del(ci, "content-types.yml")).toMatchObject({ status: 403, reason: "not_a_page" });
  });

  it("global edit_redirects can delete anywhere", () => {
    const ci = makeSite();
    expect(del(ci, "custom-redirects.yml", true)).toEqual({ ok: true, mode: "global" });
  });
});

describe("resolveRedirectSourcePage", () => {
  it("maps directory names back to content types", () => {
    const ci = makeSite();
    expect(resolveRedirectSourcePage(ci, "landings/promo/en.yml")).toEqual({ contentType: "landing", slug: "promo" });
    expect(resolveRedirectSourcePage(ci, "landing/promo/en.yml")).toBeNull();
  });
});
