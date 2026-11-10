/**
 * Facts about one draft/A-B variant (age, last edit, proposal, tests, drift, changes vs
 * live) plus the shared verdict. Feeds the Versions panel info popover and MCP
 * list_variants / delete_variant. Read-only.
 */

import fs from "fs";
import path from "path";
import { normalizeFlexibleDate } from "@shared/normalizeFlexibleDate";
import { isTemplateVersioningSlug } from "@shared/sharedLayoutPaths";
import {
  VARIANT_STALE_DAYS,
  contentChangePaths,
  variantVerdict,
  type VariantFacts,
  type VariantHealth,
  type VariantProposalFact,
  type VariantTestFact,
  type VariantVerdict,
} from "@shared/variant-health";
import { RESERVED_UPDATED_AT_FIELD, UPDATED_AT_ALIAS_FIELD } from "../content-types";
import { countVariantFiles, hasAnyLiveLocale } from "../draft-entry";
import { isLiveServer } from "../live-server";
import { authorDiff, computeDraftDrift, draftPathOf, livePathOf, type DraftRef } from "./draft-base";
import { getDraftActivity } from "./draft-activity";
import { readDraftMeta, readVariantData, type DraftBasedOn } from "./draft-meta";
import type { TestRun } from "./test-runs";

const DAY_MS = 86_400_000;

