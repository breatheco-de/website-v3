import { describe, expect, it } from "vitest";
import { extractExternalLinkHits, extractInternalLinkHits } from "./internal-link-hits";

const ownHosts = ["4geeks.com"];

describe("extractExternalLinkHits", () => {
  it("finds markdown links and images, drops own hosts, archive copies and fragments", () => {
    const content = [
      "Según [Course Report](https://www.coursereport.com/research/coding-bootcamp-market-sizing-2025).",
      "![Portada](https://storage.googleapis.com/breathecode-prod-images/media/portada.jpg)",
      "[Compara](https://4geeks.com/es/comparar-programas) y [www](https://www.4geeks.com/es/x).",
      "[copia](https://web.archive.org/web/2024/https://a.com/x) [ancla](https://example.org/page#section)",
    ].join("\n");
    const hits = extractExternalLinkHits({ content }, { ownHosts });
    expect(hits.map((h) => [h.url, h.media, h.fieldPath])).toEqual([
      ["https://www.coursereport.com/research/coding-bootcamp-market-sizing-2025", "link", "content"],
      ["https://storage.googleapis.com/breathecode-prod-images/media/portada.jpg", "image", "content"],
      ["https://example.org/page", "link", "content"],
    ]);
  });

  it("keeps balanced parentheses in URLs (Wikipedia style)", () => {
    const hits = extractExternalLinkHits({ content: "[x](https://en.wikipedia.org/wiki/Foo_(bar)) after" });
    expect(hits[0]?.url).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });

  it("reads <a href>, <img src>, URL fields and image fields; skips templates and redirects", () => {
    const data = {
      sections: [
        {
          type: "hero",
          cta_url: "https://partner.example/apply",
          image: "https://cdn.example/hero.webp",
          html: '<p><a href="https://a.example/x">a</a><img src="https://b.example/y.png"></p>',
        },
      ],
      meta: { redirects: ["https://old.example/legacy"], og_image: "https://cdn.example/og.png?t=1" },
      tpl: { url: "https://x.example/{{ entry.slug }}" },
    };
    const hits = extractExternalLinkHits(data);
    expect(hits.map((h) => [h.url, h.media, h.component ?? null])).toEqual([
      ["https://partner.example/apply", "link", "hero"],
      ["https://cdn.example/hero.webp", "image", "hero"],
      ["https://a.example/x", "link", "hero"],
      ["https://b.example/y.png", "image", "hero"],
      ["https://cdn.example/og.png?t=1", "image", null],
    ]);
  });
});

describe("own-host absolute links in the internal check", () => {
  it("keeps the pathname of full URLs on our own domains", () => {
    const hits = extractInternalLinkHits(
      { content: "[Compara](https://4geeks.com/es/comparar-programas) [ext](https://other.com/es/x)" },
      { absolute: ownHosts },
    );
    expect(hits.map((h) => h.path)).toEqual(["/es/comparar-programas"]);
  });
});
