/**
 * Server-only markdown enhancement: GitHub alerts + Shiki via rehype-pretty-code
 * + KaTeX math. Output is HTML prefixed with ARTICLE_HTML_MARKER so the client
 * can render without shipping Shiki / KaTeX JS.
 */
import { createHash } from "node:crypto";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeStringify from "rehype-stringify";
import type { Root, Element, ElementContent, Text, Parents } from "hast";
import { visit } from "unist-util-visit";
import { renderToHtml } from "geekchart/server";
import {
  normalizeMathDelimiters,
  remarkMathOptions,
  rehypeKatexOptions,
} from "@shared/markdown-math";
import { child } from "./logger";

const log = child({ module: "markdown-enhance" });

/** Prefix so the article renderer knows content is pre-rendered HTML. */
export const ARTICLE_HTML_MARKER = "<!--article-html-v1-->";

const ALERT_TYPES = new Set(["NOTE", "TIP", "WARNING", "IMPORTANT"]);

const enhanceCache = new Map<string, { html: string; fetched_at: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Bump when enhance output shape changes so in-memory cache cannot serve stale HTML. */
const ENHANCE_PIPELINE_VERSION = "v5-geekchart-phone";

const prettyCodeOptions = {
  theme: { light: "github-light", dark: "github-dark-dimmed" },
  keepBackground: false,
  defaultLang: "plaintext",
} as const;

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "iframe",
    "video",
    "source",
    "figure",
    "figcaption",
    "div",
    "span",
  ],
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      "className",
      "dataLanguage",
      "dataTheme",
      "dataMeta",
      ["className", /^language-/],
      ["className", /^line$/],
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      "className",
      "style",
      "dataLine",
      ["className", /^katex/],
      ["className", /^math/],
    ],
    pre: [
      ...(defaultSchema.attributes?.pre ?? []),
      "className",
      "style",
      "dataLanguage",
      "dataTheme",
      "tabIndex",
    ],
    figure: ["dataRehypePrettyCodeFigure", "className"],
    figcaption: ["dataRehypePrettyCodeTitle", "className"],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      "className",
      "dataArticleAlert",
      "role",
      ["className", /^katex/],
    ],
    p: [...(defaultSchema.attributes?.p ?? []), "className"],
    iframe: ["src", "width", "height", "allowFullScreen", "allow", "title", "frameBorder"],
    video: ["src", "controls", "width", "height", "poster", "autoPlay", "loop", "muted"],
    source: ["src", "type"],
    "*": [
      ...((defaultSchema.attributes as Record<string, unknown>)?.["*"] as unknown[] ?? []),
      "className",
      "dataLanguage",
      "dataTheme",
      "dataLine",
      "dataRehypePrettyCodeFigure",
      "style",
      "ariaHidden",
      "ariaLabel",
    ],
  },
};

function hashContent(markdown: string): string {
  return createHash("sha256")
    .update(ENHANCE_PIPELINE_VERSION)
    .update(markdown)
    .digest("hex");
}

/** Transform `> [!NOTE]` style blockquotes into alert divs before stringify. */
function rehypeGithubAlerts() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index: number | undefined, parent: Parents | undefined) => {
      if (node.tagName !== "blockquote" || parent == null || index == null) return;

      const firstParagraph = node.children.find(
        (c): c is Element => c.type === "element" && c.tagName === "p",
      );
      if (!firstParagraph) return;

      const firstText = firstParagraph.children.find(
        (c): c is Text => c.type === "text",
      );
      if (!firstText) return;

      const match = firstText.value.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*/i);
      if (!match) return;

      const kind = match[1].toUpperCase();
      if (!ALERT_TYPES.has(kind)) return;

      firstText.value = firstText.value.slice(match[0].length);
      if (!firstText.value.trim()) {
        firstParagraph.children = firstParagraph.children.filter((c) => c !== firstText);
      }

      const titleText = kind.charAt(0) + kind.slice(1).toLowerCase();
      const titleEl: Element = {
        type: "element",
        tagName: "p",
        properties: { className: ["article-alert-title"] },
        children: [{ type: "text", value: titleText }],
      };

      const alert: Element = {
        type: "element",
        tagName: "div",
        properties: {
          className: ["article-alert", `article-alert-${kind.toLowerCase()}`],
          dataArticleAlert: kind.toLowerCase(),
          role: "note",
        },
        children: [titleEl, ...node.children] as ElementContent[],
      };

      parent.children[index] = alert;
    });
  };
}

