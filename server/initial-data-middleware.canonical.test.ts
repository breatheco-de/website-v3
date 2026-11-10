import { describe, expect, it, vi } from "vitest";

vi.mock("./resolve-effective-canonical", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./resolve-effective-canonical")>();
  return {
    ...actual,
    resolveEffectiveCanonical: vi.fn(actual.resolveEffectiveCanonical),
  };
});

import { injectSsrMetaTags, type InitialDataPayload } from "./initial-data-middleware";
import { resolveEffectiveCanonical } from "./resolve-effective-canonical";

function shell(extraHead = ""): string {
  return `<!DOCTYPE html><html lang="en"><head><title>Default</title>${extraHead}</head><body></body></html>`;
}

function pagePayload(
  meta: Record<string, unknown>,
  extraData: Record<string, unknown> = {},
): InitialDataPayload {
  return {
    locale: "en",
    queries: [
      {
        // Matches injectSsrMetaTags known-page detection without depending on site configs.
        queryKey: ["/api/content-pages/page", "blog", "en"],
        data: {
          locale: "en",
          slug: "blog",
          meta,
          ...extraData,
        },
      },
    ],
  };
}

describe("injectSsrMetaTags canonical", () => {
  it("emits absolute canonical from meta.canonical_url", () => {
    const html = injectSsrMetaTags(
      shell(),
      pagePayload({
        page_title: "Blog",
        canonical_url: "https://4geeks.com/en/blog",
      }),
      undefined,
      "/en/blog",
    );
    expect(html).toContain('rel="canonical" href="https://4geeks.com/en/blog"');
    expect(html).toContain('property="og:url" content="https://4geeks.com/en/blog"');
  });

  it("strips taxonomy/UTMs and keeps ?page= when page > 1", () => {
    const html = injectSsrMetaTags(
      shell(),
      pagePayload({
        canonical_url: "https://4geeks.com/en/blog",
      }),
      undefined,
      "/en/blog?taxonomy=ai-tools&page=2&utm_source=x",
    );
    expect(html).toContain('rel="canonical" href="https://4geeks.com/en/blog?page=2"');
    expect(html).toContain('property="og:url" content="https://4geeks.com/en/blog?page=2"');
    expect(html).not.toContain("taxonomy=");
    expect(html).not.toContain("utm_source");
  });

  it("replaces an existing canonical link", () => {
    const html = injectSsrMetaTags(
      shell('<link rel="canonical" href="https://example.com/old" />'),
      pagePayload({
        canonical_url: "https://4geeks.com/en/blog",
      }),
      undefined,
      "/en/blog?taxonomy=x",
    );
    expect(html).toContain('rel="canonical" href="https://4geeks.com/en/blog"');
    expect(html).not.toContain("https://example.com/old");
    expect(html.match(/rel="canonical"/g)?.length).toBe(1);
  });

  it("replacing canonical does not eat neighboring non-self-closing stylesheet links", () => {
    const head = [
      '<link rel="modulepreload" crossorigin href="/assets/index-abc.js">',
      '<link rel="stylesheet" crossorigin href="/assets/index-abc.css">',
      '<link rel="canonical" href="https://example.com/old" />',
    ].join("\n");
    const html = injectSsrMetaTags(
      shell(head),
      pagePayload({
        canonical_url: "https://4geeks.com/en/blog",
      }),
      undefined,
      "/en/blog",
    );
    expect(html).toContain('rel="stylesheet" crossorigin href="/assets/index-abc.css"');
    expect(html).toContain('href="/assets/index-abc.js"');
    expect(html).toContain('rel="canonical" href="https://4geeks.com/en/blog"');
    expect(html).not.toContain("https://example.com/old");
  });

  it("emits auto canonical when meta.canonical_url is missing", () => {
    vi.mocked(resolveEffectiveCanonical).mockReturnValueOnce("https://4geeks.com/en/blog");
    const html = injectSsrMetaTags(
      shell(),
      pagePayload({
        page_title: "Blog",
      }),
      undefined,
      "/en/blog",
    );
    expect(html).toContain('rel="canonical" href="https://4geeks.com/en/blog"');
    expect(html).toContain('property="og:url" content="https://4geeks.com/en/blog"');
  });

  it("manual relative path is normalized via resolveEffectiveCanonical", () => {
    const html = injectSsrMetaTags(
      shell(),
      pagePayload({
        canonical_url: "/en/blog",
      }),
      undefined,
      "/en/blog",
    );
    expect(html).toMatch(/rel="canonical" href="https?:\/\/[^"]+\/en\/blog"/);
    expect(html).toMatch(/property="og:url" content="https?:\/\/[^"]+\/en\/blog"/);
  });
});
