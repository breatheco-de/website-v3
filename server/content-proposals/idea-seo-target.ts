/**
 * Structured SEO target on new-URL ideas (focus keyword + cluster decision).
 * Mirrors idea_funnel: author sets it, accept requires + freezes it, the creating
 * edits proposal seeds it into the new page's draft `seo:` block.
 */

import {
  IDEA_AUTHOR_SITUATION_IDS,
  isIdeaAuthorSituationId,
  type IdeaAuthorSituationId,
} from "./review-situations";

export type IdeaSeoHubMember = { contentType: string; slug: string };

export type IdeaSeoCluster =
  | { mode: "join"; pillar_path: string }
  | { mode: "hub"; members: IdeaSeoHubMember[] }
  | { mode: "standalone"; reason: string };

/**
 * `kw_*` are the author's planning evidence for main_keyword (same meaning as the page's
 * seo.kw_* fields). They stay on the idea: never seeded into the draft, because page metrics
 * come from the SEO research cache or a sourced write.
 */
export type IdeaSeoTarget = {
  main_keyword: string;
  cluster: IdeaSeoCluster;
  kw_monthly_volume?: number;
  kw_difficulty?: number;
};

/** Edits proposal: why its seo.* ops differ from the implemented idea's locked target. */
export type SeoTargetOverride = { reason: string };

export const IDEA_SEO_TARGET_MISSING_WARN = "idea_seo_target_missing";
export const IDEA_SEO_TARGET_METRICS_MISSING_WARN = "idea_seo_target_metrics_missing";
export const IDEA_SEO_TARGET_INCOMPLETE = "idea_seo_target_incomplete";
export const IDEA_SEO_TARGET_REQUIRED = "idea_seo_target_required";
export const IDEA_SEO_TARGET_FROZEN = "idea_seo_target_frozen";
export const IDEA_SEO_TARGET_CONFLICT = "idea_seo_target_conflict";
export const IDEA_SEO_TARGET_STANDALONE_NOT_ALLOWED = "idea_seo_target_standalone_not_allowed";
export const IDEA_SEO_TARGET_HUB_NOT_LIVE = "idea_seo_target_hub_not_live";
export const IDEA_SEO_TARGET_HUB_GONE = "idea_seo_target_hub_gone";
export const IDEA_SEO_TARGET_KEYWORD_TAKEN = "idea_seo_target_keyword_taken";
export const IDEA_SEO_TARGET_HUB_MEMBERS_REQUIRED = "idea_seo_target_hub_members_required";
export const IDEA_SEO_TARGET_MEMBERS_CLAIMED = "idea_seo_target_members_claimed";
export const SEO_TARGET_OVERRIDE_INVALID = "seo_target_override_invalid";

/** Written reasons (standalone, override, opt-out) must carry real justification. */
export const SEO_REASON_MIN = 40;

/** Demand labels whose ideas may ship a standalone (unclustered) page. */
export const STANDALONE_DEMAND_LABELS: readonly IdeaAuthorSituationId[] = [
  "fast_decay_news",
  "broken_url",
];

export function ideaDemandLabel(
  reviewSituations: readonly string[] | null | undefined,
): IdeaAuthorSituationId | null {
  for (const id of reviewSituations ?? []) {
    if (isIdeaAuthorSituationId(id)) return id;
  }
  return null;
}

