import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sync-state", () => ({ markFileAsModified: vi.fn() }));

import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import { addDraftRedirect, removeDraftRedirect, screenPublishedRedirects } from "./redirect-draft";
import { resetVariableManagerCache } from "./variable-manager";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;
let ci: ContentIndex;

function write(rel: string, data: unknown) {
  const full = path.join(contentRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof data === "string" ? data : yaml.dump(data), "utf-8");
}

function readYaml(rel: string): Record<string, any> {
  return yaml.load(fs.readFileSync(path.join(contentRoot, rel), "utf-8")) as Record<string, any>;
}

const target = { contentType: "page", slug: "about", variant: "draft", locale: "en" };

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "redirect-draft-test-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  write("content-types.yml", "page:\n  directory: pages\n  url_pattern:\n    en: /en/:slug\n    es: /es/:slug\n");
  write("pages/about/en.yml", { slug: "about", title: "About", meta: { redirects: ["/en/about-old"] }, sections: [] });
  write("pages/about/draft.en.yml", { slug: "about", title: "About (draft)", meta: { redirects: ["/en/about-old"] }, sections: [] });
  write("pages/contact/en.yml", { slug: "contact", title: "Contact", meta: { redirects: ["/en/reach-us"] }, sections: [] });
  process.chdir(tempDir);
  resetVariableManagerCache();
  resetRegistry(contentRoot);
  ci = new ContentIndex(contentRoot);
  ci.scan();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(ORIGINAL_CWD);
  resetRegistry(contentRoot);
  resetVariableManagerCache();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("addDraftRedirect", () => {
  it("writes the draft only; live and the redirect index are unchanged", () => {
    const out = addDraftRedirect({ ci, target, from: "/en/about-us", statusCode: 301 });
    expect(out).toEqual({ ok: true, from: "/en/about-us", file: "site_test/pages/about/draft.en.yml" });
    expect(readYaml("pages/about/draft.en.yml").meta.redirects).toEqual(["/en/about-old", "/en/about-us"]);
    expect(readYaml("pages/about/en.yml").meta.redirects).toEqual(["/en/about-old"]);
    ci.scan();
    expect(ci.getRedirects().some((r) => r.from === "/en/about-us")).toBe(false);
  });

  it("refuses a missing draft and a draft with traffic", () => {
    expect(addDraftRedirect({ ci, target: { ...target, variant: "nope" }, from: "/x", statusCode: 301 })).toMatchObject({
      ok: false,
      status: 404,
      code: "draft_missing",
    });
    write("pages/about/versioning.yml", { en: { variants: [{ slug: "draft", allocation: 50 }] } });
    expect(addDraftRedirect({ ci, target, from: "/x", statusCode: 301 })).toMatchObject({
      ok: false,
      code: "draft_has_traffic",
    });
  });

  it("refuses another live page, an address redirected elsewhere, and duplicates in the draft", () => {
    expect(addDraftRedirect({ ci, target, from: "/en/contact", statusCode: 301 })).toMatchObject({ ok: false, code: "live_content" });
    expect(addDraftRedirect({ ci, target, from: "/en/reach-us", statusCode: 301 })).toMatchObject({
      ok: false,
      code: "already_redirected",
    });
    expect(addDraftRedirect({ ci, target, from: "/en/about-old", statusCode: 301 })).toMatchObject({
      ok: false,
      code: "already_in_draft",
    });
  });

  it("allows the page's own current address when the draft renames the page", () => {
    expect(addDraftRedirect({ ci, target, from: "/en/about", statusCode: 301 })).toMatchObject({ ok: false });
    write("pages/about/draft.en.yml", { slug: "about-us", title: "About", sections: [] });
    expect(addDraftRedirect({ ci, target, from: "/en/about", statusCode: 301 })).toMatchObject({ ok: true, from: "/en/about" });
    expect(readYaml("pages/about/draft.en.yml").meta.redirects).toEqual(["/en/about"]);
  });
});

describe("removeDraftRedirect", () => {
  it("removes an address copied from live; live is unchanged", () => {
    expect(removeDraftRedirect({ ci, target, from: "/en/about-old/" })).toEqual({
      ok: true,
      from: "/en/about-old",
      file: "site_test/pages/about/draft.en.yml",
    });
    expect(readYaml("pages/about/draft.en.yml").meta.redirects).toEqual([]);
    expect(readYaml("pages/about/en.yml").meta.redirects).toEqual(["/en/about-old"]);
    expect(removeDraftRedirect({ ci, target, from: "/en/about-old" })).toMatchObject({ ok: true, alreadyAbsent: true });
  });
});

describe("screenPublishedRedirects", () => {
  const liveRaw = () => fs.readFileSync(path.join(contentRoot, "pages/about/en.yml"), "utf-8");
  const screen = (promoted: unknown) =>
    screenPublishedRedirects({
      ci,
      contentType: "page",
      folderSlug: "about",
      locale: "en",
      liveRaw: liveRaw(),
      promotedRaw: yaml.dump(promoted),
    });

  it("keeps a clean added address and drops conflicting ones with reasons", () => {
    const out = screen({
      slug: "about",
      title: "About",
      meta: { redirects: ["/en/about-old", "/en/fresh", "/en/contact", "/en/reach-us"] },
    });
    expect(out.skipped.map((s) => [s.from, s.code])).toEqual([
      ["/en/contact", "live_content"],
      ["/en/reach-us", "already_redirected"],
    ]);
    expect((yaml.load(out.content) as any).meta.redirects).toEqual(["/en/about-old", "/en/fresh"]);
    expect(out.changed).toBe(true);
  });

  it("allows the page's own address when the publish renames it; nothing changed means changed=false", () => {
    const renamed = screen({ slug: "about-us", title: "About", meta: { redirects: ["/en/about-old", "/en/about"] } });
    expect(renamed.skipped).toEqual([]);
    expect(renamed.changed).toBe(true);
    const same = screen({ slug: "about", title: "New title", meta: { redirects: ["/en/about-old"] } });
    expect(same).toMatchObject({ skipped: [], changed: false });
  });
});

describe("draft redirects are never indexed", () => {
  it("a draft in a language with no live file adds no redirects", () => {
    write("pages/about/draft.es.yml", { slug: "acerca", meta: { redirects: ["/es/viejo"] } });
    ci.scan();
    expect(ci.getRedirects().some((r) => r.from === "/es/viejo")).toBe(false);
    expect(ci.getRedirects().some((r) => r.from === "/en/about-old")).toBe(true);
  });
});
