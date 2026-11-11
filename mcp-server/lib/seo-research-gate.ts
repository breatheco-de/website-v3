/**
 * Gate agent YAML writes of seo.kw_monthly_volume / seo.kw_difficulty (B + B1).
 * SEO research on → reject YAML (use get_or_refresh_seo_research). Off → require provenance.
 */

import { isSeoResearchConfigured } from "../../server/seo-research-providers.js";
import type { NextAction } from "./respond.js";

export const SEO_KW_VOLUME = "seo.kw_monthly_volume";
export const SEO_KW_DIFFICULTY = "seo.kw_difficulty";

export type SeoResearchFieldUpdate = {
  field_path: string;
  value?: unknown;
  reset?: boolean;
};

export type SeoResearchSourceCheck =
  | { ok: true; source: string | null; metricsSet: boolean }
  | {
      ok: false;
      code: "seo_research_use_openrush" | "seo_research_source_required";
      message: string;
      next_actions: NextAction[];
      details: Record<string, unknown>;
    };

/** True when updates set (non-reset) volume and/or difficulty. */
export function touchesKwMetricSets(updates: SeoResearchFieldUpdate[]): boolean {
  return updates.some(
    (u) =>
      (u.field_path === SEO_KW_VOLUME || u.field_path === SEO_KW_DIFFICULTY) &&
      u.reset !== true,
  );
}

/** True when updates touch volume/difficulty including reset. */
export function touchesKwMetrics(updates: SeoResearchFieldUpdate[]): boolean {
  return updates.some(
    (u) => u.field_path === SEO_KW_VOLUME || u.field_path === SEO_KW_DIFFICULTY,
  );
}

/**
 * Approved offline provenance: staff_provided | external:<nonempty name>.
 * Rejects openrush (use refresh tool), estimated, model, empty, etc.
 */
export function isApprovedSeoResearchSource(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower === "staff_provided") return true;
  if (lower.startsWith("external:")) {
    const name = s.slice("external:".length).trim();
    return name.length > 0;
  }
  return false;
}

export function normalizeSeoResearchSource(raw: unknown): string | null {
  if (!isApprovedSeoResearchSource(raw)) return null;
  const s = raw.trim();
  if (s.toLowerCase() === "staff_provided") return "staff_provided";
  const name = s.slice("external:".length).trim();
  return `external:${name}`;
}

export function seoResearchWriteGate(opts: {
  contentRoot: string;
  updates: SeoResearchFieldUpdate[];
  seo_research_source?: unknown;
  slug: string;
  locale: string;
  contentType: string;
  site?: string;
}): SeoResearchSourceCheck {
  const metricsSet = touchesKwMetricSets(opts.updates);
  if (!metricsSet) {
    return { ok: true, source: null, metricsSet: false };
  }

  const siteArg = opts.site ? { site: opts.site } : {};
  const researchOn = isSeoResearchConfigured("keyword_metrics", opts.contentRoot);

  if (researchOn) {
    return {
      ok: false,
      code: "seo_research_use_openrush",
      message:
        "SEO research is configured — do not write seo.kw_monthly_volume / seo.kw_difficulty via YAML. " +
        "Call get_or_refresh_seo_research with action keyword_metrics (cache only, does not write YAML). " +
        "Do not invent volume or difficulty.",
      details: { seo_research_configured: true },
      next_actions: [
        {
          tool: "get_or_refresh_seo_research",
          priority: "required",
          reason: "Refresh keyword research cache for this entry's main_keyword (no YAML invent).",
          args_hint: {
            action: "keyword_metrics",
            slug: opts.slug,
            locale: opts.locale,
            contentType: opts.contentType,
            ...siteArg,
          },
        },
        {
          tool: "get_entry_seo",
          priority: "recommended",
          reason: "Confirm keyword_metrics after refresh.",
          args_hint: {
            slug: opts.slug,
            locale: opts.locale,
            contentType: opts.contentType,
            ...siteArg,
          },
        },
      ],
    };
  }

  const source = normalizeSeoResearchSource(opts.seo_research_source);
  if (!source) {
    return {
      ok: false,
      code: "seo_research_source_required",
      message:
        "SEO research is not configured. Writing seo.kw_monthly_volume / seo.kw_difficulty requires " +
        "seo_research_source: staff_provided or external:<tool_name> (e.g. external:google_keyword_planner). " +
        "Do not invent estimates (rejected: openrush, estimated, model, empty). " +
        "If you have no reliable source, do not claim / release blocked.",
      details: {
        seo_research_configured: false,
        accepted: ["staff_provided", "external:<name>"],
      },
      next_actions: [
        {
          tool: "update_fields",
          priority: "recommended",
          reason:
            "Retry with seo_research_source after you have staff-provided or external tool metrics — not guesses.",
          args_hint: {
            slug: opts.slug,
            locale: opts.locale,
            contentType: opts.contentType,
            seo_research_source: "staff_provided",
            ...siteArg,
          },
        },
        {
          tool: "update_issue",
          priority: "optional",
          reason: "Release if you cannot obtain reliable volume/difficulty.",
          args_hint: { action: "release", ...siteArg },
        },
      ],
    };
  }

  return { ok: true, source, metricsSet: true };
}
