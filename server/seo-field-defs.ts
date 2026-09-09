/**
 * Platform SEO strategy field catalog — allowlist, types, fill_intent, system_hints.
 * Derive KNOWN_SEO_FIELDS / research lists from this; do not maintain parallel key arrays.
 */

import type { EditorFillIntent } from "@shared/fillIntent";

export const SEO_YAML_KEY = "seo";

export const SEO_REFRESH_TIERS = ["fast", "medium", "evergreen"] as const;
export type SeoRefreshTier = (typeof SEO_REFRESH_TIERS)[number];

export type SeoFieldValueType = "string" | "integer" | "boolean" | "enum";

export type SeoFieldDef = {
  key: string;
  type: SeoFieldValueType;
  enum?: readonly string[];
  /** Mirror onto seo-index.json row when the entry has an SEO signal. */
  index: boolean;
  researchMetric?: boolean;
  researchWrite?: boolean;
  /** Judgment brief for agents (same shape as editor fill_intent). */
  fill_intent: EditorFillIntent;
  /** Write-layer mechanics / non-effects for MCP get_entry_fields. */
  system_hints: string[];
  staff_label?: string;
};

const SHARED_LOCALE_HINTS = [
  "Locale YAML seo: for writes (writeSeoFields). Never _common.yml; never writeMappedFields for seo.*.",
  "Live write patches seo-index.json after disk with the same author. Variants are not indexed.",
] as const;

const CLUSTER_HINTS = [
  "Prefer seo.include_in_clustering (MCP-only boolean) to turn cluster monitoring on/off for this entry.",
  "Off expands to seo.pillar_path: null + seo.is_pillar: false. On requires non-empty seo.pillar_path or seo.is_pillar: true after merge.",
  "Optional field_mapping seo_main_keyword|seo_pillar_path|seo_is_pillar = DB read baseline; YAML overlay wins. Reset removes YAML key only. Never dotted seo.* in field_mapping.",
  "Empty pillar_path is a cluster gap; null is opt-out.",
] as const;

export const SEO_FIELD_DEFS = [
  {
    key: "main_keyword",
    type: "string",
    index: true,
    researchWrite: true,
    staff_label: "Main keyword",
    fill_intent: {
      goal: "seo",
      purpose:
        "Primary search phrase this page should own for clustering and keyword research.",
      constraints: [
        "Live uniqueness: exact string after trim must be free site-wide (seo-index).",
        "Same entry may re-save its own keyword. Case differs are allowed. Drafts/variants not checked.",
      ],
    },
    system_hints: [
      "Live uniqueness: exact string after trim must be free site-wide (seo-index). Same entry may re-save its keyword. Case differs are allowed. Drafts/variants not checked.",
      "Conflict → code seo_keyword_taken (names the other path). Missing index → seo_index_unavailable (hard block, no write).",
      ...SHARED_LOCALE_HINTS,
      ...CLUSTER_HINTS,
    ],
  },
  {
    key: "kw_monthly_volume",
    type: "integer",
    index: true,
    researchMetric: true,
    researchWrite: true,
    staff_label: "Keyword monthly volume",
    fill_intent: {
      goal: "seo",
      purpose: "Planning estimate of monthly search volume for seo.main_keyword — not GSC clicks.",
      constraints: [
        "Integer ≥ 0 or omit.",
        "OpenRush on: use refresh_keyword_metrics (cache); do not invent YAML.",
      ],
    },
    system_hints: [
      "Research metrics for seo.main_keyword — not GSC clicks/impressions.",
      "OpenRush on: use refresh_keyword_metrics (cache); YAML kw_* writes are rejected for agents.",
      "OpenRush off: update_fields requires seo_research_source staff_provided|external:<name>. Do not invent.",
      "Integer only (volume ≥ 0). If any of main_keyword|kw_* is in a write, omitted metrics are forced to null.",
      ...SHARED_LOCALE_HINTS,
    ],
  },
  {
    key: "kw_difficulty",
    type: "integer",
    index: true,
    researchMetric: true,
    researchWrite: true,
    staff_label: "Keyword difficulty",
    fill_intent: {
      goal: "seo",
      purpose: "Planning estimate of keyword difficulty (0–100) for seo.main_keyword — not live rankings.",
      constraints: [
        "Integer 0–100 or omit.",
        "OpenRush on: use refresh_keyword_metrics (cache); do not invent YAML.",
      ],
    },
    system_hints: [
      "Research metrics for seo.main_keyword — not GSC clicks/impressions.",
      "OpenRush on: use refresh_keyword_metrics (cache); YAML kw_* writes are rejected for agents.",
      "OpenRush off: update_fields requires seo_research_source staff_provided|external:<name>. Do not invent.",
      "Integer only (difficulty 0–100). If any of main_keyword|kw_* is in a write, omitted metrics are forced to null.",
      ...SHARED_LOCALE_HINTS,
    ],
  },
  {
    key: "pillar_path",
    type: "string",
    index: true,
    staff_label: "Pillar path",
    fill_intent: {
      goal: "seo",
      purpose: "Join an existing topic hub, or null to opt out of clustering.",
      constraints: [
        "Non-empty path = member of that hub. null = opt out. Empty/missing = cluster gap.",
        "Do not invent hub paths — list hubs first.",
      ],
    },
    system_hints: [
      "seo.is_pillar auto-fills this page's canonical path. Do not invent pillar_path.",
      "Empty pillar_path is a cluster gap; null is opt-out.",
      ...SHARED_LOCALE_HINTS,
      ...CLUSTER_HINTS,
    ],
  },
  {
    key: "is_pillar",
    type: "boolean",
    index: true,
    staff_label: "Is pillar",
    fill_intent: {
      goal: "seo",
      purpose: "Mark this page as the topic hub for its cluster.",
      constraints: [
        "Only when this page is the overview and no hub exists yet.",
        "Auto-fills seo.pillar_path to this page's canonical URL.",
      ],
    },
    system_hints: [
      "seo.is_pillar auto-fills this page's canonical path. Do not invent pillar_path.",
      ...SHARED_LOCALE_HINTS,
      ...CLUSTER_HINTS,
    ],
  },
  {
    key: "refresh_tier",
    type: "enum",
    enum: SEO_REFRESH_TIERS,
    index: true,
    staff_label: "Refresh tier",
    fill_intent: {
      goal: "seo",
      purpose:
        "Classify how fast this page's facts go stale so agents prioritize substantive refreshes (not timestamp bumps).",
      constraints: [
        "fast: pricing, tools, best-of/year lists, model/bench/salary comps.",
        "medium: program, landing, and cluster hubs.",
        "evergreen: concept explainers — only when the underlying fact moves.",
        "When Include in SEO clustering is on, pick one of the three — no unset in staff UI.",
        "Cannot clear once set; change only by picking another tier. Per locale; translate does not copy.",
      ],
    },
    system_hints: [
      "Writes locale YAML seo.refresh_tier; mirrored on seo-index.json when the entry has an SEO signal.",
      "Not GSC traffic decay; not diagnostics cache freshness; does not bump updated_at.",
      "Alone does not keep an seo-index row (needs keyword/cluster signal).",
      "Cannot clear (null/reset/empty forbidden) — pick fast|medium|evergreen. Omit the field to leave unchanged.",
      "Staff UI shows this only when Include in SEO clustering is on.",
      "To choose a tier: read fill_intent on get_entry_fields, or explain_site topic seo.",
      ...SHARED_LOCALE_HINTS,
    ],
  },
] as const satisfies readonly SeoFieldDef[];