/** rehype-pretty-code also wraps inline code; restore plain <code>text</code>. */
function rehypeUnwrapInlinePrettyCode() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index: number | undefined, parent: Parents | undefined) => {
      if (parent == null || index == null) return;
      if (node.tagName !== "span") return;
      const props = (node.properties || {}) as Record<string, unknown>;
      const prettyKey = Object.keys(props).find(
        (k) =>
          k === "dataRehypePrettyCodeFigure" ||
          k === "data-rehype-pretty-code-figure" ||
          k.toLowerCase().includes("rehypeprettycode") ||
          k.includes("pretty-code"),
      );
      if (!prettyKey) return;

      const codeEl = node.children.find(
        (c): c is Element => c.type === "element" && c.tagName === "code",
      );
      if (!codeEl) return;

      const text = collectText(codeEl);
      parent.children[index] = {
        type: "element",
        tagName: "code",
        properties: {},
        children: [{ type: "text", value: text }],
      };
    });
  };
}

function collectText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") {
    return node.children.map(collectText).join("");
  }
  return "";
}

/**
 * Replace every ```mermaid code block with an animated SVG chart drawn on the
 * server by geekchart (no browser involved). Runs after sanitize, before
 * rehype-pretty-code, so the block is never syntax-highlighted as code.
 *
 * The chart arrives as one HTML block with no blank lines: the client feeds
 * this HTML back through react-markdown, which would end an HTML block at the
 * first blank line. A chart that fails to render is left as the original
 * code block and logged, so a bad diagram never breaks the article.
 */
/** Width of the article column in CSS px (`.prose` in ArticleDefault) on a
 * desktop and on a phone: the chart is laid out for each so its text stays
 * legible at full size (DESIGN 1.1/1.6/3.1); the HTML carries both and a
 * media query shows the one that fits. */
const ARTICLE_COLUMN_PX = { desktop: 612, phone: 358 };

/** Carry a fenced block's info string (```mermaid speed=0.7) into the HTML as
 * `data-meta`, so it survives rehype-raw and sanitize where `node.data` does
 * not. Sanitize allows it on `code` (schema below). */
function remarkFenceMeta() {
  return (tree: import("mdast").Root) => {
    visit(tree, "code", (node: import("mdast").Code) => {
      if (!node.meta) return;
      const data = (node.data ??= {}) as { hProperties?: Record<string, unknown> };
      data.hProperties = { ...(data.hProperties ?? {}), dataMeta: node.meta };
    });
  };
}

function rehypeGeekchart() {
  return async (tree: Root) => {
    const jobs: Array<Promise<void>> = [];
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "pre" || !parent || index === undefined) return;
      const code = node.children.find(
        (c): c is Element => c.type === "element" && c.tagName === "code",
      );
      if (!code) return;
      const cls = code.properties?.className;
      const classes = Array.isArray(cls) ? cls.map(String) : typeof cls === "string" ? [cls] : [];
      if (!classes.includes("language-mermaid")) return;
      const source = collectText(code).trim();
      if (!source) return;
      // Writer-facing knobs on the fence line: ```mermaid speed=0.7
      // (remark keeps the info string after the language as `data.meta`).
      const meta = String(code.properties?.dataMeta ?? "");
      // ```mermaid duration=6 — how long the build animation takes, in
      // seconds (the renderer derives its pace from it). speed=N (a bare
      // multiplier) is still accepted; duration wins when both appear.
      const durationMatch = /\bduration=([0-9]*\.?[0-9]+)/.exec(meta);
      const duration = durationMatch ? Number(durationMatch[1]) : undefined;
      const speedMatch = /\bspeed=([0-9]*\.?[0-9]+)/.exec(meta);
      const speed = speedMatch ? Number(speedMatch[1]) : undefined;
      const host = parent as Parents;
      const at = index;
      jobs.push(
        (async () => {
          try {
            const html = (await renderToHtml(source, { display: ARTICLE_COLUMN_PX, ...(duration ? { duration } : speed ? { speed } : {}) })).replace(/\n\s*\n/g, "\n");
            host.children[at] = {
              type: "raw",
              value: `<figure class="geekchart">${html}</figure>`,
            } as unknown as ElementContent;
          } catch (err) {
            log.warn({ err }, "[MarkdownEnhance] mermaid chart failed to render; leaving code block");
          }
        })(),
      );
    });
    await Promise.all(jobs);
  };
}

