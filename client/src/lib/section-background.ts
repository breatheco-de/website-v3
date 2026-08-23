import type { CSSProperties } from "react";

/**
 * Section `background` may be a Tailwind class token or a raw CSS color/gradient.
 * Gradients/colors must use inline style — never className (and never href).
 */
export function resolveSectionBackground(background?: string): {
  className?: string;
  style?: CSSProperties;
} {
  if (!background?.trim()) return {};
  const value = background.trim();
  const isRawCss =
    value.startsWith("linear-gradient") ||
    value.startsWith("radial-gradient") ||
    value.startsWith("repeating-linear-gradient") ||
    value.startsWith("repeating-radial-gradient") ||
    value.startsWith("conic-gradient") ||
    value.startsWith("hsl(") ||
    value.startsWith("hsla(") ||
    value.startsWith("rgb(") ||
    value.startsWith("rgba(") ||
    value.startsWith("#");
  if (isRawCss) {
    if (value.startsWith("linear-gradient") || value.startsWith("radial-gradient") ||
        value.startsWith("repeating-linear-gradient") || value.startsWith("repeating-radial-gradient") ||
        value.startsWith("conic-gradient")) {
      return { style: { backgroundImage: value } };
    }
    return { style: { background: value } };
  }
  return { className: value };
}
