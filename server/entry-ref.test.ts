import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import { resolveEntryRef, resolveEntryRefAcrossTypes } from "./entry-ref";

const tmpDirs: string[] = [];

function write(root: string, rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

function makeSite(): ContentIndex {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "entry-ref-"));
  tmpDirs.push(root);
  write(
    root,
    "content-types.yml",
    ["how-to:", "  directory: how-to", "  url_pattern:", "    en: /en/how-to/:slug", "    es: /es/how-to/:slug", ""].join("\n"),
  );
  // Spanish address differs from the page ID.
  write(root, "how-to/javascript-empty-array/_common.yml", "slug: javascript-empty-array\ntitle: Empty array\n");
  write(root, "how-to/javascript-empty-array/en.yml", "title: Empty array\n");
  write(root, "how-to/javascript-empty-array/es.yml", "title: Array vacío\nslug: array-vacio-javascript\n");
  // Mixed-case page ID, lowercase shared slug, no language slug.
  write(root, "how-to/How-to-print-in-javascript/_common.yml", "slug: how-to-print-in-javascript\n");
  write(root, "how-to/How-to-print-in-javascript/en.yml", "title: Print\n");
  // No slug declared anywhere.
  write(root, "how-to/no-slug-page/en.yml", "title: No slug\n");
  // Another page whose ID equals a different page's Spanish address.
  write(root, "how-to/clone-array-javascript/en.yml", "title: Clone\n");
  write(root, "how-to/clone-array-javascript/es.yml", "title: Clonar\nslug: clonar-array-javascript\n");
  write(root, "how-to/clonar-array-javascript/en.yml", "title: Other page\n");
  const ci = new ContentIndex(root);
  resetRegistry();
  ci.scanFast();
  ci.scanSlow();
  return ci;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  resetRegistry();
});

describe("resolveEntryRef", () => {
  it("finds a page by its exact ID", () => {
    const ci = makeSite();
    const r = resolveEntryRef(ci, { contentType: "how-to", ref: "javascript-empty-array", locale: "en" });
    expect(r).toMatchObject({ ok: true, entryId: "javascript-empty-array", locale: "en", matchedBy: "id" });
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it("serves the Spanish version for a Spanish slug without an explicit locale", () => {
    const ci = makeSite();
    const r = resolveEntryRef(ci, { contentType: "how-to", ref: "array-vacio-javascript", locale: "en" });
    expect(r).toMatchObject({ ok: true, entryId: "javascript-empty-array", locale: "es", matchedBy: "locale_slug" });
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["slug_resolved"]);
  });

  it("serves the explicitly requested language and warns when the slug is another language", () => {
    const ci = makeSite();
    const r = resolveEntryRef(ci, {
      contentType: "how-to",
      ref: "array-vacio-javascript",
      locale: "en",
      localeExplicit: true,
    });
    expect(r).toMatchObject({ ok: true, entryId: "javascript-empty-array", locale: "en", slugLocale: "es" });
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["slug_locale_mismatch", "slug_resolved"]);
  });

  it("finds a mixed-case page ID from any spelling", () => {
    const ci = makeSite();
    for (const ref of ["how-to-print-in-javascript", "HOW-TO-PRINT-IN-JAVASCRIPT", "how_to_print_in_javascript"]) {
      const r = resolveEntryRef(ci, { contentType: "how-to", ref });
      expect(r).toMatchObject({ ok: true, entryId: "How-to-print-in-javascript" });
    }
  });

  it("falls back to the page ID when no slug is declared", () => {
    const ci = makeSite();
    const r = resolveEntryRef(ci, { contentType: "how-to", ref: "No-Slug-Page" });
    expect(r).toMatchObject({ ok: true, entryId: "no-slug-page", matchedBy: "id_fallback" });
  });

  it("lets a page ID win over another page's slug", () => {
    const ci = makeSite();
    const r = resolveEntryRef(ci, { contentType: "how-to", ref: "clonar-array-javascript" });
    expect(r).toMatchObject({ ok: true, entryId: "clonar-array-javascript", matchedBy: "id" });
  });

  it("refuses to guess when two pages share a key", () => {
    const ci = makeSite();
    const root = ci.contentRoot;
    write(root, "how-to/dup-a/es.yml", "slug: same-address\n");
    write(root, "how-to/dup-b/es.yml", "slug: Same_Address\n");
    ci.scanFast();
    const r = resolveEntryRef(ci, { contentType: "how-to", ref: "same-address-" });
    expect(r).toEqual({ ok: false, reason: "ambiguous", candidates: ["dup-a", "dup-b"] });
    expect(ci.getSlugKeyCollisions("how-to")).toEqual([
      {
        contentType: "how-to",
        key: "clonar-array-javascript",
        entryIds: ["clonar-array-javascript", "clone-array-javascript"],
        resolvesTo: "clonar-array-javascript",
      },
      { contentType: "how-to", key: "same-address", entryIds: ["dup-a", "dup-b"] },
    ]);
  });

  it("finds a folder created after the last index build by its exact ID", () => {
    const ci = makeSite();
    write(ci.contentRoot, "how-to/brand-new/draft.en.yml", "title: Draft\n");
    const r = resolveEntryRef(ci, { contentType: "how-to", ref: "brand-new" });
    expect(r).toMatchObject({ ok: true, entryId: "brand-new", matchedBy: "id" });
  });

  it("reports index_updating on a miss while a refresh is pending", () => {
    const ci = makeSite();
    (ci as unknown as { refreshPending: boolean }).refreshPending = true;
    expect(resolveEntryRef(ci, { contentType: "how-to", ref: "renamed-just-now" })).toEqual({
      ok: false,
      reason: "index_updating",
    });
    (ci as unknown as { refreshPending: boolean }).refreshPending = false;
    expect(resolveEntryRef(ci, { contentType: "how-to", ref: "renamed-just-now" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("resolves across types for the loopback endpoint", () => {
    const ci = makeSite();
    expect(
      resolveEntryRefAcrossTypes(ci, { contentType: null, ref: "array-vacio-javascript", locale: "en" }),
    ).toMatchObject({ ok: true, contentType: "how-to", entry_id: "javascript-empty-array", locale: "es" });
    expect(resolveEntryRefAcrossTypes(ci, { contentType: "how-to", ref: "nope" })).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("indexes the _common.yml slug as an exact alias", () => {
    const ci = makeSite();
    expect(ci.resolveBaseSlug("how-to-print-in-javascript", "how-to")).toBe("How-to-print-in-javascript");
  });
});
