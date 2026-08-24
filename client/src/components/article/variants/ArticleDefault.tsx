import { useRef, useMemo } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useState, useEffect } from "react";
import type { ComponentProps } from "react";
import { ChevronRight, User, Clock, Calendar } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { useLocation } from "wouter";
import type { ArticleSection } from "@shared/schema";
import { normalizeFlexibleDate } from "@shared/normalizeFlexibleDate";
import { normalizeTags } from "@shared/normalize-tags";
import {
  normalizeMathDelimiters,
  remarkMathOptions,
  rehypeKatexOptions,
} from "@shared/markdown-math";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useOrderedPageSections } from "@/contexts/PageSectionsContext";
import { useSectionContext } from "@/contexts/SectionContext";
import { CopyCodeButton } from "../CopyCodeButton";
import { estimateReadingMinutes } from "@/lib/readingTime";
import "../article-prose.css";

/** Must match server/markdown-enhance.ts ARTICLE_HTML_MARKER */
const ARTICLE_HTML_MARKER = "<!--article-html-v1-->";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

/** Flat TOC entries grouped so h3s nest under the preceding h2. */
type TocBranch =
  | { kind: "heading"; item: TocItem }
  | { kind: "section"; item: TocItem; children: TocItem[] };

function buildTocTree(items: TocItem[]): TocBranch[] {
  const tree: TocBranch[] = [];
  let currentSection: Extract<TocBranch, { kind: "section" }> | null = null;

  for (const item of items) {
    if (item.level <= 2) {
      if (item.level === 2) {
        currentSection = { kind: "section", item, children: [] };
        tree.push(currentSection);
      } else {
        currentSection = null;
        tree.push({ kind: "heading", item });
      }
    } else if (item.level === 3) {
      if (currentSection) {
        currentSection.children.push(item);
      } else {
        tree.push({ kind: "heading", item });
      }
    }
  }

  return tree;
}

