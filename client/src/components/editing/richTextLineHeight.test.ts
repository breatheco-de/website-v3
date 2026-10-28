import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  largestTextFontSize,
  resolveLineHeightBlocks,
  setBlockLineHeight,
  syncLineHeightBlockFontSize,
} from "./richTextLineHeight";

function setup(html: string) {
  const { document } = parseHTML(`<html><body><div id="root">${html}</div></body></html>`);
  const root = document.getElementById("root") as unknown as HTMLElement;
  return { document, root };
}

function textNode(root: HTMLElement, text: string): Text {
  const visit = (n: Node): Text | null => {
    if (n.nodeType === 3 && n.textContent?.includes(text)) return n as Text;
    for (const c of Array.from(n.childNodes)) {
      const hit = visit(c);
      if (hit) return hit;
    }
    return null;
  };
  const hit = visit(root);
  if (!hit) throw new Error(`text not found: ${text}`);
  return hit;
}

function rangeInText(node: Text) {
  return {
    startContainer: node,
    startOffset: 0,
    endContainer: node,
    endOffset: node.length,
    commonAncestorContainer: node,
  };
}

describe("richTextLineHeight", () => {
  it("wraps loose inline title text in a block pinned to the text's own size", () => {
    const { root } = setup(
      '<font color="#0080ff"><span style="font-size: 0.875rem;"><span style="font-size: 1.25rem;">El Programa</span></span></font><!--EndFragment-->',
    );
    const blocks = resolveLineHeightBlocks(root, rangeInText(textNode(root, "El Programa")));
    expect(blocks).toHaveLength(1);
    setBlockLineHeight(blocks[0], "1.1");

    const block = root.firstChild as HTMLElement;
    expect(block.tagName).toBe("SPAN");
    expect(block.style.display).toBe("block");
    expect(block.style.lineHeight).toBe("1.1");
    expect(block.style.fontSize).toBe("1.25rem");
    expect(root.childNodes).toHaveLength(1);
    expect(block.textContent).toBe("El Programa");
  });

  it("reuses the existing wrapper on a second apply and clears inline line heights inside it", () => {
    const { root } = setup('<span style="font-size: 1rem; line-height: 3;">Hello</span>');
    const first = resolveLineHeightBlocks(root, rangeInText(textNode(root, "Hello")));
    setBlockLineHeight(first[0], "1.5");
    const second = resolveLineHeightBlocks(root, rangeInText(textNode(root, "Hello")));
    expect(second[0]).toBe(first[0]);
    setBlockLineHeight(second[0], "2");

    expect(root.querySelectorAll('[style*="display"]')).toHaveLength(1);
    expect(first[0].style.lineHeight).toBe("2");
    const inner = first[0].querySelector("span") as HTMLElement;
    expect(inner.style.fontSize).toBe("1rem");
    expect(inner.style.lineHeight).toBe("");
  });

  it("applies to an existing paragraph block instead of wrapping", () => {
    const { root } = setup('<div>First <span style="font-size: 20px;">line</span></div><div>Other</div>');
    const blocks = resolveLineHeightBlocks(root, rangeInText(textNode(root, "line")));
    setBlockLineHeight(blocks[0], "1.2");

    const firstDiv = root.firstChild as HTMLElement;
    expect(blocks[0]).toBe(firstDiv);
    expect(firstDiv.style.lineHeight).toBe("1.2");
    // "First " has no explicit size, so the block keeps inheriting the heading size.
    expect(firstDiv.style.fontSize).toBe("");
    expect((root.lastChild as HTMLElement).style.lineHeight).toBe("");
  });

  it("covers every block a multi-paragraph selection touches", () => {
    const { root } = setup("<div>One</div><div>Two</div><div>Three</div>");
    const blocks = resolveLineHeightBlocks(root, {
      startContainer: textNode(root, "One"),
      startOffset: 0,
      endContainer: textNode(root, "Two"),
      endOffset: 3,
      commonAncestorContainer: root,
    });
    expect(blocks.map((b) => b.textContent)).toEqual(["One", "Two"]);
  });

  it("picks the largest explicit size and bails out on relative units", () => {
    const a = setup('<span style="font-size: 1rem;">a</span><span style="font-size: 24px;">b</span>');
    expect(largestTextFontSize(a.root)).toBe("24px");
    const b = setup('<span style="font-size: 1.5em;">a</span>');
    expect(largestTextFontSize(b.root)).toBeNull();
  });

  it("re-pins the block size after a font-size change inside it", () => {
    const { root } = setup('<span style="font-size: 1rem;">Title</span>');
    const [block] = resolveLineHeightBlocks(root, rangeInText(textNode(root, "Title")));
    setBlockLineHeight(block, "1.1");
    const inner = block.querySelector("span") as HTMLElement;
    inner.style.fontSize = "2rem";
    syncLineHeightBlockFontSize(root, inner);
    expect(block.style.fontSize).toBe("2rem");
    expect(block.style.lineHeight).toBe("1.1");
  });
});
