/**
 * Structured MCP mutate/complete reports: why + highlights + server-derived simple changes.
 * Shared by MCP (zod/heuristics) and the main server (gate + event payload).
 */

export const AGENT_WHY_MIN_LENGTH = 40;
export const AGENT_WHY_MAX_LENGTH = 2000;
export const AGENT_HIGHLIGHT_MAX_LENGTH = 400;
export const AGENT_HIGHLIGHTS_MAX = 12;
/** Values longer than this (or non-scalars) are "big" and need highlights. */
export const AGENT_SIMPLE_VALUE_MAX = 120;

export type AgentSimpleChange = {
  field: string;
  after: string;
};

export type StructuredAgentReport = {
  why: string;
  highlights: string[];
  simple_changes: AgentSimpleChange[];
};

export type FieldUpdateLike = {
  field_path: string;
  value?: unknown;
  reset?: boolean;
};

const BOILERPLATE_RE =
  /cambio\s+automatico|automatic\s+change|via\s+mcp|update_fields|bot\s+seo|simon\s+via|herramienta\s+update_fields|this\s+is\s+an\s+automatic/i;

const VAGUE_HIGHLIGHT_RE =
  /^(updated|changed|edited|fixed|modified|touched)\s+(the\s+)?(section|field|page|content|meta|seo|yaml|file)s?\.?$/i;

export function sanitizeWhy(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;
  return trimmed.length > AGENT_WHY_MAX_LENGTH
    ? trimmed.slice(0, AGENT_WHY_MAX_LENGTH)
    : trimmed;
}

export function sanitizeHighlights(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim().replace(/\s+/g, " ");
    if (!t) continue;
    out.push(t.length > AGENT_HIGHLIGHT_MAX_LENGTH ? t.slice(0, AGENT_HIGHLIGHT_MAX_LENGTH) : t);
    if (out.length >= AGENT_HIGHLIGHTS_MAX) break;
  }
  return out;
}

export function formatSimpleAfter(value: unknown): string | null {
  if (value === null || value === undefined) return "(cleared)";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") {
    const t = value.trim().replace(/\s+/g, " ");
    if (!t) return "(empty)";
    if (t.length > AGENT_SIMPLE_VALUE_MAX) return null;
    return t;
  }
  return null;
}

/** True when this update needs agent highlights (not covered by simple_changes alone). */
export function isBigFieldUpdate(update: FieldUpdateLike): boolean {
  const path = typeof update.field_path === "string" ? update.field_path.trim() : "";
  if (!path) return false;
  if (path.startsWith("sections.")) return true;
  if (update.reset === true) {
    // scalar resets are simple
    if (/^(meta\.|seo\.|slug$|title$|description$|subtitle$)/.test(path)) return false;
    return true;
  }
  const v = update.value;
  if (v !== null && typeof v === "object") return true;
  if (typeof v === "string" && v.trim().length > AGENT_SIMPLE_VALUE_MAX) return true;
  return false;
}

export function deriveSimpleChanges(updates: FieldUpdateLike[]): AgentSimpleChange[] {
  const out: AgentSimpleChange[] = [];
  for (const u of updates) {
    const field = typeof u.field_path === "string" ? u.field_path.trim() : "";
    if (!field || isBigFieldUpdate(u)) continue;
    const after =
      u.reset === true ? "(cleared)" : formatSimpleAfter(u.value);
    if (after == null) continue;
    out.push({ field, after });
  }
  return out;
}

export function hasBigFieldUpdates(updates: FieldUpdateLike[]): boolean {
  return updates.some(isBigFieldUpdate);
}

export function composeAgentReportDisplay(opts: {
  why: string;
  highlights?: string[];
  simple_changes?: AgentSimpleChange[];
}): string {
  const lines: string[] = [`Why: ${opts.why.trim()}`];
  for (const c of opts.simple_changes ?? []) {
    lines.push(`• ${c.field}: ${c.after}`);
  }
  for (const h of opts.highlights ?? []) {
    const t = h.trim();
    if (t) lines.push(`• ${t}`);
  }
  return lines.join("\n");
}