let processorPromise: ReturnType<typeof buildProcessor> | null = null;

async function buildProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath, remarkMathOptions)
    .use(remarkFenceMeta)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeKatex, rehypeKatexOptions)
    .use(rehypeSanitize, sanitizeSchema as Parameters<typeof rehypeSanitize>[0])
    .use(rehypeSlug)
    .use(rehypeGeekchart)
    .use(rehypePrettyCode, prettyCodeOptions)
    .use(rehypeUnwrapInlinePrettyCode)
    .use(rehypeGithubAlerts)
    .use(rehypeStringify, { allowDangerousHtml: true });
}

async function getProcessor() {
  if (!processorPromise) processorPromise = buildProcessor();
  return processorPromise;
}

/**
 * Convert markdown to enhanced HTML (alerts + pretty code). Cached by content hash.
 * Returns original markdown on failure so the client can still render.
 */
export async function enhanceMarkdownToHtml(markdown: string): Promise<string> {
  if (!markdown || !markdown.trim()) return markdown;

  // Already enhanced
  if (markdown.startsWith(ARTICLE_HTML_MARKER)) return markdown;

  const key = hashContent(markdown);
  const cached = enhanceCache.get(key);
  if (cached && Date.now() - cached.fetched_at < CACHE_TTL_MS) {
    return cached.html;
  }

  try {
    const processor = await getProcessor();
    const file = await processor.process(normalizeMathDelimiters(markdown));
    const html = `${ARTICLE_HTML_MARKER}\n${String(file)}`;
    enhanceCache.set(key, { html, fetched_at: Date.now() });
    return html;
  } catch (err) {
    log.error({ err }, "[MarkdownEnhance] Failed to enhance markdown; returning raw");
    return markdown;
  }
}

/**
 * Render a `chart` section's mermaid `source` into `html` via geekchart, the
 * same renderer `rehypeGeekchart` above uses for ```mermaid fences inside an
 * article body. A `chart` section is not markdown — its `source` is bare
 * mermaid — so it goes straight to `renderToHtml`, not through the markdown
 * pipeline. Sized for the article column (DESIGN 1.1/1.6/3.1), same as an
 * in-article chart. Failure leaves `html` empty and logs; it never throws,
 * so one bad diagram never breaks the page it's on.
 */
async function enhanceGeekchartSection(section: Record<string, unknown>): Promise<void> {
  const source = typeof section.source === "string" ? section.source.trim() : "";
  section.html = "";
  if (!source) return;
  const duration = typeof section.duration === "number" ? section.duration : undefined;
  try {
    section.html = await renderToHtml(source, {
      display: ARTICLE_COLUMN_PX,
      ...(duration ? { duration } : {}),
    });
  } catch (err) {
    log.warn({ err }, "[MarkdownEnhance] geekchart section failed to render; leaving html empty");
  }
}

/** Walk page sections and enhance `type: article` content and `type: chart` source. */
export async function enhanceArticleSectionsInPage(
  pageData: Record<string, unknown>,
): Promise<void> {
  const sections = pageData.sections;
  if (!Array.isArray(sections)) return;

  await Promise.all(
    sections.map(async (section) => {
      if (!section || typeof section !== "object") return;
      const s = section as Record<string, unknown>;
      if (s.type === "geekchart") {
        await enhanceGeekchartSection(s);
        return;
      }
      if (s.type !== "article") return;
      if (typeof s.content !== "string" || !s.content.trim()) return;
      s.content = await enhanceMarkdownToHtml(s.content);
    }),
  );
}

export function clearMarkdownEnhanceCache(): void {
  enhanceCache.clear();
}
