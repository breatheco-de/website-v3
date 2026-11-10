import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { checkSlugRename } from "./content-editor";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";

const tmpDirs: string[] = [];

function write(root: string, rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

function makeSite(): ContentIndex {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rename-single-address-"));
  tmpDirs.push(root);
  write(root, "content-types.yml", "landing:\n  directory: landings\n  url_pattern:\n    default: /landing/:slug\n");
  // `locale: en` in _common.yml is ignored legacy: renaming es must still edit es.yml.
  write(root, "landings/promo/_common.yml", "slug: promo\nlocale: en\n");
  write(root, "landings/promo/en.yml", "slug: promo\ntitle: Promo\n");
  write(root, "landings/promo/es.yml", "slug: promocion\ntitle: Promoción\n");
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

describe("checkSlugRename on a one-address landing", () => {
  it("refuses a slug another language of the page already uses", async () => {
    const ci = makeSite();
    const r = await checkSlugRename({ contentType: "landing", folderSlug: "promo", locale: "es", newSlug: "promo", ci });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.statusCode).toBe(409);
    expect(r.code).toBe("locale_url_slug_conflict");
    expect(r.error).toContain("/landing/promo");
  });

  it("renames the requested language's file, not the one _common.yml names", async () => {
    const ci = makeSite();
    const r = await checkSlugRename({ contentType: "landing", folderSlug: "promo", locale: "es", newSlug: "promocion-nueva", ci });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.effectiveLocale).toBe("es");
    expect(r.localeFile).toBe("es.yml");
    expect(r.currentSlug).toBe("promocion");
  });
});