export type ReportHeuristicVerdict =
  | { status: "pass" }
  | { status: "fail"; missing: string[] }
  | { status: "unsure"; missing: string[] };

/**
 * Cheap deterministic checks. `mode`:
 * - mutate_with_updates: field write; may require highlights for big fields
 * - mutate_structural: add/remove/reorder section etc. — require ≥1 highlight
 * - complete: issue complete — require ≥1 highlight
 */
export function evaluateReportHeuristics(opts: {
  why: string | undefined;
  highlights: string[];
  mode: "mutate_with_updates" | "mutate_structural" | "complete";
  updates?: FieldUpdateLike[];
}): ReportHeuristicVerdict {
  const missing: string[] = [];
  const why = opts.why?.trim() ?? "";

  if (!why) {
    missing.push("Provide why: the ticket/goal in plain English.");
  } else if (why.length < AGENT_WHY_MIN_LENGTH) {
    missing.push(`why must be at least ${AGENT_WHY_MIN_LENGTH} characters.`);
  } else if (BOILERPLATE_RE.test(why) && why.length < 120) {
    missing.push(
      "why looks like process boilerplate (automatic/MCP/tool names). State the goal and substance.",
    );
  }

  const highlights = opts.highlights.filter((h) => h.trim());
  const vagueOnly =
    highlights.length > 0 && highlights.every((h) => VAGUE_HIGHLIGHT_RE.test(h.trim()));

  if (opts.mode === "complete" || opts.mode === "mutate_structural") {
    if (highlights.length === 0) {
      missing.push(
        opts.mode === "complete"
          ? "highlights required for complete: list the biggest things you changed (e.g. links added, fields set)."
          : "highlights required for structural edits: name the biggest deltas (section type, links, CTA, etc.).",
      );
    } else if (vagueOnly) {
      missing.push("highlights are too vague — say what changed (e.g. Added links: /a, /b).");
    }
  } else if (opts.mode === "mutate_with_updates") {
    const updates = opts.updates ?? [];
    if (hasBigFieldUpdates(updates)) {
      if (highlights.length === 0) {
        missing.push(
          "This write touches big fields (sections/arrays/long text). Add highlights with the biggest deltas (links added, heading change, etc.).",
        );
      } else if (vagueOnly) {
        missing.push("highlights are too vague for big-field edits — name concrete deltas.");
      }
    }
  }

  if (missing.length > 0) return { status: "fail", missing };

  // Borderline: long why that still smells like process, or thin highlights with big updates
  if (BOILERPLATE_RE.test(why)) {
    return {
      status: "unsure",
      missing: ["why may still be too process-heavy; clarify the content outcome."],
    };
  }
  if (
    opts.mode === "mutate_with_updates" &&
    hasBigFieldUpdates(opts.updates ?? []) &&
    highlights.length === 1 &&
    highlights[0]!.length < 40
  ) {
    return {
      status: "unsure",
      missing: ["highlights may be too thin for the size of this edit."],
    };
  }

  return { status: "pass" };
}

/** Build structured report from agent why/highlights + optional updates. */
export function buildStructuredAgentReport(opts: {
  why: unknown;
  highlights?: unknown;
  updates?: FieldUpdateLike[];
}):
  | { ok: true; report: StructuredAgentReport; display: string }
  | { ok: false; missing: string[] } {
  const why = sanitizeWhy(opts.why);
  const highlights = sanitizeHighlights(opts.highlights);
  const updates = opts.updates ?? [];
  const simple_changes = deriveSimpleChanges(updates);
  const mode: "mutate_with_updates" | "mutate_structural" =
    updates.length > 0 ? "mutate_with_updates" : "mutate_structural";
  const verdict = evaluateReportHeuristics({ why, highlights, mode, updates });
  if (verdict.status === "fail" || !why) {
    return {
      ok: false,
      missing: verdict.status === "fail" ? verdict.missing : ["Provide why."],
    };
  }
  const report: StructuredAgentReport = { why, highlights, simple_changes };
  return { ok: true, report, display: composeAgentReportDisplay(report) };
}
