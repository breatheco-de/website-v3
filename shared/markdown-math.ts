/**
 * Article / markdown math helpers (KaTeX via remark-math + rehype-katex).
 *
 * Author syntax (preferred):
 * - Inline: \(E = mc^2\)
 * - Display: \[ \int_0^1 x\,dx \]
 *
 * Also accepted after normalize: $$...$$ (inline or display blocks).
 *
 * Non-effects:
 * - Bare $99 / $1.50 is NOT math (singleDollarTextMath: false).
 * - Content inside fenced ``` code blocks and inline `code` is left unchanged.
 *
 * YAML: in double-quoted strings escape backslashes (`"\\\\(x\\\\)"`);
 * prefer block scalars (`|` / `>`) so `\(` can be written literally.
 */

export const remarkMathOptions = {
  singleDollarTextMath: false,
} as const;

export const rehypeKatexOptions = {
  throwOnError: false,
  // Default is htmlAndMathml. MathML tags are not in our sanitize allowlist and
  // get unwrapped, dumping accessible text + the TeX annotation into
  // .katex-mathml (formula appears 2–3×). HTML-only avoids that.
  output: "html",
} as const;

const FENCE_OPEN_RE = /^(?:`{3,}|~{3,})/;

/**
 * Rewrite `\(...\)` → `$$...$$` and `\[...\]` → display `$$` blocks so
 * remark-math can parse them. Skips fenced code and inline `code`.
 */
export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown || (!markdown.includes("\\(") && !markdown.includes("\\["))) {
    return markdown;
  }

  const lines = markdown.split("\n");
  const out: string[] = [];
  let proseBuf: string[] = [];
  let inFence = false;
  let fenceChar = "";

  const flushProse = () => {
    if (proseBuf.length === 0) return;
    out.push(normalizeMathInProse(proseBuf.join("\n")));
    proseBuf = [];
  };

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!inFence) {
      const open = trimmed.match(FENCE_OPEN_RE);
      if (open) {
        flushProse();
        inFence = true;
        fenceChar = open[0][0];
        out.push(line);
        continue;
      }
      proseBuf.push(line);
      continue;
    }

    if (
      trimmed.length >= 3 &&
      [...trimmed].every((c) => c === fenceChar)
    ) {
      inFence = false;
      fenceChar = "";
      out.push(line);
      continue;
    }
    out.push(line);
  }

  flushProse();
  return out.join("\n");
}

/** Protect inline code, then convert paren math delimiters (may span lines). */
function normalizeMathInProse(text: string): string {
  const placeholders: string[] = [];
  const withPlaceholders = text.replace(/`[^`]*`/g, (m) => {
    const i = placeholders.length;
    placeholders.push(m);
    return `\u0000MATHCODE${i}\u0000`;
  });

  let next = withPlaceholders.replace(/\\\[([\s\S]*?)\\\]/g, (_m, body: string) => {
    const inner = String(body).trim();
    return `\n$$\n${inner}\n$$\n`;
  });

  next = next.replace(/\\\(([\s\S]*?)\\\)/g, (_m, body: string) => {
    return `$$${String(body)}$$`;
  });

  return next.replace(/\u0000MATHCODE(\d+)\u0000/g, (_m, i: string) => {
    return placeholders[Number(i)] ?? "";
  });
}
