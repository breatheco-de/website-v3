/**
 * editor.<field>.fill_intent — declarative why/how for required Fields.
 * goal is an open string; FILL_INTENT_GOAL_PRESETS are UI/MCP suggestions only.
 */

export type FillIntentGoalPresetOption = {
  /** Stored `fill_intent.goal` slug. */
  value: string;
  /** Staff-facing short title in the Goal preset dropdown. */
  title: string;
  /** One-line help under the title. */
  description: string;
};

/** Suggested goals with UI/MCP copy; validation only requires a non-empty trimmed string. */
export const FILL_INTENT_GOAL_PRESET_OPTIONS = [
  {
    value: "geo_llm",
    title: "GEO / LLM answers",
    description: "Clear, citation-friendly answers for AI search and answer engines.",
  },
  {
    value: "conversion",
    title: "Conversion",
    description: "Drive leads or purchases — CTAs, offers, and funnel-aligned copy.",
  },
  {
    value: "seo",
    title: "SEO",
    description: "Search visibility: keywords, titles, snippets, and topical coverage.",
  },
  {
    value: "editorial",
    title: "Editorial",
    description: "Voice, clarity, and narrative quality for human readers.",
  },
  {
    value: "structural",
    title: "Structural",
    description: "Shape and completeness (counts, required pieces, layout integrity).",
  },
  {
    value: "compliance",
    title: "Compliance",
    description: "Legal, policy, accuracy, or brand-safety constraints.",
  },
  {
    value: "other",
    title: "Other",
    description: "Doesn’t fit a preset — spell the why in Purpose below.",
  },
] as const satisfies readonly FillIntentGoalPresetOption[];

export type FillIntentGoalPreset = (typeof FILL_INTENT_GOAL_PRESET_OPTIONS)[number]["value"];

/** Slug list derived from options (includes checks, MCP string arrays, tests). */
export const FILL_INTENT_GOAL_PRESETS: readonly FillIntentGoalPreset[] =
  FILL_INTENT_GOAL_PRESET_OPTIONS.map((o) => o.value);

export type EditorFillIntent = {
  /** Open slug/tag; presets are suggestions only. */
  goal: string;
  purpose: string;
  constraints?: string[];
};

export function getFillIntentGoalPreset(
  goal: string,
): FillIntentGoalPresetOption | undefined {
  const trimmed = goal.trim();
  return FILL_INTENT_GOAL_PRESET_OPTIONS.find((o) => o.value === trimmed);
}

export function isPresetFillIntentGoal(goal: string): boolean {
  return getFillIntentGoalPreset(goal) != null;
}

/**
 * Normalize unknown YAML/JSON into EditorFillIntent or null if unusable.
 */
export function parseFillIntent(raw: unknown): EditorFillIntent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const goal = typeof obj.goal === "string" ? obj.goal.trim() : "";
  const purpose = typeof obj.purpose === "string" ? obj.purpose.trim() : "";
  if (!goal || !purpose) return null;
  const constraintsRaw = obj.constraints;
  let constraints: string[] | undefined;
  if (Array.isArray(constraintsRaw)) {
    const list = constraintsRaw
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.trim())
      .filter(Boolean);
    if (list.length > 0) constraints = list;
  }
  return constraints ? { goal, purpose, constraints } : { goal, purpose };
}

export function isValidFillIntent(raw: unknown): raw is EditorFillIntent {
  return parseFillIntent(raw) !== null;
}

/** Compact text for Diagnostics suggestions / agent prompts. */
export function formatFillIntentForSuggestion(intent: EditorFillIntent): string {
  const parts = [`[goal: ${intent.goal}] ${intent.purpose}`];
  if (intent.constraints && intent.constraints.length > 0) {
    parts.push(`Constraints: ${intent.constraints.join("; ")}`);
  }
  return parts.join(" ");
}

export type RequiredFillIntentGap = {
  field: string;
  reason: "missing" | "invalid";
};

/**
 * List editor keys with required true|attached that lack a valid fill_intent.
 */
export function listRequiredFieldsMissingFillIntent(
  editor: Record<string, { required?: unknown; fill_intent?: unknown }> | null | undefined,
): RequiredFillIntentGap[] {
  if (!editor) return [];
  const gaps: RequiredFillIntentGap[] = [];
  for (const [field, hint] of Object.entries(editor)) {
    const req = hint?.required;
    if (req !== true && req !== "attached") continue;
    if (!hint.fill_intent) {
      gaps.push({ field, reason: "missing" });
      continue;
    }
    if (!isValidFillIntent(hint.fill_intent)) {
      gaps.push({ field, reason: "invalid" });
    }
  }
  return gaps;
}

export function assertRequiredFieldsHaveFillIntent(
  editor: Record<string, { required?: unknown; fill_intent?: unknown }> | null | undefined,
): { ok: true } | { ok: false; error: string; fields: string[] } {
  const gaps = listRequiredFieldsMissingFillIntent(editor);
  if (gaps.length === 0) return { ok: true };
  const fields = gaps.map((g) => g.field);
  return {
    ok: false,
    fields,
    error:
      `Fields with editor.required need a valid fill_intent (non-empty goal + purpose): ${fields.join(", ")}. ` +
      `Set fill_intent in Fields UI or content-types.yml.`,
  };
}

/** Non-empty goals that are not in the preset list (soft Diagnostics warning). */
export function listNonPresetFillIntentGoals(
  editor: Record<string, { required?: unknown; fill_intent?: unknown }> | null | undefined,
): Array<{ field: string; goal: string }> {
  if (!editor) return [];
  const out: Array<{ field: string; goal: string }> = [];
  for (const [field, hint] of Object.entries(editor)) {
    const parsed = parseFillIntent(hint?.fill_intent);
    if (!parsed) continue;
    if (!isPresetFillIntentGoal(parsed.goal)) {
      out.push({ field, goal: parsed.goal });
    }
  }
  return out;
}
