import { describe, expect, it } from "vitest";
import { encodeFunctionMapping } from "@shared/functionEncoding";
import { previewSlugMappingOnItems, resolveMappedPageSlug } from "./page-slug-identity";

/** Same rule as news `_slug` — no `URL` global in the transformer VM. */
const SLUG_FROM_URL = encodeFunctionMapping(`(value, item) => {
  const raw = String((item && item.link_url) || "").trim();
  if (!raw) return "";
  const m = raw.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\\/\\/([^\\/?#]+)([^?#]*)/);
  if (!m) return "";
  const hostPath = String(m[1] || "") + String(m[2] || "");
  if (!hostPath) return "";
  return String(hostPath)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}`);

describe("page-slug-identity", () => {
  it("slugifies host+path from link_url", () => {
    const slug = resolveMappedPageSlug(
      { link_url: "https://Example.COM/Path/Article/?utm=1" },
      "news",
      "site_test",
      SLUG_FROM_URL,
    );
    expect(slug).toBe("example-com-path-article");
  });

  it("returns empty when link_url is missing", () => {
    expect(
      resolveMappedPageSlug({ title: "Only title" }, "news", "site_test", SLUG_FROM_URL),
    ).toBe("");
  });

  it("reports skipped and duplicate groups with capped samples", () => {
    const url = "https://news.example.com/story";
    const items: Record<string, unknown>[] = [
      { link_url: "", locale: "en", title: "No url", priority: 1 },
      { link_url: url, locale: "en", title: "A", priority: 1 },
      { link_url: url, locale: "en", title: "B", priority: 2 },
      { link_url: url, locale: "es", title: "ES", priority: 1 },
      { link_url: "https://other.example.com/x", locale: "en", title: "Other", priority: 1 },
    ];
    for (let i = 0; i < 12; i++) {
      items.push({
        link_url: "https://dup.example.com/same",
        locale: "en",
        title: `Dup ${i}`,
        priority: i,
      });
    }
    const preview = previewSlugMappingOnItems({
      items,
      contentType: "news",
      contentRoot: "site_test",
      slugMapping: SLUG_FROM_URL,
      sampleMax: 10,
    });
    expect(preview.skipped).toBe(1);
    expect(preview.duplicate_groups).toBe(2);
    expect(preview.samples.length).toBeLessThanOrEqual(10);
    expect(preview.samples.some((s) => s.locale === "en" && s.labels.includes("A"))).toBe(true);
  });
});
