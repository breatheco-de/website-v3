import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import { databaseManager } from "./database";
import { resolveInitialData } from "./initial-data-middleware";

const tmpDirs: string[] = [];

function write(root: string, rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

const MENU = (name: string) => `name: ${name}\nnavbar:\n  items: []\n`;

function makeSite(): ContentIndex {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "initial-data-landing-"));
  tmpDirs.push(root);
  write(
    root,
    "content-types.yml",
    [
      "landing:",
      "  directory: landings",
      "  url_pattern:",
      "    default: /landing/:slug",
      "  layout:",
      "    menu:",
      "      top: logo-only",
      "      bottom: null",
      "  ads:",
      "    optimize: true",
      "page:",
      "  directory: pages",
      "  url_pattern:",
      "    en: /en/:slug",
      "    es: /es/:slug",
      "  layout:",
      "    menu:",
      "      top: main-navbar",
      "      bottom: main-footer",
      "promo:",
      "  directory: promos",
      "  url_pattern:",
      "    default: /promo/:slug",
      "  layout:",
      "    menu:",
      "      top: main-navbar",
      "      bottom: null",
      "",
    ].join("\n"),
  );
  for (const id of ["main-navbar", "main-footer", "logo-only"]) {
    write(root, `menus/${id}.yml`, MENU(id));
    write(root, `menus/${id}.es.yml`, MENU(id));
  }
  write(root, "navigation-eager-manifest.json", JSON.stringify({ version: 1, paths: {} }));
  write(root, "landings/master-ia/_common.yml", "slug: master-ia\nlocale: es\n");
  write(
    root,
    "landings/master-ia/es.yml",
    "title: Master IA\nmeta:\n  page_title: Máster en IA\nsections: []\n",
  );
  write(root, "pages/about/en.yml", "slug: about\ntitle: About\nsections: []\n");
  write(root, "promos/oferta/_common.yml", "slug: oferta\nlocale: es\n");
  write(root, "promos/oferta/es.yml", "title: Oferta\nsections: []\n");
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

function keys(payload: Awaited<ReturnType<typeof resolveInitialData>>): string[] {
  return (payload?.queries ?? []).map((q) => JSON.stringify(q.queryKey));
}

describe("resolveInitialData for a single-address landing", () => {
  it("seeds the page under the key the page reads, in the entry's language", async () => {
    const ci = makeSite();
    const payload = await resolveInitialData("/landing/master-ia", ci, databaseManager);
    expect(keys(payload)).toContain(JSON.stringify(["/api/landings", "master-ia", "auto"]));
    expect(payload?.locale).toBe("es");
  });
});

describe("resolveInitialData payload size for ads-optimized pages", () => {
  const menuKeys = (k: string[]) => k.filter((key) => key.startsWith('["/api/menus"'));

  it("ships only the menus a logo-only landing shows and no navigation preload list", async () => {
    const ci = makeSite();
    const k = keys(await resolveInitialData("/landing/master-ia", ci, databaseManager));
    expect(menuKeys(k).sort()).toEqual(
      [JSON.stringify(["/api/menus", "logo-only", "en"]), JSON.stringify(["/api/menus", "logo-only", "es"])].sort(),
    );
    expect(k).not.toContain(JSON.stringify(["navigation-eager-manifest"]));
  });

  it("keeps navbar, footer and the navigation preload list for a regular page", async () => {
    const ci = makeSite();
    const k = keys(await resolveInitialData("/en/about", ci, databaseManager));
    expect(k).toContain(JSON.stringify(["/api/menus", "main-navbar", "en"]));
    expect(k).toContain(JSON.stringify(["/api/menus", "main-footer", "en"]));
    expect(k).toContain(JSON.stringify(["navigation-eager-manifest"]));
  });

  it("does not seed a footer in the page's language when the type sets bottom: null", async () => {
    const ci = makeSite();
    const k = keys(await resolveInitialData("/promo/oferta", ci, databaseManager));
    expect(k).toContain(JSON.stringify(["/api/menus", "main-navbar", "es"]));
    expect(k).not.toContain(JSON.stringify(["/api/menus", "main-footer", "es"]));
  });
});
