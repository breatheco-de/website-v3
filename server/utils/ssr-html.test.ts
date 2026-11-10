import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { InitialDataPayload } from "../initial-data-middleware";
import {
  assembleSsrDocument,
  contentTypesReadyForHtmlCache,
  injectFallbackHead,
  isMeaningfulSsrAppHtml,
} from "./ssr-html";

const TEMPLATE = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "client", "index.html"),
  "utf-8",
);

const NASTY_DESCRIPTION = `Desc $1 $2 $& $\` $' $$ "quoted" <b>`;
const NASTY_TITLE = `Title $1 $2 $& $\` $' $$ "quoted" <b>`;
const ESCAPED_DESCRIPTION = `Desc $1 $2 $&amp; $\` $' $$ &quot;quoted&quot; &lt;b&gt;`;
const ESCAPED_TITLE = `Title $1 $2 $&amp; $\` $' $$ &quot;quoted&quot; &lt;b&gt;`;

/** What React's renderToString emits for article text like `\.(jpg|png|svg)$` and `echo '$NVM_DIR'`. */
const APP_HTML =
  `<main><h1>Regex</h1><pre><code>\\.(jpg|png|svg)$\`</code></pre>` +
  `<p>echo &#x27;export NVM_DIR=&quot;$HOME/.nvm&quot;&#x27; $&#x27; $&amp; $1 $$</p></main>`;

function pagePayload(meta: Record<string, unknown>): InitialDataPayload {
  return {
    locale: "en",
    queries: [
      {
        queryKey: ["/api/content-pages/page", "regex", "en"],
        data: { locale: "en", slug: "regex", meta },
      },
    ],
  };
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function readInitialData(html: string): InitialDataPayload {
  const match = /<script id="__INITIAL_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]) as InitialDataPayload;
}

function assemble(meta: Record<string, unknown>, appHtml = APP_HTML): string {
  return assembleSsrDocument({
    template: TEMPLATE,
    appHtml,
    payload: pagePayload(meta),
    url: "/en/how-to/regex",
  });
}

describe("assembleSsrDocument — `$` replacement patterns in content", () => {
  it("writes description and title literally into every meta tag", () => {
    const html = assemble({ page_title: NASTY_TITLE, description: NASTY_DESCRIPTION });

    expect(countOf(html, ESCAPED_DESCRIPTION)).toBe(3);
    expect(countOf(html, ESCAPED_TITLE)).toBe(3);
    expect(html).toContain(`<title>${ESCAPED_TITLE}</title>`);
    expect(html).toMatch(new RegExp(`name="description"\\s+content="${escapeRe(ESCAPED_DESCRIPTION)}"`));
    expect(html).not.toMatch(/content="[^"]*<meta/);
  });

  it("keeps the page body and document structure intact", () => {
    const html = assemble({ page_title: NASTY_TITLE, description: NASTY_DESCRIPTION });

    expect(html.match(/<!doctype html>/gi)?.length).toBe(1);
    expect(countOf(html, '<div id="root">')).toBe(1);
    expect(countOf(html, "</head>")).toBe(1);
    expect(countOf(html, "</body>")).toBe(1);
    expect(html).toContain(`<div id="root">${APP_HTML}</div>`);
  });

  it("emits parseable __INITIAL_DATA__ that round-trips the copy", () => {
    const html = assemble({ page_title: NASTY_TITLE, description: NASTY_DESCRIPTION });
    const data = readInitialData(html);
    const meta = (data.queries[0].data as { meta: Record<string, unknown> }).meta;
    expect(meta.description).toBe(NASTY_DESCRIPTION);
    expect(meta.page_title).toBe(NASTY_TITLE);
    expect(countOf(html, 'id="__INITIAL_DATA__"')).toBe(1);
  });

  it("matches the reported live cases ($95K–$135K, $135,980)", () => {
    const html = assemble({
      page_title: "Senior Full Stack Developer Salary: $135,980 median",
      description:
        "84% hire rate, $95K–$135K range. Top 10% above $214,670 and median $135,980.",
    });
    expect(html).toContain(
      'content="84% hire rate, $95K–$135K range. Top 10% above $214,670 and median $135,980."',
    );
    expect(html).toContain('content="Senior Full Stack Developer Salary: $135,980 median"');
    expect(html).not.toMatch(/content="[^"]*<meta/);
  });

  it("serves the shell with an empty #root when appHtml is null", () => {
    const html = assembleSsrDocument({
      template: TEMPLATE,
      appHtml: null,
      payload: pagePayload({ description: NASTY_DESCRIPTION }),
      url: "/en/how-to/regex",
    });
    expect(html).toContain('<div id="root"></div>');
    expect(readInitialData(html).locale).toBe("en");
  });
});

const LOADING_SHELL =
  '<div class="min-h-screen bg-background flex items-center justify-center">' +
  '<div class="text-center"><div role="status">' +
  '<span class="!absolute">Loading...</span></div></div></div>';

describe("HTML cache refuses a page built before content types exist", () => {
  it("does not treat the route loading shell as a real page", () => {
    expect(isMeaningfulSsrAppHtml(LOADING_SHELL)).toBe(false);
    expect(isMeaningfulSsrAppHtml(APP_HTML)).toBe(true);
    expect(isMeaningfulSsrAppHtml("")).toBe(false);
  });

  it("requires a non-empty content-type list before a copy may be stored", () => {
    expect(contentTypesReadyForHtmlCache(null)).toBe(false);
    expect(contentTypesReadyForHtmlCache({ queries: [] })).toBe(false);
    expect(
      contentTypesReadyForHtmlCache({
        queries: [{ queryKey: ["/api/content-types"], data: [] }],
      }),
    ).toBe(false);
    expect(
      contentTypesReadyForHtmlCache({
        queries: [{ queryKey: ["/api/content-types"], data: [{ name: "page" }] }],
      }),
    ).toBe(true);
  });
});

describe("injectFallbackHead — client-only fallback after a failed render", () => {
  const spanishLanding: InitialDataPayload = {
    locale: "es",
    queries: [
      {
        queryKey: ["/api/content-pages/landing", "master-ia", "auto"],
        data: {
          locale: "es",
          slug: "master-ia",
          meta: { page_title: "Máster en IA", description: "Aprende IA en España" },
        },
      },
    ],
  };

  it("sets the page's language, title, description and og:locale", () => {
    const html = injectFallbackHead(TEMPLATE, spanishLanding, undefined, "/landing/master-ia");
    expect(html).toMatch(/<html[^>]*lang="es"/);
    expect(html).toContain('property="og:locale" content="es_ES"');
    expect(html).toContain("<title>Máster en IA</title>");
    expect(html).toContain('content="Aprende IA en España"');
    expect(html).toContain('<div id="root"></div>');
  });

  it("returns the shell unchanged without page data", () => {
    expect(injectFallbackHead(TEMPLATE, null, undefined, "/landing/unknown")).toBe(TEMPLATE);
  });

  it("never throws on malformed page data", () => {
    const broken = { queries: null } as unknown as InitialDataPayload;
    expect(() => injectFallbackHead(TEMPLATE, broken, undefined, "/landing/x")).not.toThrow();
  });
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
