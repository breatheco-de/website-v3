import { resolveGlobalTemplate } from "@/hooks/useInternalNav";

const TEMPLATE_LOOKS = /\{\{[\s\S]*\}\}/;

export type EditModeHrefKind = "unresolved" | "external" | "internal" | "ignore";

export type PreparedEditModeHref =
  | { kind: "unresolved"; href: string; variableName?: string }
  | { kind: "external"; href: string }
  | { kind: "internal"; href: string }
  | { kind: "ignore"; href: string };

/** Pull `entry.foo` / `global.bar` from a raw preserved or bare template string. */
export function extractTemplateVariableName(raw: string): string | undefined {
  const m = raw.match(/\{\{\s*([^\s|}]+)/);
  return m?.[1];
}

export function isUnresolvedTemplateHref(href: string): boolean {
  return TEMPLATE_LOOKS.test(href);
}

/**
 * Classify an edit-mode anchor href after unwrapping preserveTemplate
 * `{{ name | value }}` forms. Pure — used by the capture click handler and tests.
 *
 * Follow-up (not here): render-time honest hrefs / InternalLink for Cmd-click & hover.
 */
export function prepareEditModeHref(raw: string): PreparedEditModeHref {
  if (!raw) return { kind: "ignore", href: raw };

  const resolved = raw.includes("{{") ? resolveGlobalTemplate(raw) : raw;

  if (isUnresolvedTemplateHref(resolved)) {
    return {
      kind: "unresolved",
      href: resolved,
      variableName: extractTemplateVariableName(raw) ?? extractTemplateVariableName(resolved),
    };
  }

  if (/^https?:\/\//i.test(resolved)) {
    return { kind: "external", href: resolved };
  }

  if (
    resolved.startsWith("#") ||
    resolved.startsWith("mailto:") ||
    resolved.startsWith("tel:") ||
    resolved.startsWith("javascript:")
  ) {
    return { kind: "ignore", href: resolved };
  }

  // Relative / site paths — may be rewritten to /private/preview by the caller
  return { kind: "internal", href: resolved };
}
