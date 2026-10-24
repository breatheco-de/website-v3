import type { InlineCode, Link, Parent, Root, Text } from "mdast";
import { SKIP, visit } from "unist-util-visit";

const INLINE_ITEM = /\s*\((\d{1,2})\)\s+/g;
const SITE_PATH_BODY = String.raw`\/[A-Za-z0-9][\w.~%-]*(?:\/[\w.~%-]+)*\/?(?:[?#][\w=&%.~\/-]*)?`;
/** A site path must start the text or follow whitespace/opening punctuation, so `a/b` and URLs are left alone. */
const SITE_PATH_IN_TEXT = new RegExp(String.raw`(^|[\s(\[{"'“‘])(${SITE_PATH_BODY})`, "g");
const SITE_PATH_EXACT = new RegExp(String.raw`^${SITE_PATH_BODY}$`);
const MARKDOWN_LIST_LINE = /^\s*(?:\d+[.)]|[-*+])\s/m;

/**
 * Older agent text packs "(1) … (2) …" into one paragraph. Turn those into a
 * Markdown numbered list (lead sentence kept above it). Text that already
 * contains a list, or whose markers are not a 1, 2, 3… sequence, is unchanged.
 */
export function splitInlineNumberedList(text: string): string {
  if (MARKDOWN_LIST_LINE.test(text)) return text;

  const markers = [...text.matchAll(INLINE_ITEM)];
  if (markers.length < 2) return text;
  if (markers.some((m, i) => Number(m[1]) !== i + 1)) return text;

  const lead = text.slice(0, markers[0].index).trim();
  const items = markers.map((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < markers.length ? markers[i + 1].index! : text.length;
    return `${i + 1}. ${text.slice(start, end).replace(/\s*\n+\s*/g, " ").trim()}`;
  });

  return lead ? `${lead}\n\n${items.join("\n")}` : items.join("\n");
}

/**
 * Prepare agent-written proposal text for Markdown rendering: split inline
 * numbered lists, and keep single line breaks (plain-text bodies relied on them;
 * Markdown would otherwise join those lines).
 */
export function formatProposalMarkdown(text: string): string {
  return splitInlineNumberedList(text.trim()).replace(/([^\n])\n(?!\n)/g, "$1  \n");
}

/** Site-relative href (`/blog/x`), not protocol-relative (`//cdn…`). */
export function isSitePath(value: string): boolean {
  return SITE_PATH_EXACT.test(value);
}

export type SitePathPart = { kind: "text" | "path"; value: string };

/** Split plain text into text and site-path parts (`see /blog/x.` → text, `/blog/x`, `.`). */
export function splitSitePaths(text: string): SitePathPart[] {
  const parts: SitePathPart[] = [];
  let last = 0;
  for (const match of Array.from(text.matchAll(SITE_PATH_IN_TEXT))) {
    const path = match[2].replace(/\.+$/, "");
    const start = match.index! + match[1].length;
    if (start > last) parts.push({ kind: "text", value: text.slice(last, start) });
    parts.push({ kind: "path", value: path });
    last = start + path.length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

/** Remark plugin: turn bare site paths in text and `inline code` into links (existing links untouched). */
export function remarkSitePaths() {
  return (tree: Root) => {
    visit(tree, (node, index, parent: Parent | undefined) => {
      if (!parent || index === undefined || parent.type === "link" || parent.type === "linkReference") return;

      if (node.type === "inlineCode") {
        const code = node as InlineCode;
        if (!isSitePath(code.value)) return;
        const link: Link = { type: "link", url: code.value, children: [code] };
        parent.children[index] = link;
        return SKIP;
      }

      if (node.type !== "text") return;
      const parts = splitSitePaths((node as Text).value);
      if (!parts.some((p) => p.kind === "path")) return;
      const replacement = parts.map((p): Text | Link =>
        p.kind === "path"
          ? { type: "link", url: p.value, children: [{ type: "text", value: p.value }] }
          : { type: "text", value: p.value },
      );
      parent.children.splice(index, 1, ...replacement);
      return [SKIP, index + replacement.length];
    });
  };
}