export type KnownSeoField = (typeof SEO_FIELD_DEFS)[number]["key"];

export const KNOWN_SEO_FIELDS = SEO_FIELD_DEFS.map((d) => d.key) as unknown as readonly KnownSeoField[];

export const SEO_RESEARCH_METRIC_FIELDS = SEO_FIELD_DEFS.filter((d) => d.researchMetric).map(
  (d) => d.key,
) as unknown as readonly ("kw_monthly_volume" | "kw_difficulty")[];

export type SeoResearchMetricField = (typeof SEO_RESEARCH_METRIC_FIELDS)[number];

export const SEO_RESEARCH_WRITE_FIELDS = SEO_FIELD_DEFS.filter((d) => d.researchWrite).map(
  (d) => d.key,
) as unknown as readonly KnownSeoField[];

const DEFS_BY_KEY = new Map<string, SeoFieldDef>(
  SEO_FIELD_DEFS.map((d) => [d.key, d as SeoFieldDef]),
);

export function getSeoFieldDef(keyOrPath: string): SeoFieldDef | null {
  const key = keyOrPath.startsWith(`${SEO_YAML_KEY}.`)
    ? keyOrPath.slice(SEO_YAML_KEY.length + 1)
    : keyOrPath;
  return DEFS_BY_KEY.get(key) ?? null;
}

export function isSeoRefreshTier(value: unknown): value is SeoRefreshTier {
  return typeof value === "string" && (SEO_REFRESH_TIERS as readonly string[]).includes(value);
}

export function isKnownSeoFieldPath(fieldPath: string): boolean {
  return (KNOWN_SEO_FIELDS as readonly string[]).some((k) => fieldPath === `${SEO_YAML_KEY}.${k}`);
}

export function seoFieldFromPath(fieldPath: string): KnownSeoField | null {
  if (!fieldPath.startsWith(`${SEO_YAML_KEY}.`)) return null;
  const key = fieldPath.slice(SEO_YAML_KEY.length + 1);
  return (KNOWN_SEO_FIELDS as readonly string[]).includes(key) ? (key as KnownSeoField) : null;
}
