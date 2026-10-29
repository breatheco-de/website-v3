/**
 * Local heuristics for outcome-figure claims (hire rate, salary, tuition, price).
 * clear_yes / clear_no are decided here; ambiguous is for optional Jev enrichment.
 */

export type ClaimCueVerdict = "clear_yes" | "clear_no" | "ambiguous";

const CURRENCY_OR_PCT =
  /(?:[$€£]\s?\d|\d[\d,]*(?:\.\d+)?\s*(?:%|USD|EUR|GBP|CAD|MXN|CLP|ARS)|(?:\d[\d,]*)\s*%)/i;

const OUTCOME_WORDS =
  /\b(hire\s*rates?|hiring\s*rate|salar(?:y|ies)|tuition|scholarship|ROI|return\s+on\s+investment|outcome\s+figures?|placement\s+rate|employment\s+rate|starting\s+pay|avg(?:erage)?\s+salary|precio|salario|matr[ií]cula|beca)\b/i;

/** Strong phrases that alone count as clear_yes even without currency/% . */
const STRONG_PHRASE =
  /\b(hire\s*rate|placement\s+rate|employment\s+rate|starting\s+salary|average\s+salary|tuition\s+of|tuition\s+is|precio\s+de\s+matr[ií]cula)\b/i;

const PRICE_WORD = /\b(prices?|priced|pricing|cost(?:s|ing)?|fee(?:s)?|tuition)\b/i;

export function evaluateClaimCues(text: string | null | undefined): ClaimCueVerdict {
  const t = typeof text === "string" ? text : "";
  if (!t.trim()) return "clear_no";

  if (STRONG_PHRASE.test(t)) return "clear_yes";
  if (CURRENCY_OR_PCT.test(t) && OUTCOME_WORDS.test(t)) return "clear_yes";
  if (CURRENCY_OR_PCT.test(t) && PRICE_WORD.test(t)) return "clear_yes";

  const hasMoney = CURRENCY_OR_PCT.test(t);
  const hasOutcome = OUTCOME_WORDS.test(t) || PRICE_WORD.test(t);
  if (hasMoney || hasOutcome) return "ambiguous";
  return "clear_no";
}

/** Phrases that present a named third party as choosing, partnering with, covering or awarding us (EN + ES). */
export const THIRD_PARTY_CUE =
  /\b((?:chose|selected|picked|contracted|hired|eligi[oó]|seleccion[oó]|contrat[oó])\s+(?:a\s+)?4\s?geeks|chosen\s+by|selected\s+by|picked\s+by|hired\s+by|contracted\s+by|partner(?:ed|s|ship)?\s+with|in\s+partnership\s+with|alongside|together\s+with|featured\s+(?:in|on|by)|as\s+seen\s+(?:in|on)|covered\s+by|recognized\s+by|recognised\s+by|awarded\s+by|endorsed\s+by|accredited\s+by|ranked\s+by|trusted\s+by|backed\s+by|elegid[oa]s?\s+por|seleccionad[oa]s?\s+por|contratad[oa]s?\s+por|junto\s+a|en\s+alianza\s+con|aliad[oa]s?\s+(?:de|con)|en\s+colaboraci[oó]n\s+con|reconocid[oa]s?\s+por|premiad[oa]s?\s+por|destacad[oa]s?\s+(?:en|por)|respaldad[oa]s?\s+por|avalad[oa]s?\s+por)\b/i;

export function hasThirdPartyCue(text: string | null | undefined): boolean {
  return typeof text === "string" && THIRD_PARTY_CUE.test(text);
}

/** Flatten op values into searchable text (strings, numbers, nested JSON). */
export function textFromUnknown(value: unknown, depth = 0): string {
  if (value == null || depth > 6) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => textFromUnknown(v, depth + 1)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((v) => textFromUnknown(v, depth + 1))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export type OpForClaimCue = {
  status?: string | null;
  ops?: Array<{ field_path?: string; value?: unknown }> | null;
};

const CLAIM_RELEVANT_PATH =
  /^(content|body|sections|meta\.page_title|meta\.description|title|description)(\.|$|\[)/i;

export function isClaimRelevantFieldPath(fieldPath: string): boolean {
  const p = fieldPath.trim();
  if (!p) return false;
  if (p === "content" || p === "body" || p === "sections" || p === "title" || p === "description") {
    return true;
  }
  if (p.startsWith("content.") || p.startsWith("sections[") || p.startsWith("sections.")) {
    return true;
  }
  if (p === "meta.page_title" || p === "meta.description") return true;
  if (p.includes(".content") || p.endsWith("content")) return true;
  return CLAIM_RELEVANT_PATH.test(p);
}

/** Collect proposed values from pending claim-relevant ops. */
export function collectClaimCueTextFromOps(entries: OpForClaimCue[]): string {
  const parts: string[] = [];
  for (const e of entries) {
    if (e.status && e.status !== "pending" && e.status !== "failed") continue;
    for (const op of e.ops ?? []) {
      if (typeof op.field_path !== "string" || !isClaimRelevantFieldPath(op.field_path)) continue;
      const t = textFromUnknown(op.value);
      if (t.trim()) parts.push(t);
    }
  }
  return parts.join("\n");
}

export function hasClaimRelevantPendingOps(entries: OpForClaimCue[]): boolean {
  for (const e of entries) {
    if (e.status && e.status !== "pending" && e.status !== "failed") continue;
    for (const op of e.ops ?? []) {
      if (typeof op.field_path === "string" && isClaimRelevantFieldPath(op.field_path)) {
        return true;
      }
    }
  }
  return false;
}
