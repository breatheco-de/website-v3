/**
 * Cheap page text for Jev funnel classification: title, meta, first hero + CTA.
 */

const TEMPLATE_RE = /\{\{[\s\S]*?\}\}/g;
const URL_RE = /https?:\/\/\S+/gi;

export const FUNNEL_SNIPPET_MIN_CHARS = 40;
export const FUNNEL_SNIPPET_MAX_CHARS = 2_500;

function cleanText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(TEMPLATE_RE, " ")
    .replace(URL_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pushUnique(out: string[], value: unknown): void {
  const t = cleanText(value);
  if (!t || out.includes(t)) return;
  out.push(t);
}

function collectFromObject(obj: Record<string, unknown>, keys: string[], out: string[]): void {
  for (const k of keys) {
    pushUnique(out, obj[k]);
  }
  const data = obj.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    for (const k of keys) pushUnique(out, d[k]);
    const btn = d.button ?? d.cta ?? d.primary_button ?? d.cta_button;
    if (btn && typeof btn === "object" && !Array.isArray(btn)) {
      const b = btn as Record<string, unknown>;
      pushUnique(out, b.text ?? b.label ?? b.title);
    }
    if (Array.isArray(d.buttons)) {
      for (const item of d.buttons.slice(0, 3)) {
        if (item && typeof item === "object") {
          const b = item as Record<string, unknown>;
          pushUnique(out, b.text ?? b.label ?? b.title);
        }
      }
    }
  }
}

/**
 * Build a short classification snippet from merged entry data.
 * Returns empty string when there is not enough usable copy.
 */
export function buildFunnelClassifySnippet(merged: Record<string, unknown> | null | undefined): string {
  if (!merged || typeof merged !== "object") return "";
  const parts: string[] = [];
  pushUnique(parts, merged.title);
  const meta = merged.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m = meta as Record<string, unknown>;
    pushUnique(parts, m.page_title);
    pushUnique(parts, m.description);
  }
  pushUnique(parts, merged.description);

  const sections = merged.sections;
  if (Array.isArray(sections)) {
    let heroDone = false;
    let ctaDone = false;
    for (const sec of sections) {
      if (!sec || typeof sec !== "object") continue;
      const s = sec as Record<string, unknown>;
      const type = typeof s.type === "string" ? s.type.toLowerCase() : "";
      if (!heroDone && /hero/.test(type)) {
        collectFromObject(s, ["title", "subtitle", "heading", "description", "text"], parts);
        heroDone = true;
      }
      if (!ctaDone && /(cta|call_to_action|sticky_cta)/.test(type)) {
        collectFromObject(s, ["title", "subtitle", "heading", "description", "text"], parts);
        ctaDone = true;
      }
      if (heroDone && ctaDone) break;
    }
  }

  const joined = parts.join("\n").trim();
  if (joined.length < FUNNEL_SNIPPET_MIN_CHARS) return "";
  if (joined.length > FUNNEL_SNIPPET_MAX_CHARS) {
    return `${joined.slice(0, FUNNEL_SNIPPET_MAX_CHARS)}\n…`;
  }
  return joined;
}

export function isFunnelSnippetTooThin(snippet: string): boolean {
  return cleanText(snippet).length < FUNNEL_SNIPPET_MIN_CHARS;
}
