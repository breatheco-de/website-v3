import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import { resolveDocumentTarget } from "./html-variant-key";
import { urlBakesStoredPageQuery } from "./initial-data-middleware";

const tmpDirs: string[] = [];

function write(root: string, rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

function makeSite(): ContentIndex {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "content-index-resolve-url-"));
  tmpDirs.push(root);
  write(
    root,
    "content-types.yml",
    [
      "landing:",
      "  directory: landings",
      "  url_pattern:",
      "    default: /landing/:slug",
      "how-to:",
      "  directory: how-to",
      "  url_pattern:",
      "    en: /en/how-to/:slug",
      "    es: /es/how-to/:slug",
      "",
    ].join("\n"),
  );
  write(root, "landings/master-ia/_common.yml", "slug: master-ia\nlocale: es\n");
  write(root, "landings/master-ia/es.yml", "title: Master IA\n");
  write(root, "landings/sin-locale/_common.yml", "slug: sin-locale\n");
  write(root, "landings/sin-locale/es.yml", "title: Sin locale\n");
  write(root, "landings/both/_common.yml", "slug: both\n");
  write(root, "landings/both/en.yml", "title: Both\n");
  write(root, "landings/both/es.yml", "title: Ambos\n");
  write(root, "landings/promo/_common.yml", "slug: promo\nlocale: en\n");
  write(root, "landings/promo/en.yml", "slug: promo\ntitle: Promo\n");
  write(root, "landings/promo/es.yml", "slug: promocion\ntitle: Promoción\n");
  write(root, "landings/wrong-common/_common.yml", "slug: wrong-common\nlocale: en\n");
  write(root, "landings/wrong-common/es.yml", "title: Solo español\n");
  write(root, "how-to/install-js/en.yml", "slug: install-js\ntitle: Install\n");
  write(root, "how-to/install-js/es.yml", "slug: instalar-js\ntitle: Instalar\n");
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

describe("ContentIndex.resolveUrl patternLocale", () => {
  it("reports default for a single-address type even when only es.yml exists", () => {
    const ci = makeSite();
    expect(ci.resolveUrl("/landing/master-ia")).toMatchObject({
      contentType: "landing",
      slug: "master-ia",
      patternLocale: "default",
    });
  });

  it("serves a single-language landing in the language of its file", () => {
    const ci = makeSite();
    const resolved = ci.resolveUrl("/landing/master-ia")!;
    expect(resolved.fileLocale).toBe("es");
    expect(ci.localeForResolved(resolved)).toBe("es");
  });

  it("falls back to the only language file, then the first by code", () => {
    const ci = makeSite();
    expect(ci.servedLocale("landing", "sin-locale", "default")).toBe("es");
    expect(ci.servedLocale("landing", "both", "default")).toBe("en");
  });

  it("takes the language from the matched address on a bilingual landing", () => {
    const ci = makeSite();
    const en = ci.resolveUrl("/landing/promo")!;
    const es = ci.resolveUrl("/landing/promocion")!;
    expect(en).toMatchObject({ slug: "promo", patternLocale: "default", fileLocale: "en" });
    expect(es).toMatchObject({ slug: "promo", patternLocale: "default", fileLocale: "es" });
    expect(ci.localeForResolved(es)).toBe("es");
  });

  it("ignores _common.yml locale, even when it names a language with no file", () => {
    const ci = makeSite();
    const resolved = ci.resolveUrl("/landing/wrong-common")!;
    expect(ci.localeForResolved(resolved)).toBe("es");
    expect(ci.servedLocale("landing", "wrong-common", "default")).toBe("es");
  });

  it("resolveLocaleFromUrlSlug finds the language even when the slug equals the folder name", () => {
    const ci = makeSite();
    expect(ci.resolveLocaleFromUrlSlug("promo", "landing")).toBe("en");
    expect(ci.resolveLocaleFromUrlSlug("promocion", "landing")).toBe("es");
    expect(ci.resolveLocaleFromUrlSlug("master-ia", "landing")).toBe("es");
  });

  it("keeps the locale for per-locale URL patterns", () => {
    const ci = makeSite();
    expect(ci.resolveUrl("/es/how-to/instalar-js")?.patternLocale).toBe("es");
    expect(ci.resolveUrl("/en/how-to/install-js")?.patternLocale).toBe("en");
  });
});

describe("single-address pages use the entry's own language", () => {
  it("A/B variant lookup targets the Spanish entry", () => {
    const ci = makeSite();
    expect(resolveDocumentTarget(ci, "/landing/master-ia", ci.contentRoot)).toMatchObject({
      contentType: "landing",
      locale: "es",
    });
    expect(resolveDocumentTarget(ci, "/es/how-to/instalar-js", ci.contentRoot)?.locale).toBe("es");
  });

  it("baked-query check reads the Spanish file", () => {
    const ci = makeSite();
    const root = ci.contentRoot;
    fs.writeFileSync(
      path.join(root, "landings/master-ia/es.yml"),
      'title: Master IA\nsections:\n  - type: hero\n    title: "Hola {{ param.utm_term }}"\n',
      "utf-8",
    );
    ci.scanFast();
    expect(urlBakesStoredPageQuery("/landing/master-ia?utm_term=ia", ci)).toBe(true);
  });
});
