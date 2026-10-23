const INLINE_ITEM = /\s*\((\d{1,2})\)\s+/g;
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
