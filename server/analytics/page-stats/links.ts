/**
 * Internal links for one page from the link index: pages that link here, and the page's own
 * links with their stage and how many visitors actually used them (GA4 next pages).
 */

import { getLinkIndexOutbound, getReferrersForTargetPath, normalizeReferrerTargetPath } from "../../link-index";
import { stageOfPath, type PathStageIndex } from "./resolve";
import { stageRank } from "@shared/page-objectives";
import type { FunnelStage } from "@shared/funnel";
import type { LinksFacts, PathRow, Section } from "@shared/page-stats";

export function buildPageLinks(opts: {
  contentRoot?: string;
  paths: string[];
  entryKeys: string[];
  stage: FunnelStage | null;
  index: PathStageIndex;
  nextPages: PathRow[] | null;
}): Section<LinksFacts> {
  try {
    const pathByKey = new Map<string, string>();
    for (const [p, info] of opts.index.byPath) pathByKey.set(info.key, p);

    const inboundKeys = new Set<string>();
    for (const p of opts.paths) {
      for (const r of getReferrersForTargetPath(p, opts.contentRoot, { limit: 200 }).referrers) {
        if (!opts.entryKeys.includes(r.entryKey)) inboundKeys.add(r.entryKey);
      }
    }
    const inbound = [...inboundKeys].sort().map((k) => ({ entry_key: k, path: pathByKey.get(k) ?? null }));

    const own = new Set(opts.paths.map(normalizeReferrerTargetPath));
    const sessionsByPath = new Map((opts.nextPages ?? []).map((r) => [normalizeReferrerTargetPath(r.path), r.sessions]));
    const outboundPaths = new Set<string>();
    for (const k of opts.entryKeys) {
      for (const p of getLinkIndexOutbound(k, opts.contentRoot) ?? []) {
        const norm = normalizeReferrerTargetPath(p);
        if (!own.has(norm)) outboundPaths.add(norm);
      }
    }
    const outbound = [...outboundPaths]
      .map((p) => ({ path: p, stage: stageOfPath(opts.index, p), sessions: sessionsByPath.get(p) ?? 0 }))
      .sort((a, b) => b.sessions - a.sessions || a.path.localeCompare(b.path));

    const rank = stageRank(opts.stage);
    const no_next_stage_link =
      (rank === 1 || rank === 2) && outbound.length > 0 && !outbound.some((o) => stageRank(o.stage) > rank);

    return {
      status: "ok",
      as_of: null,
      data: { inbound: inbound.slice(0, 50), inbound_count: inbound.length, outbound: outbound.slice(0, 60), no_next_stage_link },
    };
  } catch (err) {
    return { status: "error", as_of: null, message: err instanceof Error ? err.message : String(err), data: null };
  }
}
