import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import { checkSimpleRedirectFrom, parseSimpleRedirectPath, redirectsPageUrl } from "./redirect-simple-check";

const tmpDirs: string[] = [];

function write(root: string, rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

function makeSite(): ContentIndex {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "redirect-simple-check-"));
  tmpDirs.push(root);
  write(
    root,
    "content-types.yml",
    ["how-to:", "  directory: how-to", "  url_pattern:", "    en: /en/how-to/:slug", "    es: /es/how-to/:slug", ""].join("\n"),
  );
  write(root, "how-to/install-js/en.yml", "slug: install-js\ntitle: Install\nmeta:\n  redirects:\n    - /en/old-install\n");
  write(root, "how-to/install-js/es.yml", "slug: instalar-js\ntitle: Instalar\n");
  write(root, "how-to/empty-array/en.yml", "slug: empty-array\ntitle: Empty array\n");
  write(
    root,
    "custom-redirects.yml",
    [
      "redirects:",
      "  - from: /en/legacy-apply",
      "    to: /en/apply",
      "    status: 301",
      "  - from: /us/(.*)",
      "    to: /en/$1",
      "    status: 301",
      "",
    ].join("\n"),
  );
  const ci = new ContentIndex(root);
  resetRegistry();
  ci.scanFast();
  ci.scanSlow();
  return ci;
}

const dest = "/en/how-to/install-js";

function check(ci: ContentIndex, from: string) {
  return checkSimpleRedirectFrom({ from, destUrl: dest, locale: "en", ci, allowedHosts: ["4geeks.com"] });
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  resetRegistry();
});

describe("parseSimpleRedirectPath", () => {
  it("normalizes case, leading and trailing slash", () => {
    expect(parseSimpleRedirectPath("En/Old-Page/")).toEqual({ ok: true, path: "/en/old-page" });
  });

  it("keeps the path of a full URL on this site", () => {
    expect(parseSimpleRedirectPath("https://www.4geeks.com/en/old", ["4geeks.com"])).toEqual({
      ok: true,
      path: "/en/old",
    });
  });

  it("rejects other hosts, queries, spaces and patterns", () => {
    expect(parseSimpleRedirectPath("https://example.com/en/old", ["4geeks.com"]).ok).toBe(false);
    expect(parseSimpleRedirectPath("/en/old?x=1").ok).toBe(false);
    expect(parseSimpleRedirectPath("/en/old page").ok).toBe(false);
    expect(parseSimpleRedirectPath("/en/old/(.*)").ok).toBe(false);
    expect(parseSimpleRedirectPath("   ").ok).toBe(false);
  });
});

describe("checkSimpleRedirectFrom", () => {
  it("allows a free old path", () => {
    const ci = makeSite();
    expect(check(ci, "/en/how-to/old-install-guide")).toEqual({
      ok: true,
      normalizedFrom: "/en/how-to/old-install-guide",
    });
  });

  it("blocks invalid input", () => {
    const ci = makeSite();
    expect(check(ci, "/en/old?x=1")).toMatchObject({ ok: false, code: "invalid_path" });
  });

  it("blocks homepage addresses", () => {
    const ci = makeSite();
    expect(check(ci, "/es")).toMatchObject({ ok: false, code: "locale_home" });
    expect(check(ci, "/")).toMatchObject({ ok: false, code: "locale_home" });
  });

  it("blocks this page's own address in any language", () => {
    const ci = makeSite();
    expect(check(ci, "/en/how-to/install-js")).toMatchObject({ ok: false, code: "self_redirect" });
    expect(check(ci, "/es/how-to/instalar-js")).toMatchObject({ ok: false, code: "self_redirect" });
  });

  it("blocks another live page and app routes", () => {
    const ci = makeSite();
    expect(check(ci, "/en/how-to/empty-array")).toMatchObject({ ok: false, code: "live_content" });
    expect(check(ci, "/en/apply")).toMatchObject({ ok: false, code: "live_content" });
    expect(check(ci, "/private/redirects")).toMatchObject({ ok: false, code: "live_content" });
  });

  it("blocks a path another rule already redirects", () => {
    const ci = makeSite();
    expect(check(ci, "/en/legacy-apply")).toMatchObject({
      ok: false,
      code: "already_redirected",
      conflict_to: "/en/apply",
    });
  });

  it("says when the path already redirects to this page", () => {
    const ci = makeSite();
    const result = check(ci, "/EN/Old-Install/");
    expect(result).toMatchObject({ ok: false, code: "already_redirected" });
    expect(result.ok ? "" : result.message).toContain("already redirects to this page");
  });

  it("blocks a path a pattern rule matches", () => {
    const ci = makeSite();
    expect(check(ci, "/us/some-old-page")).toMatchObject({
      ok: false,
      code: "pattern_match",
      conflict_from: "/us/(.*)",
    });
  });

  it("builds the Redirects page link", () => {
    expect(redirectsPageUrl("/en/old page")).toBe("/private/redirects?url=%2Fen%2Fold%20page");
  });
});