export function standaloneAllowedForDemand(label: string | null | undefined): boolean {
  return typeof label === "string" && (STANDALONE_DEMAND_LABELS as readonly string[]).includes(label);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseMembers(raw: unknown): IdeaSeoHubMember[] {
  if (!Array.isArray(raw)) return [];
  const out: IdeaSeoHubMember[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const rec = m as Record<string, unknown>;
    const contentType = str(rec.contentType ?? rec.content_type);
    const slug = str(rec.slug);
    if (!contentType || !slug) continue;
    const key = `${contentType}/${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ contentType, slug });
  }
  return out;
}

function parseCluster(raw: unknown): IdeaSeoCluster | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const mode = str(rec.mode);
  if (mode === "join") {
    const pillar_path = str(rec.pillar_path);
    return pillar_path ? { mode, pillar_path } : null;
  }
  if (mode === "hub") {
    return { mode, members: parseMembers(rec.members) };
  }
  if (mode === "standalone") {
    return { mode, reason: str(rec.reason) };
  }
  return null;
}

type MetricField = "kw_monthly_volume" | "kw_difficulty";

/** Integer metric; missing/empty → null; anything else unparseable → "invalid". */
function parseMetric(v: unknown, field: MetricField): number | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
  if (!Number.isInteger(n) || n < 0) return "invalid";
  if (field === "kw_difficulty" && n > 100) return "invalid";
  return n;
}

function withMetrics(
  base: { main_keyword: string; cluster: IdeaSeoCluster },
  volume: number | null,
  difficulty: number | null,
): IdeaSeoTarget {
  const out: IdeaSeoTarget = { ...base };
  if (volume != null) out.kw_monthly_volume = volume;
  if (difficulty != null) out.kw_difficulty = difficulty;
  return out;
}

/** Lenient read of a stored target (null when unusable; bad metrics are dropped). */
export function parseIdeaSeoTarget(raw: unknown): IdeaSeoTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const main_keyword = str(rec.main_keyword);
  const cluster = parseCluster(rec.cluster);
  if (!main_keyword || !cluster) return null;
  const vol = parseMetric(rec.kw_monthly_volume, "kw_monthly_volume");
  const kd = parseMetric(rec.kw_difficulty, "kw_difficulty");
  return withMetrics(
    { main_keyword, cluster },
    vol === "invalid" ? null : vol,
    kd === "invalid" ? null : kd,
  );
}

export function ideaSeoTargetHasMetrics(t: IdeaSeoTarget | null | undefined): boolean {
  return t?.kw_monthly_volume != null && t?.kw_difficulty != null;
}

export type IdeaSeoTargetValidation =
  | { ok: true; target: IdeaSeoTarget }
  | { ok: false; code: string; error: string };

/**
 * Validate shape for storage. Pass `demandLabel` when known to enforce the
 * standalone rule early (accept always enforces it).
 */
export function validateIdeaSeoTarget(
  raw: unknown,
  opts?: { demandLabel?: string | null; enforceDemand?: boolean },
): IdeaSeoTargetValidation {
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      code: IDEA_SEO_TARGET_INCOMPLETE,
      error:
        'idea_seo_target requires main_keyword and cluster ({ mode: "join", pillar_path } | { mode: "hub", members: [{ contentType, slug }] } | { mode: "standalone", reason }).',
    };
  }
  const rec = raw as Record<string, unknown>;
  const main_keyword = str(rec.main_keyword);
  if (!main_keyword) {
    return {
      ok: false,
      code: IDEA_SEO_TARGET_INCOMPLETE,
      error: "idea_seo_target.main_keyword is required (the exact search phrase this page should win).",
    };
  }
  const clusterRaw = rec.cluster as Record<string, unknown> | undefined;
  const mode = clusterRaw && typeof clusterRaw === "object" ? str(clusterRaw.mode) : "";
  if (mode !== "join" && mode !== "hub" && mode !== "standalone") {
    return {
      ok: false,
      code: IDEA_SEO_TARGET_INCOMPLETE,
      error: 'idea_seo_target.cluster.mode must be "join", "hub", or "standalone".',
    };
  }
  const cluster = parseCluster(clusterRaw)!;
  if (mode === "join" && !cluster) {
    return {
      ok: false,
      code: IDEA_SEO_TARGET_INCOMPLETE,
      error: "idea_seo_target.cluster.pillar_path is required for mode join (public path of a live hub, same locale).",
    };
  }
  if (cluster.mode === "join" && !cluster.pillar_path.startsWith("/")) {
    return {
      ok: false,
      code: IDEA_SEO_TARGET_INCOMPLETE,
      error: "idea_seo_target.cluster.pillar_path must be a public path starting with / (e.g. /en/blog/ai-tools/hub-ai-tools).",
    };
  }
  if (cluster.mode === "hub" && cluster.members.length === 0) {
    return {
      ok: false,
      code: IDEA_SEO_TARGET_HUB_MEMBERS_REQUIRED,
      error:
        "idea_seo_target.cluster.members must name at least one existing live post ({ contentType, slug }) that will join this new hub.",
    };
  }
  if (cluster.mode === "standalone") {
    if (cluster.reason.length < SEO_REASON_MIN) {
      return {
        ok: false,
        code: IDEA_SEO_TARGET_INCOMPLETE,
        error: `idea_seo_target.cluster.reason must explain why this page stays out of every cluster (min ${SEO_REASON_MIN} chars).`,
      };
    }
    if (opts?.enforceDemand && !standaloneAllowedForDemand(opts.demandLabel)) {
      return standaloneNotAllowed(opts.demandLabel);
    }
  }
  const vol = parseMetric(rec.kw_monthly_volume, "kw_monthly_volume");
  if (vol === "invalid") {
    return {
      ok: false,
      code: IDEA_SEO_TARGET_INCOMPLETE,
      error: "idea_seo_target.kw_monthly_volume must be a whole number >= 0 (monthly searches for main_keyword).",
    };
  }
  const kd = parseMetric(rec.kw_difficulty, "kw_difficulty");
  if (kd === "invalid") {
    return {
      ok: false,
      code: IDEA_SEO_TARGET_INCOMPLETE,
      error: "idea_seo_target.kw_difficulty must be a whole number from 0 to 100.",
    };
  }
  return { ok: true, target: withMetrics({ main_keyword, cluster }, vol, kd) };
}

export function standaloneNotAllowed(label: string | null | undefined): {
  ok: false;
  code: string;
  error: string;
} {
  return {
    ok: false,
    code: IDEA_SEO_TARGET_STANDALONE_NOT_ALLOWED,
    error:
      `Standalone (no cluster) is only allowed for ideas labeled ${STANDALONE_DEMAND_LABELS.join(" or ")}` +
      ` (this idea: ${label ?? "no demand label"}). Join a live hub or make this page a hub with named members.`,
  };
}

export function ideaSeoTargetComplete(target: IdeaSeoTarget | null | undefined): boolean {
  return target != null && validateIdeaSeoTarget(target).ok;
}

export function ideaSeoTargetsEqual(a: IdeaSeoTarget, b: IdeaSeoTarget): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(t: IdeaSeoTarget): unknown {
  const m = { v: t.kw_monthly_volume ?? null, d: t.kw_difficulty ?? null };
  if (t.cluster.mode === "hub") {
    const members = [...t.cluster.members]
      .map((m) => `${m.contentType}/${m.slug}`)
      .sort();
    return { k: t.main_keyword, mode: "hub", members, m };
  }
  if (t.cluster.mode === "join") {
    return { k: t.main_keyword, mode: "join", p: normalizePath(t.cluster.pillar_path), m };
  }
  return { k: t.main_keyword, mode: "standalone", r: t.cluster.reason, m };
}

export function normalizePath(p: string): string {
  const trimmed = p.trim();
  if (trimmed.length > 1 && trimmed.endsWith("/")) return trimmed.slice(0, -1);
  return trimmed;
}

/**
 * Seed block for the new page's draft `seo:`. Hub mode needs the page's own path
 * (pass `selfPath` when known); validateSeoSave re-derives it on later writes.
 */
export function seoBlockFromTarget(
  target: IdeaSeoTarget,
  opts?: { selfPath?: string | null; resolvedPillarPath?: string | null },
): Record<string, unknown> {
  const block: Record<string, unknown> = { main_keyword: target.main_keyword };
  if (target.cluster.mode === "join") {
    block.pillar_path = opts?.resolvedPillarPath ?? target.cluster.pillar_path;
    block.is_pillar = false;
  } else if (target.cluster.mode === "hub") {
    block.is_pillar = true;
    if (opts?.selfPath) block.pillar_path = opts.selfPath;
  } else {
    block.pillar_path = null;
    block.is_pillar = false;
  }
  return block;
}

type OpLike = { field_path: string; value?: unknown; reset?: boolean };

const SEO_TARGET_PATHS = new Set(["seo.main_keyword", "seo.pillar_path", "seo.pillar", "seo.is_pillar"]);

export function hasSeoTargetFieldOps(ops: readonly OpLike[]): boolean {
  return ops.some((op) => SEO_TARGET_PATHS.has(op.field_path?.trim() ?? ""));
}

export type ProposedSeo = {
  main_keyword?: string;
  pillar_path?: string | null;
  is_pillar?: boolean;
};

export function proposedSeoFromOps(ops: readonly OpLike[]): ProposedSeo {
  const out: ProposedSeo = {};
  for (const op of ops) {
    const p = op.field_path?.trim() ?? "";
    const value = op.reset ? null : op.value;
    if (p === "seo.main_keyword") out.main_keyword = typeof value === "string" ? value.trim() : "";
    if (p === "seo.pillar_path" || p === "seo.pillar") {
      out.pillar_path = typeof value === "string" ? value.trim() : null;
    }
    if (p === "seo.is_pillar") out.is_pillar = value === true || value === "true";
  }
  return out;
}

export type SeoTargetDiff = {
  differs: boolean;
  /** Which target facets differ: keyword and/or cluster. */
  fields: Array<"main_keyword" | "cluster">;
  /** Cluster mode the ops propose (null when ops do not touch the cluster). */
  proposed_mode: IdeaSeoCluster["mode"] | null;
  proposed: ProposedSeo;
};

/** Compare seo.* ops against a locked target. Untouched facets never differ. */
export function seoTargetDiff(ops: readonly OpLike[], locked: IdeaSeoTarget): SeoTargetDiff {
  const proposed = proposedSeoFromOps(ops);
  const fields: SeoTargetDiff["fields"] = [];
  if (proposed.main_keyword !== undefined && proposed.main_keyword !== locked.main_keyword) {
    fields.push("main_keyword");
  }
  let proposed_mode: SeoTargetDiff["proposed_mode"] = null;
  if (proposed.is_pillar === true) proposed_mode = "hub";
  else if (proposed.pillar_path === null) proposed_mode = "standalone";
  else if (typeof proposed.pillar_path === "string" && proposed.pillar_path) proposed_mode = "join";
  if (proposed_mode) {
    const lc = locked.cluster;
    const same =
      proposed_mode === lc.mode &&
      (lc.mode !== "join" ||
        normalizePath(proposed.pillar_path ?? "") === normalizePath(lc.pillar_path));
    if (!same) fields.push("cluster");
  }
  return { differs: fields.length > 0, fields, proposed_mode, proposed };
}

export function validateSeoTargetOverride(
  raw: unknown,
): { ok: true; override: SeoTargetOverride | null } | { ok: false; code: string; error: string } {
  if (raw == null) return { ok: true, override: null };
  const reason =
    typeof raw === "string" ? raw.trim() : raw && typeof raw === "object" ? str((raw as Record<string, unknown>).reason) : "";
  if (reason.length < SEO_REASON_MIN) {
    return {
      ok: false,
      code: SEO_TARGET_OVERRIDE_INVALID,
      error: `seo_target_override.reason must explain why the keyword/hub differs from the idea's locked target (min ${SEO_REASON_MIN} chars).`,
    };
  }
  return { ok: true, override: { reason } };
}

export function parseSeoTargetOverride(raw: unknown): SeoTargetOverride | null {
  const v = validateSeoTargetOverride(raw);
  return v.ok ? v.override : null;
}

function describeMetrics(t: IdeaSeoTarget): string {
  const vol = t.kw_monthly_volume != null ? `${t.kw_monthly_volume}/mo` : "volume not set";
  const kd = t.kw_difficulty != null ? `KD ${t.kw_difficulty}` : "difficulty not set";
  return ` (${vol}, ${kd})`;
}

/** Human one-liner for review surfaces and events. */
export function describeIdeaSeoTarget(t: IdeaSeoTarget): string {
  const c = t.cluster;
  const kw = `"${t.main_keyword}"${describeMetrics(t)}`;
  if (c.mode === "join") return `${kw} → joins ${c.pillar_path}`;
  if (c.mode === "hub") {
    return `${kw} → new hub with ${c.members.map((m) => `${m.contentType}/${m.slug}`).join(", ")}`;
  }
  return `${kw} → standalone (${c.reason})`;
}

export { IDEA_AUTHOR_SITUATION_IDS };