function findParentH2Id(tree: TocBranch[], activeId: string): string | null {
  for (const branch of tree) {
    if (branch.kind === "section") {
      if (branch.item.id === activeId) return branch.item.id;
      if (branch.children.some((c) => c.id === activeId)) return branch.item.id;
    }
  }
  return null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/** Strip inline markdown markers so TOC labels read as plain text. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTocItems(content: string | null | undefined, idPrefix = ""): TocItem[] {
  if (typeof content !== "string" || !content) return [];
  const body = content.startsWith(ARTICLE_HTML_MARKER)
    ? content.slice(ARTICLE_HTML_MARKER.length)
    : content;
  const items: TocItem[] = [];
  const slugCounts: Record<string, number> = {};

  const pushItem = (level: number, rawText: string, existingId?: string) => {
    const text = stripInlineMarkdown(rawText.trim());
    if (!text) return;
    let id = existingId?.trim() || `${idPrefix}${slugify(text)}`;
    if (!existingId && idPrefix && !id.startsWith(idPrefix)) {
      id = `${idPrefix}${id}`;
    }
    if (slugCounts[id] !== undefined) {
      slugCounts[id]++;
      id = `${id}-${slugCounts[id]}`;
    } else {
      slugCounts[id] = 0;
    }
    items.push({ id, text, level });
  };

  // Pre-rendered HTML path (server-enhanced articles)
  if (content.startsWith(ARTICLE_HTML_MARKER) || /^\s*</.test(body)) {
    const headingRe = /<h([1-3])([^>]*)>([\s\S]*?)<\/h\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = headingRe.exec(body)) !== null) {
      const level = Number(m[1]);
      const attrs = m[2] || "";
      const inner = m[3] || "";
      const idMatch = attrs.match(/\sid=["']([^"']+)["']/i);
      pushItem(level, stripInlineMarkdown(inner), idMatch?.[1]);
    }
    if (items.length > 0) return items;
  }

  // Markdown path
  const lines = body.split("\n");
  let inCodeBlock = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      pushItem(match[1].length, match[2]);
    }
  }
  return items;
}

function normalizeCategory(category: unknown): string | undefined {
  if (!category) return undefined;
  if (typeof category === "string") {
    const trimmed = category.trim();
    if (!trimmed || trimmed.includes("{{")) return undefined;
    return trimmed;
  }
  if (typeof category === "object") {
    const o = category as Record<string, unknown>;
    for (const key of ["title", "name", "slug", "category_title"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return undefined;
}

function normalizeAuthors(
  raw: unknown,
): Array<{ name: string; url?: string }> {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: Array<{ name: string; url?: string }> = [];
  for (const item of list) {
    if (typeof item === "string") {
      const t = item.trim();
      if (t && !t.includes("{{")) out.push({ name: t });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const name =
        (typeof o.name === "string" && o.name.trim()) ||
        `${o.first_name || ""} ${o.last_name || ""}`.trim() ||
        (typeof o.slug === "string" ? o.slug : "");
      if (!name || name.includes("{{")) continue;
      const url = typeof o.url === "string" && o.url ? o.url : undefined;
      out.push({ name, url });
    }
  }
  return out;
}

function useTocScrollSpy(items: TocItem[]) {
  const [activeId, setActiveId] = useState<string>("");
  const OFFSET_PX = 120;

  useEffect(() => {
    if (items.length === 0) return;

    let ticking = false;

    const computeActiveId = () => {
      let current = items[0]?.id ?? "";
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= OFFSET_PX) {
          current = item.id;
        } else {
          break;
        }
      }
      setActiveId((prev) => (prev === current ? prev : current));
    };

    const onScrollOrResize = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        computeActiveId();
        ticking = false;
      });
    };

    computeActiveId();
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [items]);

  const scrollTo = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    }
  };

  return { activeId, setActiveId, scrollTo };
}

function TocLink({
  item,
  isActive,
  onNavigate,
  className,
  style,
}: {
  item: TocItem;
  isActive: boolean;
  onNavigate: (e: MouseEvent<HTMLAnchorElement>, id: string) => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <a
      href={`#${item.id}`}
      onClick={(e) => onNavigate(e, item.id)}
      className={cn(
        "relative block py-1 text-sm transition-colors before:absolute before:-left-2 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:content-['']",
        isActive
          ? "font-medium text-foreground before:bg-primary"
          : "text-muted-foreground before:bg-transparent hover:text-foreground hover:before:bg-muted-foreground/50",
        className,
      )}
      style={style}
      data-testid={`toc-link-${item.id}`}
      aria-current={isActive ? "location" : undefined}
    >
      {item.text}
    </a>
  );
}

function CollapsibleTocNav({
  items,
  variant,
}: {
  items: TocItem[];
  variant: "side" | "top";
}) {
  const tree = useMemo(() => buildTocTree(items), [items]);
  const { activeId, scrollTo } = useTocScrollSpy(items);
  const [expandedH2Id, setExpandedH2Id] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId) return;
    const parentId = findParentH2Id(tree, activeId);
    if (parentId) setExpandedH2Id(parentId);
  }, [activeId, tree]);

  const toggleH2 = (id: string) => {
    setExpandedH2Id((prev) => (prev === id ? null : id));
  };

  const handleH2Navigate = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    scrollTo(e, id);
    setExpandedH2Id(id);
  };

  const isSide = variant === "side";

  return (
    <nav
      className={cn(
        isSide
          ? "sticky top-24 hidden lg:block"
          : "mb-8 rounded-md border border-border bg-muted/30 p-5",
      )}
      aria-label="Table of contents"
      data-testid={isSide ? "toc-side" : "toc-top"}
    >
      <p
        className={cn(
          "mb-3 font-semibold uppercase tracking-wider text-muted-foreground",
          isSide ? "text-xs" : "text-sm",
        )}
      >
        {isSide ? "On this page" : "Table of Contents"}
      </p>
      <ul className="space-y-0.5">
        {tree.map((branch) => {
          if (branch.kind === "heading") {
            return (
              <li key={branch.item.id}>
                <TocLink
                  item={branch.item}
                  isActive={activeId === branch.item.id}
                  onNavigate={scrollTo}
                  style={
                    isSide
                      ? undefined
                      : { paddingLeft: `${(branch.item.level - 1) * 16}px` }
                  }
                  className={!isSide ? "before:hidden" : undefined}
                />
              </li>
            );
          }

          const { item, children } = branch;
          const hasChildren = children.length > 0;
          const isExpanded = expandedH2Id === item.id;
          const childActive = children.some((c) => c.id === activeId);
          const h2Active = activeId === item.id || childActive;

          return (
            <li key={item.id} className="relative">
              {hasChildren ? (
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={`toc-children-${item.id}`}
                  onClick={() => toggleH2(item.id)}
                  className={cn(
                    "absolute -left-5 top-1 flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground",
                    h2Active && "text-foreground",
                  )}
                  data-testid={`toc-expand-${item.id}`}
                >
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-200",
                      isExpanded && "rotate-90",
                    )}
                  />
                </button>
              ) : null}
              <TocLink
                item={item}
                isActive={h2Active}
                onNavigate={handleH2Navigate}
                className={cn("min-w-0", !isSide && "before:hidden")}
              />
              {hasChildren && isExpanded && (
                <ul
                  id={`toc-children-${item.id}`}
                  className="mt-0.5 space-y-0.5"
                  data-testid={`toc-children-${item.id}`}
                >
                  {children.map((child) => (
                    <li key={child.id}>
                      <TocLink
                        item={child}
                        isActive={activeId === child.id}
                        onNavigate={scrollTo}
                        className={!isSide ? "before:hidden" : undefined}
                        style={{
                          paddingLeft: isSide ? "16px" : "32px",
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function TocTop({ items }: { items: TocItem[] }) {
  return <CollapsibleTocNav items={items} variant="top" />;
}

function TocSide({ items }: { items: TocItem[] }) {
  return <CollapsibleTocNav items={items} variant="side" />;
}

function formatUpdatedAtLabel(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale === "es" ? "es-ES" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function ArticleMeta({
  tags,
  category,
  categoryUrl,
  readingMinutes,
  authors,
  updatedAt,
  locale,
  showAuthors = true,
  showUpdatedAt = true,
}: {
  tags: string[];
  category?: string;
  categoryUrl?: string;
  readingMinutes?: number;
  authors: Array<{ name: string; url?: string }>;
  updatedAt?: string | null;
  locale: string;
  showAuthors?: boolean;
  showUpdatedAt?: boolean;
}) {
  const hasTags = tags.length > 0;
  const hasCategory = Boolean(category && category.trim() && !category.includes("{{"));
  const hasReading = typeof readingMinutes === "number" && readingMinutes > 0;
  const hasAuthors = showAuthors && authors.length > 0;
  const updatedIso =
    updatedAt && !String(updatedAt).includes("{{")
      ? normalizeFlexibleDate(updatedAt)
      : null;
  const hasUpdated = showUpdatedAt && Boolean(updatedIso);
  if (!hasTags && !hasCategory && !hasReading && !hasAuthors && !hasUpdated) return null;

  const textItems: ReactNode[] = [];
  if (hasAuthors) {
    textItems.push(
      <span key="authors" data-testid="article-authors" className="inline-flex flex-wrap items-center gap-1.5">
        <User className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="sr-only">Authors:</span>
        {authors.map((a, i) => (
          <span key={`${a.name}-${i}`}>
            {i > 0 && <span aria-hidden>, </span>}
            {a.url ? (
              <a
                href={a.url}
                className="text-foreground underline-offset-4 hover:underline"
                data-testid={`article-author-${i}`}
              >
                {a.name}
              </a>
            ) : (
              <span data-testid={`article-author-${i}`}>{a.name}</span>
            )}
          </span>
        ))}
      </span>,
    );
  }
  if (hasReading) {
    textItems.push(
      <span key="reading" data-testid="article-reading-time" className="inline-flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {readingMinutes} min read
      </span>,
    );
  }
  if (hasUpdated && updatedIso) {
    textItems.push(
      <span key="updated" data-testid="article-updated-at" className="inline-flex items-center gap-1.5">
        <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Last updated{" "}
        <time dateTime={updatedIso}>{formatUpdatedAtLabel(updatedIso, locale)}</time>
      </span>,
    );
  }

  return (
    <div
      className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      data-testid="article-meta"
    >
      {textItems.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && (
            <span aria-hidden className="text-muted-foreground/60">
              ·
            </span>
          )}
          {item}
        </span>
      ))}
      {hasCategory && (
        categoryUrl ? (
          <a
            href={categoryUrl}
            className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="article-category-chip"
          >
            {category}
          </a>
        ) : (
          <span
            className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
            data-testid="article-category-chip"
          >
            {category}
          </span>
        )
      )}
      {tags.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="rounded-full font-medium"
          data-testid={`article-tag-${tag}`}
        >
          {tag}
        </Badge>
      ))}
    </div>
  );
}

function CodeBlock({
  children,
  language,
  ...props
}: {
  children?: ReactNode;
  language?: string;
} & React.HTMLAttributes<HTMLPreElement>) {
  const preRef = useRef<HTMLPreElement>(null);
  const label =
    language && language !== "plaintext" && language !== "text"
      ? language
      : null;

  return (
    <div className="group/codeblock relative mb-5 overflow-hidden rounded-md border border-border bg-muted">
      <div className="flex h-9 items-center justify-end gap-2 border-b border-border/60 px-3">
        {label ? (
          <span className="mr-auto font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        ) : (
          <span className="mr-auto" aria-hidden />
        )}
        <CopyCodeButton
          getText={() => preRef.current?.textContent ?? ""}
        />
      </div>
      <pre
        ref={preRef}
        className="overflow-x-auto p-4 text-sm leading-relaxed"
        tabIndex={0}
        {...props}
      >
        {children}
      </pre>
    </div>
  );
}

interface ArticleProps {
  data: ArticleSection;
}

export function Article({ data }: ArticleProps) {
  const {
    content,
    show_toc = false,
    toc_position = "side",
    toc_group,
    section_id,
    tags: rawTags,
    category,
    category_url,
    authors: rawAuthors,
    updated_at: rawUpdatedAt,
    show_reading_time = true,
    show_authors = true,
    show_updated_at = true,
  } = data;

  const [location] = useLocation();
  const locale = location.startsWith("/es") ? "es" : "en";

  const orderedSections = useOrderedPageSections();
  const { sectionIndex } = useSectionContext();

  const sectionKey = section_id || `article-${sectionIndex >= 0 ? sectionIndex : "0"}`;

  const pageArticles = useMemo(
    () => orderedSections.filter((s) => s.data.type === "article"),
    [orderedSections],
  );

  // Empty ordered context (isolated preview) → treat as single article.
  const isSplit = pageArticles.length >= 2;
  const isFirstArticle =
    !isSplit || pageArticles[0]?.sectionKey === sectionKey;

  // Prefix heading ids whenever multiple articles share the page (collision-safe).
  const idPrefix = isSplit || toc_group ? `${sectionKey}--` : "";

  const tags = useMemo(() => normalizeTags(rawTags), [rawTags]);
  const categoryLabel = useMemo(() => normalizeCategory(category), [category]);
  const authors = useMemo(() => normalizeAuthors(rawAuthors), [rawAuthors]);

  const readingMinutes = useMemo(() => {
    if (!show_reading_time) return undefined;
    if (isSplit) {
      if (!isFirstArticle) return undefined;
      const combined = pageArticles
        .map((m) => (typeof m.data.content === "string" ? m.data.content : ""))
        .filter(Boolean)
        .join("\n\n");
      return combined ? estimateReadingMinutes(combined) : undefined;
    }
    return content ? estimateReadingMinutes(content) : undefined;
  }, [show_reading_time, isSplit, isFirstArticle, pageArticles, content]);

  const firstShowToc = isSplit
    ? pageArticles[0]?.data.show_toc === true
    : show_toc;

  const tocItems = useMemo(() => {
    if (isSplit) {
      if (!firstShowToc) return [];
      const items: TocItem[] = [];
      for (const member of pageArticles) {
        const memberContent = typeof member.data.content === "string" ? member.data.content : "";
        items.push(...extractTocItems(memberContent, `${member.sectionKey}--`));
      }
      return items;
    }
    return show_toc ? extractTocItems(typeof content === "string" ? content : "") : [];
  }, [isSplit, firstShowToc, pageArticles, show_toc, content]);

  const effectiveTocPosition = useMemo(() => {
    if (!isSplit) return toc_position;
    if (data.toc_position === "top" || data.toc_position === "side") {
      return data.toc_position;
    }
    const fromFirst = pageArticles[0]?.data.toc_position;
    if (fromFirst === "top" || fromFirst === "side") return fromFirst;
    return "side";
  }, [isSplit, toc_position, data.toc_position, pageArticles]);

  const showSideToc = tocItems.length > 0 && effectiveTocPosition === "side";
  // Mobile / top TOC only on the first article of a split page (B2).
  const showMobileOrTopToc = showSideToc
    ? isFirstArticle
    : tocItems.length > 0 && effectiveTocPosition === "top" && isFirstArticle;

  const slugCountsRef = useRef<Record<string, number>>({});

  const getHeadingId = (text: string) => {
    let id = `${idPrefix}${slugify(text)}`;
    const counts = slugCountsRef.current;
    if (counts[id] !== undefined) {
      counts[id]++;
      id = `${id}-${counts[id]}`;
    } else {
      counts[id] = 0;
    }
    return id;
  };

  slugCountsRef.current = {};

  // C2: later articles hide the entire meta row.
  const meta =
    isSplit && !isFirstArticle ? null : (
      <ArticleMeta
        tags={tags}
        category={categoryLabel}
        categoryUrl={category_url}
        readingMinutes={readingMinutes}
        authors={authors}
        updatedAt={typeof rawUpdatedAt === "string" ? rawUpdatedAt : undefined}
        locale={locale}
        showAuthors={show_authors}
        showUpdatedAt={show_updated_at}
      />
    );

  const body = (
    <div className="article-prose mx-auto max-w-[68ch]">
      {meta}
      <MarkdownRenderer
        content={typeof content === "string" ? content : ""}
        getHeadingId={getHeadingId}
      />
    </div>
  );

  return (
    <div
      className="w-full px-4 py-8 md:px-6 lg:px-8"
      data-testid="article-section"
      data-toc-group={toc_group || undefined}
      data-article-split={isSplit ? "true" : undefined}
      data-article-lead={isSplit && isFirstArticle ? "true" : undefined}
    >
      {showSideToc ? (
        <>
          {showMobileOrTopToc ? (
            <div className="lg:hidden">
              <TocTop items={tocItems} />
            </div>
          ) : null}
          <div className="flex gap-10">
            <article className="min-w-0 flex-1" data-testid="article-content">
              {body}
            </article>
            <aside className="hidden w-56 shrink-0 self-stretch lg:block xl:w-64">
              <TocSide items={tocItems} />
            </aside>
          </div>
        </>
      ) : (
        <>
          {showMobileOrTopToc && <TocTop items={tocItems} />}
          <article data-testid="article-content">
            {body}
          </article>
        </>
      )}
    </div>
  );
}

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
      ["className", /^language-/],
      ["className", /^line$/],
      "dataLanguage",
      "dataTheme",
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
      "style",
      "dataLanguage",
      "dataTheme",
      "dataLine",
      "dataRehypePrettyCodeFigure",
      "dataArticleAlert",
      "ariaHidden",
      "ariaLabel",
    ],
  },
};

function getDataLanguage(props: Record<string, unknown>): string | undefined {
  const raw =
    props["data-language"] ??
    props.dataLanguage ??
    props["data-language"] ??
    undefined;
  return typeof raw === "string" ? raw : undefined;
}

function MarkdownRenderer({
  content,
  getHeadingId,
}: {
  content: string | null | undefined;
  getHeadingId: (text: string) => string;
}) {
  const safeContent = typeof content === "string" ? content : "";
  const isEnhanced = safeContent.startsWith(ARTICLE_HTML_MARKER);
  const source = isEnhanced
    ? safeContent.slice(ARTICLE_HTML_MARKER.length).trim()
    : normalizeMathDelimiters(safeContent);

  // Server-enhanced HTML was already sanitized before Shiki/KaTeX; re-sanitizing
  // would strip token `style` / data-* attributes. Raw markdown still goes
  // through rehypeKatex + rehypeSanitize on the client.
  const remarkPlugins = (
    isEnhanced
      ? [remarkGfm]
      : [remarkGfm, [remarkMath, remarkMathOptions]]
  ) as ComponentProps<typeof ReactMarkdown>["remarkPlugins"];

  const rehypePlugins = (
    isEnhanced
      ? [rehypeRaw]
      : [rehypeRaw, [rehypeKatex, rehypeKatexOptions], [rehypeSanitize, sanitizeSchema]]
  ) as ComponentProps<typeof ReactMarkdown>["rehypePlugins"];

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={{
        h1: ({ children, ...props }) => {
          const text = extractTextFromChildren(children);
          const id = (props as { id?: string }).id || getHeadingId(text);
          return (
            <h1
              id={id}
              className="mb-4 mt-10 scroll-mt-24 text-3xl font-bold tracking-tight first:mt-0 md:text-4xl"
              data-testid={`heading-${id}`}
              {...props}
            >
              {children}
            </h1>
          );
        },
        h2: ({ children, ...props }) => {
          const text = extractTextFromChildren(children);
          const id = (props as { id?: string }).id || getHeadingId(text);
          return (
            <h2
              id={id}
              className="mb-3 mt-12 scroll-mt-24 text-2xl font-bold tracking-tight text-foreground first:mt-0 md:text-[1.75rem]"
              data-testid={`heading-${id}`}
              {...props}
            >
              {children}
            </h2>
          );
        },
        h3: ({ children, ...props }) => {
          const text = extractTextFromChildren(children);
          const id = (props as { id?: string }).id || getHeadingId(text);
          return (
            <h3
              id={id}
              className="mb-2 mt-8 scroll-mt-24 text-lg font-medium tracking-tight text-foreground/90 first:mt-0 md:text-xl"
              data-testid={`heading-${id}`}
              {...props}
            >
              {children}
            </h3>
          );
        },
        h4: ({ children, ...props }) => (
          <h4 className="mb-2 mt-6 text-base font-semibold first:mt-0" {...props}>
            {children}
          </h4>
        ),
        p: ({ children, ...props }) => (
          <p className="mb-4 mt-0 leading-8 text-foreground/90" {...props}>
            {children}
          </p>
        ),
        ul: ({ children, ...props }) => (
          <ul className="mb-4 ml-6 list-disc space-y-2 marker:text-muted-foreground" {...props}>
            {children}
          </ul>
        ),
        ol: ({ children, ...props }) => (
          <ol className="mb-4 ml-6 list-decimal space-y-2 marker:text-muted-foreground" {...props}>
            {children}
          </ol>
        ),
        li: ({ children, ...props }) => (
          <li className="leading-8 text-foreground/90" {...props}>
            {children}
          </li>
        ),
        a: ({ href, children, ...props }) => (
          <a
            href={href}
            className="text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            target={href?.startsWith("http") ? "_blank" : undefined}
            rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
            {...props}
          >
            {children}
          </a>
        ),
        blockquote: ({ children, ...props }) => (
          <blockquote
            className="mb-5 rounded-r-md border-l-4 border-primary bg-muted/30 py-3 pl-4 pr-3 text-foreground/90 not-italic"
            {...props}
          >
            {children}
          </blockquote>
        ),
        code: ({ className, children, ...props }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <code
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.875em] text-foreground"
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code className={cn("font-mono text-sm", className)} {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children, ...props }) => {
          const rest = props as Record<string, unknown>;
          const language = getDataLanguage(rest);
          // Drop react-markdown internal `node` before spreading to DOM.
          const { node: _node, ...domProps } = rest;
          return (
            <CodeBlock language={language} {...(domProps as React.HTMLAttributes<HTMLPreElement>)}>
              {children}
            </CodeBlock>
          );
        },
        figure: ({ children, ...props }) => (
          <figure className="mb-0 contents" {...props}>
            {children}
          </figure>
        ),
        hr: ({ ...props }) => (
          <hr className="my-10 border-0 border-t-2 border-border" {...props} />
        ),
        table: ({ children, ...props }) => (
          <div className="mb-5 overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-sm" {...props}>
              {children}
            </table>
          </div>
        ),
        thead: ({ children, ...props }) => (
          <thead className="border-b border-border bg-muted/50" {...props}>
            {children}
          </thead>
        ),
        th: ({ children, ...props }) => (
          <th className="border-b border-border px-4 py-2.5 text-left font-semibold" {...props}>
            {children}
          </th>
        ),
        td: ({ children, ...props }) => (
          <td className="border-b border-border px-4 py-2.5" {...props}>
            {children}
          </td>
        ),
        img: ({ src, alt, ...props }) => (
          <img
            src={src}
            alt={alt}
            className="my-4 max-w-full rounded-md"
            loading="lazy"
            {...props}
          />
        ),
        strong: ({ children, ...props }) => (
          <strong className="font-semibold text-foreground" {...props}>
            {children}
          </strong>
        ),
        div: ({ className, children, ...props }) => (
          <div className={className} {...props}>
            {children}
          </div>
        ),
      }}
    >
      {source}
    </ReactMarkdown>
  );
}

function extractTextFromChildren(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join("");
  if (children && typeof children === "object" && "props" in children) {
    return extractTextFromChildren((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

export default Article;
