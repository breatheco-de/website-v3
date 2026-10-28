/**
 * Line height in rich text is a paragraph property: CSS never lets an inline
 * span shrink a line below the strut of its block (e.g. a hero `text-5xl` h2
 * keeps 48px lines no matter what an inner span says). So line height is set
 * on the enclosing block, and that block's font-size is pinned to the largest
 * explicit text size inside it so a unitless value is measured against the
 * text the visitor actually sees.
 */

const BLOCK_TAGS = new Set([
  "DIV",
  "P",
  "LI",
  "UL",
  "OL",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "PRE",
]);

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export type LineHeightRange = Pick<
  Range,
  "startContainer" | "startOffset" | "endContainer" | "endOffset" | "commonAncestorContainer"
>;

function isBlockNode(node: Node | null): node is HTMLElement {
  if (!node || node.nodeType !== ELEMENT_NODE) return false;
  const el = node as HTMLElement;
  return BLOCK_TAGS.has(el.tagName) || el.style?.display === "block";
}

function nearestBlock(root: HTMLElement, node: Node): HTMLElement | null {
  let cur: Node | null = node;
  while (cur && cur !== root) {
    if (isBlockNode(cur)) return cur;
    cur = cur.parentNode;
  }
  return null;
}

function topLevelChild(root: HTMLElement, node: Node): Node | null {
  let cur: Node | null = node;
  while (cur && cur.parentNode !== root) cur = cur.parentNode;
  return cur;
}

/** Nearest block around `node`; inline content sitting directly in `root` is wrapped in a new `display:block` span (the whole run between blocks). */
export function resolveLineHeightBlock(root: HTMLElement, node: Node): HTMLElement | null {
  if (node === root || !root.contains(node)) return null;
  const existing = nearestBlock(root, node);
  if (existing) return existing;

  const top = topLevelChild(root, node);
  if (!top) return null;
  let start: Node = top;
  while (start.previousSibling && !isBlockNode(start.previousSibling)) start = start.previousSibling;
  let end: Node = top;
  while (end.nextSibling && !isBlockNode(end.nextSibling)) end = end.nextSibling;

  const wrapper = root.ownerDocument.createElement("span");
  wrapper.style.display = "block";
  root.insertBefore(wrapper, start);
  let cur: Node | null = start;
  while (cur) {
    const next: Node | null = cur.nextSibling;
    wrapper.appendChild(cur);
    if (cur === end) break;
    cur = next;
  }
  return wrapper;
}

function boundaryChild(root: HTMLElement, container: Node, offset: number, isEnd: boolean): Node | null {
  if (container === root) {
    const count = root.childNodes.length;
    if (count === 0) return null;
    const idx = Math.max(0, Math.min(isEnd ? offset - 1 : offset, count - 1));
    return root.childNodes[idx] ?? null;
  }
  return topLevelChild(root, container);
}

/** Every block the range touches (creating wrapper blocks for loose inline runs). */
export function resolveLineHeightBlocks(root: HTMLElement, range: LineHeightRange): HTMLElement[] {
  if (range.commonAncestorContainer !== root) {
    const block = resolveLineHeightBlock(root, range.commonAncestorContainer);
    return block ? [block] : [];
  }

  const first = boundaryChild(root, range.startContainer, range.startOffset, false);
  const last = boundaryChild(root, range.endContainer, range.endOffset, true);
  if (!first || !last) return [];
  const children = Array.from(root.childNodes);
  const from = children.indexOf(first as ChildNode);
  const to = children.indexOf(last as ChildNode);
  if (from < 0 || to < from) return [];

  const blocks: HTMLElement[] = [];
  for (const child of children.slice(from, to + 1)) {
    if (child.parentNode !== root) continue;
    if (child.nodeType === TEXT_NODE && !child.textContent?.trim()) continue;
    const block = resolveLineHeightBlock(root, child);
    if (block && !blocks.includes(block)) blocks.push(block);
  }
  return blocks;
}

function fontSizeToPx(value: string): number | null {
  const match = value.trim().match(/^(\d*\.?\d+)(px|rem)$/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  return match[2] === "rem" ? n * 16 : n;
}

/** Largest explicit font-size covering every visible text node, or null when some text has no explicit size (or uses a relative unit). */
export function largestTextFontSize(block: HTMLElement): string | null {
  const best = { value: "", px: -1 };
  let complete = true;

  const visit = (node: Node) => {
    if (!complete) return;
    if (node.nodeType === TEXT_NODE) {
      if (!node.textContent?.trim()) return;
      let cur: Node | null = node.parentNode;
      let size: string | null = null;
      while (cur && cur !== block) {
        const fs = (cur as HTMLElement).style?.fontSize;
        if (fs) {
          size = fs;
          break;
        }
        cur = cur.parentNode;
      }
      const px = size ? fontSizeToPx(size) : null;
      if (!size || px === null) {
        complete = false;
        return;
      }
      if (px > best.px) {
        best.value = size;
        best.px = px;
      }
      return;
    }
    node.childNodes.forEach(visit);
  };
  block.childNodes.forEach(visit);

  return complete && best.value ? best.value : null;
}

export function setBlockLineHeight(block: HTMLElement, value: string): void {
  block.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    if (!el.style.lineHeight) return;
    el.style.removeProperty("line-height");
    if (!el.getAttribute("style")?.trim()) el.removeAttribute("style");
  });
  block.style.lineHeight = value;
  const fontSize = largestTextFontSize(block);
  if (fontSize) block.style.fontSize = fontSize;
}

/** After a font-size change, keep the enclosing line-height block measured against the new text size. */
export function syncLineHeightBlockFontSize(root: HTMLElement, node: Node): void {
  let cur: Node | null = node;
  while (cur && cur !== root) {
    if (isBlockNode(cur) && cur.style.lineHeight) {
      setBlockLineHeight(cur, cur.style.lineHeight);
      return;
    }
    cur = cur.parentNode;
  }
}
