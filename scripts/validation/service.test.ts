import { describe, expect, it } from "vitest";
import path from "path";
import { ContentIndex } from "../../server/content-index";
import { DatabaseManager } from "../../server/database";
import { MediaGallery } from "../../server/media-gallery";
import { mapSitemapUrlsToEntries, sitemapLocToPath, ValidationService } from "./service";
import { sitemapValidator } from "./validators/sitemap";

describe("sitemapLocToPath", () => {
  it("strips origin from absolute sitemap locs", () => {
    expect(sitemapLocToPath("https://4geeks.com/en/home")).toBe("/en/home");
    expect(sitemapLocToPath("https://4geeks.com/es/inicio/")).toBe("/es/inicio");
  });

  it("keeps path-only locs", () => {
    expect(sitemapLocToPath("/en/apply")).toBe("/en/apply");
  });
});

describe("mapSitemapUrlsToEntries", () => {
  it("maps content_type to type and normalizes loc", () => {
    expect(
      mapSitemapUrlsToEntries([
        {
          loc: "https://example.com/en/home",
          content_type: "page",
          slug: "home",
          locale: "en",
        },
        { loc: "https://example.com/" },
      ]),
    ).toEqual([
      { loc: "/en/home", type: "page", slug: "home", locale: "en" },
      { loc: "/", type: "static" },
    ]);
  });
});

describe("ValidationService sitemap site context", () => {
  it("includes /en/home and /es/inicio when buildContext uses a site ContentIndex", async () => {
    const contentRootName = "site_4geeks-com";
    const contentRoot = path.join(process.cwd(), contentRootName);
    const mg = new MediaGallery(contentRootName);
    const database = new DatabaseManager(contentRoot, mg);
    const ci = new ContentIndex(contentRootName, database);
    ci.getStats();

    const service = new ValidationService();
    const context = await service.buildContext({ contentRoot, ci });

    const locs = new Set(context.sitemapEntries.map((e) => e.loc));
    expect(locs.has("/en/home")).toBe(true);
    expect(locs.has("/es/inicio")).toBe(true);

    const result = await sitemapValidator.run(context);
    const missingHomes = result.warnings.filter(
      (w) =>
        w.code === "CONTENT_NOT_IN_SITEMAP" &&
        (w.message.includes("/en/home") || w.message.includes("/es/inicio")),
    );
    expect(missingHomes).toEqual([]);
  }, 60_000);
});
