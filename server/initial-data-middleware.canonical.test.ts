import { describe, expect, it } from "vitest";
import { injectSsrMetaTags, type InitialDataPayload } from "./initial-data-middleware";

function shell(extraHead = ""): string {
  return `<!DOCTYPE html><html lang="en"><head><title>Default</title>${extraHead}</head><body></body></html>`;
}

function pagePayload(meta: Record<string, unknown>): InitialDataPayload {
  return {
    locale: "en",
    queries: [
      {
        // Matches injectSsrMetaTags known-page detection without depending on site configs.
        queryKey: ["/api/content-pages/page", "blog", "en"],
        data: {
          locale: "en",
          meta,
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

  it("skips when canonical_url is missing", () => {
    const html = injectSsrMetaTags(
      shell(),
      pagePayload({
        page_title: "Blog",
      }),
      undefined,
      "/en/blog",
    );
    expect(html).not.toContain('rel="canonical"');
  });
});