function isoOrNull(ms: number | null | undefined): string | null {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

type LocaleConfig = { variants?: Array<{ slug: string; allocation?: number }>; started_at?: string };

/** What variant-info needs from VersioningManager (kept narrow for tests). */
export interface VariantInfoVersioning {
  getVersioningContentDir(contentType: string, slug: string): string;
  getRuns(contentType: string, slug: string, locale: string): Array<TestRun & { experiment_id: string }>;
  hasRunHistory(): boolean;
}

/** Open proposal on this page, from the local proposals DB. */
export interface OpenProposalRow {
  id: string;
  title: string;
  status: string;
  locale: string;
  variant: string | null;
  proposer_username: string;
  proposer_kind: "agent" | "staff";
}

export interface VariantInfoContext {
  contentType: string;
  /** Versioning slug (entry slug, or the shared template slug). */
  slug: string;
  contentRoot: string;
  versioning: Record<string, LocaleConfig> | null;
  vm: VariantInfoVersioning;
  /** Open proposals on this page; null when the proposals DB could not be read. */
  openProposals: OpenProposalRow[] | null;
  /** Env tag stamped on `_draft.proposal` links created by this deployment's proposals. */
  proposalEnv: string;
  locales: string[];
  onLiveServer?: boolean;
  now?: number;
}

export interface VariantSiblingInfo {
  locale: string;
  updated_at: string | null;
  verdict: VariantVerdict;
}

export interface VariantInfo {
  locale: string;
  slug: string;
  /** Repo-relative variant file name (e.g. `draft.en.yml`). */
  file: string;
  allocation: number;
  facts: VariantFacts;
  health: VariantHealth;
  proposal: {
    id: string;
    title?: string;
    status?: string;
    proposer_username?: string;
    proposer_kind?: "agent" | "staff";
  } | null;
  siblings: VariantSiblingInfo[];
  /** Full mode only (popover "Read more"). */
  details?: {
    changed_fields: string[];
    live_changed_fields?: string[];
    based_on: DraftBasedOn | null;
    stale_days: number;
  };
}

/** Context for one page: open proposals from the local proposals DB plus the page's versioning. */
export async function buildVariantInfoContext(opts: {
  contentType: string;
  slug: string;
  contentRoot: string;
  contentRootName: string;
  versioning: Record<string, LocaleConfig> | null;
  vm: VariantInfoVersioning;
  locales: string[];
}): Promise<VariantInfoContext> {
  let openProposals: OpenProposalRow[] | null = null;
  let proposalEnv = "production";
  try {
    const mod = await import("../content-proposals");
    proposalEnv = mod.DRAFT_LINK_ENV;
    openProposals = isTemplateVersioningSlug(opts.slug)
      ? []
      : mod.listOpenProposalsForEntry(opts.contentRootName, opts.contentType, opts.slug);
  } catch {
    openProposals = null;
  }
  return {
    contentType: opts.contentType,
    slug: opts.slug,
    contentRoot: opts.contentRoot,
    versioning: opts.versioning,
    vm: opts.vm,
    openProposals,
    proposalEnv,
    locales: opts.locales,
  };
}

function allocationOf(cfg: LocaleConfig | undefined, variant: string): number {
  const v = cfg?.variants?.find((x) => x.slug === variant);
  return Number(v?.allocation ?? 0) || 0;
}

function updatedAtOf(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  return normalizeFlexibleDate(data[RESERVED_UPDATED_AT_FIELD] ?? data[UPDATED_AT_ALIAS_FIELD]);
}

function testFact(ctx: VariantInfoContext, locale: string, variant: string, now: number): VariantTestFact {
  const all = ctx.vm.getRuns(ctx.contentType, ctx.slug, locale);
  const mine = all.filter((r) => r.versions.includes(variant));
  const running = mine.find((r) => !r.ended_at);
  if (running) {
    return { state: "running", experiment_id: running.experiment_id, started_at: running.started_at, ended_at: null };
  }
  const last = mine[0];
  if (last) {
    const endedMs = Date.parse(last.ended_at ?? "");
    const recent = !Number.isNaN(endedMs) && now - endedMs < VARIANT_STALE_DAYS * DAY_MS;
    return {
      state: recent ? "ended_recently" : "ended_long_ago",
      experiment_id: last.experiment_id,
      started_at: last.started_at,
      ended_at: last.ended_at,
    };
  }
  // A test start date on the page but no recorded run: history predates run tracking or was lost.
  const startedWithoutRun = Boolean(ctx.versioning?.[locale]?.started_at) && all.length === 0;
  if (!ctx.vm.hasRunHistory() || startedWithoutRun) return { state: "unknown" };
  return { state: "never" };
}

function proposalFact(
  ctx: VariantInfoContext,
  locale: string,
  variant: string,
  filePath: string,
  onLive: boolean,
): { fact: VariantProposalFact; badge: VariantInfo["proposal"] } {
  const link = readDraftMeta(filePath)?.proposal ?? null;
  const open = ctx.openProposals ?? [];
  const hit = link
    ? open.find((p) => p.id === link.id) ?? null
    : open.find((p) => p.locale === locale && p.variant === variant) ?? null;
  if (hit) {
    return {
      fact: { state: "open", title: hit.title, status: hit.status, proposer: hit.proposer_username },
      badge: {
        id: hit.id,
        title: hit.title,
        status: hit.status,
        proposer_username: hit.proposer_username,
        proposer_kind: hit.proposer_kind,
      },
    };
  }
  if (!link) return { fact: { state: "none" }, badge: null };
  const badge = { id: link.id };
  if (link.orphan_since) return { fact: { state: "orphan", orphan_since: link.orphan_since }, badge };
  if (link.unverified_since) return { fact: { state: "unverified" }, badge };
  // Only the deployment that owns the proposal can say it is closed; elsewhere we can't check.
  const checkable = onLive && link.env === ctx.proposalEnv && ctx.openProposals !== null;
  return { fact: { state: checkable ? "closed" : "unverified" }, badge };
}

function relFile(filePath: string): string {
  return path.basename(filePath);
}

/**
 * Gather facts and verdict for one variant file. `full` adds field names (diff, live
 * changes since the base); `siblings: false` skips the other-locale lookup.
 */
export function getVariantInfo(
  ctx: VariantInfoContext,
  locale: string,
  variant: string,
  opts: { full?: boolean; siblings?: boolean } = {},
): VariantInfo | null {
  const now = ctx.now ?? Date.now();
  const onLive = ctx.onLiveServer ?? isLiveServer();
  const templateMode = isTemplateVersioningSlug(ctx.slug);
  const ref: DraftRef = { contentType: ctx.contentType, slug: ctx.slug, locale, variant, contentRoot: ctx.contentRoot };
  const filePath = draftPathOf(ref);
  if (!fs.existsSync(filePath)) return null;

  const meta = readDraftMeta(filePath);
  const data = readVariantData(filePath);
  const hasLive = fs.existsSync(livePathOf(ref));
  const activity = templateMode ? null : getDraftActivity(ref);

  let changedFields: string[] = [];
  if (hasLive) {
    try {
      changedFields = contentChangePaths((authorDiff(ref)?.changes ?? []).map((c) => c.field_path));
    } catch {
      changedFields = [];
    }
  }
  let drift: ReturnType<typeof computeDraftDrift> = { behind: false, source_changed: false };
  try {
    drift = computeDraftDrift(ref, { full: opts.full });
  } catch {
    /* drift is advisory */
  }

  const contentDir = ctx.vm.getVersioningContentDir(ctx.contentType, ctx.slug);
  const isLastDraftOfUnpublished =
    !templateMode && !hasAnyLiveLocale(contentDir, false, ctx.locales) && countVariantFiles(contentDir, false) <= 1;

  const cfg = ctx.versioning?.[locale];
  const allocation = allocationOf(cfg, variant);
  const proposal = proposalFact(ctx, locale, variant, filePath, onLive);

  const facts: VariantFacts = {
    allocation,
    created_at: meta?.created_at ?? null,
    based_on_at: meta?.based_on?.at || null,
    updated_at: updatedAtOf(data),
    proposal: proposal.fact,
    test: testFact(ctx, locale, variant, now),
    on_live_server: onLive,
    has_live: hasLive,
    changes_vs_live: hasLive ? changedFields.length : null,
    behind_live: drift.behind,
    behind_since: drift.since ?? null,
    is_last_draft_of_unpublished: isLastDraftOfUnpublished,
    translated_from: meta?.translated_from?.locale ?? null,
    kept_at: meta?.kept_at ?? null,
    content_changed_at: isoOrNull(activity?.changed_at),
    first_seen_at: isoOrNull(activity?.first_seen_at),
    cleanup: meta?.cleanup ?? null,
  };
  const health = variantVerdict(facts, now);

  const siblings: VariantSiblingInfo[] = [];
  if (opts.siblings !== false) {
    for (const other of ctx.locales) {
      if (other === locale) continue;
      const sib = getVariantInfo(ctx, other, variant, { siblings: false });
      if (sib) siblings.push({ locale: other, updated_at: sib.facts.updated_at, verdict: sib.health.verdict });
    }
  }

  return {
    locale,
    slug: variant,
    file: relFile(filePath),
    allocation,
    facts,
    health,
    proposal: proposal.badge,
    siblings,
    ...(opts.full
      ? {
          details: {
            changed_fields: changedFields,
            ...(drift.changed_fields ? { live_changed_fields: contentChangePaths(drift.changed_fields) } : {}),
            based_on: meta?.based_on ?? null,
            stale_days: VARIANT_STALE_DAYS,
          },
        }
      : {}),
  };
}

/** Cheap info for every variant listed in versioning.yml: `{ locale: { slug: info } }`. */
export function getVariantInfoMap(ctx: VariantInfoContext): Record<string, Record<string, VariantInfo>> {
  const out: Record<string, Record<string, VariantInfo>> = {};
  for (const [locale, cfg] of Object.entries(ctx.versioning ?? {})) {
    for (const v of cfg?.variants ?? []) {
      const info = getVariantInfo(ctx, locale, v.slug);
      if (info) (out[locale] ??= {})[v.slug] = info;
    }
  }
  return out;
}
