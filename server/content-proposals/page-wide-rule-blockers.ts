/**
 * One-time cleanup (migration 011): resolve blockers filed under the retired "reviewers never apply
 * a proposal that writes _common.yml" rule, on proposals whose page-level changes the author asked for.
 * Blockers about lost live values (display_values_change) and proposals with unrequested page-level
 * fields or a detached change stay open. Nothing is applied, drafts are untouched.
 */

import type Database from "better-sqlite3";
import { fieldScope } from "@shared/field-scope";
import { isDetachedFieldPath } from "./page-wide-apply-codes";
import type { ProposalEntryRow } from "./service";

export const OLD_RULE_RESOLVER = "migration:011_clear_page_wide_rule_blockers";
export const OLD_RULE_RESOLVE_NOTE =
  "Old blanket rule retired: reviewer agents may approve page-wide changes the author asked for. Re-review the proposal before apply.";

type Log = (...args: unknown[]) => void;

export type OldRuleBlockerRow = {
  blocker_id: number;
  proposal_id: string;
  title: string;
  body: string;
};

/** STAFF FIX blocker whose only reason is the retired rule (not a lost-value case). */
export function citesOldPageWideRule(body: string): boolean {
  const text = (body ?? "").trim();
  if (!/^STAFF FIX/i.test(text)) return false;
  if (!text.includes("_common")) return false;
  if (/display_values_change/i.test(text)) return false;
  return /standing rule|not allowed|may not|must not/i.test(text);
}

/** Every pending entry's page-level changes were requested, and none touches `detached`. */
export function onlyRequestedPageFields(
  entries: Array<Pick<ProposalEntryRow, "status" | "author_diff" | "unrequested_fields" | "draft_missing">>,
): boolean {
  const pending = entries.filter((e) => e.status === "pending" || e.status === "failed");
  if (!pending.length) return false;
  return pending.every((e) => {
    if (e.draft_missing || !e.author_diff) return false;
    if (e.author_diff.some((c) => isDetachedFieldPath(c.field_path))) return false;
    return !(e.unrequested_fields ?? []).some((p) => fieldScope(p) === "common");
  });
}

export function selectOldRuleBlockers(db: Database.Database, site: string): OldRuleBlockerRow[] {
  const rows = db
    .prepare(
      `SELECT b.id AS blocker_id, b.proposal_id, p.title, b.body
       FROM content_proposal_blockers b
       INNER JOIN content_proposals p ON p.id = b.proposal_id
       WHERE p.site = ? AND p.status IN ('open', 'partial') AND p.kind = 'edits'
         AND p.system_version IS NOT NULL AND b.status = 'open'
       ORDER BY b.id`,
    )
    .all(site) as OldRuleBlockerRow[];
  return rows.filter((r) => citesOldPageWideRule(r.body));
}

export async function runClearPageWideRuleBlockers(opts: {
  site?: string;
  dryRun: boolean;
  log?: Log;
  error?: Log;
}): Promise<{ failed: boolean }> {
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const { getSiteContextMap } = await import("../site-manager");
  const { ensurePipelineDb } = await import("../pipeline-db/runner");
  const { getSiteSqlite } = await import("../db");
  const { proposalServiceForSite } = await import("./service");

  let failed = false;
  let matched = false;
  for (const ctx of Array.from(getSiteContextMap().values())) {
    const site = ctx.contentRootName;
    if (opts.site && site !== opts.site) continue;
    matched = true;
    ensurePipelineDb(site);
    log("site", site);
    const svc = proposalServiceForSite(ctx);
    const byProposal = new Map<string, OldRuleBlockerRow[]>();
    for (const row of selectOldRuleBlockers(getSiteSqlite(site), site)) {
      const list = byProposal.get(row.proposal_id) ?? [];
      list.push(row);
      byProposal.set(row.proposal_id, list);
    }
    let resolvedCount = 0;
    for (const [proposalId, rows] of Array.from(byProposal.entries())) {
      const proposal = svc.get(proposalId);
      if (!proposal) continue;
      if (!onlyRequestedPageFields(proposal.entries)) {
        log("skip", { proposal_id: proposalId, title: rows[0]!.title, reason: "unrequested page-wide fields, a detached change, or a missing draft" });
        continue;
      }
      const ids = rows.map((r) => r.blocker_id);
      log(opts.dryRun ? "would_resolve" : "resolve", { proposal_id: proposalId, title: rows[0]!.title, blocker_ids: ids });
      if (opts.dryRun) continue;
      const resolved = svc.resolveBlockersBySystem(proposalId, ids, {
        author: OLD_RULE_RESOLVER,
        note: OLD_RULE_RESOLVE_NOTE,
      });
      resolvedCount += resolved.length;
      if (resolved.length !== ids.length) {
        failed = true;
        error("not_all_resolved", { proposal_id: proposalId, expected: ids, resolved });
      }
    }
    log("report", { site, proposals: byProposal.size, resolved: resolvedCount });
  }
  if (opts.site && !matched) {
    error("unknown_site", opts.site);
    failed = true;
  }
  return { failed };
}
