/**
 * Daily cleanup of abandoned drafts that are not linked to a proposal (live server only).
 * Rules live in shared/variant-health.ts (`draftCleanupDecision`); this module gathers the
 * facts, records content changes in `draft_activity`, and flags, clears or deletes.
 * Proposal-linked drafts belong to the proposal sweeps (`verifyDraftLinks`).
 */

import path from "path";
import { draftCleanupDecision, type DraftCleanupReason } from "@shared/variant-health";
import { relFromCwd, resolveRoot, writeDraftMeta, type DraftProposalLink } from "./draft-meta";
import { draftPathOf, type DraftRef } from "./draft-base";
import { observeDraftContent } from "./draft-activity";
import { getVariantInfo, type VariantInfoContext } from "./variant-info";
import type { EventType } from "../events/types";

export const DRAFT_CLEANUP_AUTHOR = "system:draft-cleanup";

type Ref = { contentType: string; slug: string; locale: string; variant: string };

export interface DraftCleanupDeps {
  contentRoot: string;
  listDrafts(): Array<{ ref: Ref; link: DraftProposalLink | null }>;
  /** Variant-info context for one page (versioning, open proposals, test runs). */
  infoContext(contentType: string, slug: string): Promise<VariantInfoContext>;
  remove(ref: Ref, author: string): Promise<{ entryDeleted: boolean }>;
  emit(type: EventType, ref: Ref, payload: Record<string, unknown>): void;
}

export interface DraftCleanupReport {
  checked: number;
  first_seen: number;
  flagged: string[];
  cleared: string[];
  deleted: string[];
  kept_by_reason: Partial<Record<DraftCleanupReason, number>>;
  errors: Array<{ draft: string; error: string }>;
}

function iso(ms: number | null | undefined): string | null {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export async function runDraftCleanup(
  deps: DraftCleanupDeps,
  opts: { now?: number; dryRun?: boolean } = {},
): Promise<DraftCleanupReport> {
  const now = opts.now ?? Date.now();
  const dryRun = opts.dryRun === true;
  const report: DraftCleanupReport = {
    checked: 0,
    first_seen: 0,
    flagged: [],
    cleared: [],
    deleted: [],
    kept_by_reason: {},
    errors: [],
  };
  const contexts = new Map<string, Promise<VariantInfoContext>>();
  const contextFor = (contentType: string, slug: string) => {
    const key = `${contentType}/${slug}`;
    let ctx = contexts.get(key);
    if (!ctx) {
      ctx = deps.infoContext(contentType, slug);
      contexts.set(key, ctx);
    }
    return ctx;
  };
  const writeOpts = (filePath: string) => ({
    author: DRAFT_CLEANUP_AUTHOR,
    contentRoot: deps.contentRoot,
    relPath: relFromCwd(filePath),
  });

  for (const { ref, link } of deps.listDrafts()) {
    if (link) continue;
    const draft = `${ref.contentType}/${ref.slug} ${ref.variant}.${ref.locale}`;
    const dref: DraftRef = { ...ref, contentRoot: deps.contentRoot };
    try {
      const seen = observeDraftContent(dref, now, { record: !dryRun });
      if (!seen) continue;
      report.checked++;
      if (seen.first_sighting) {
        report.first_seen++;
        continue;
      }
      const info = getVariantInfo({ ...(await contextFor(ref.contentType, ref.slug)), now }, ref.locale, ref.variant, {
        siblings: false,
      });
      if (!info) continue;
      const facts = {
        ...info.facts,
        content_changed_at: iso(seen.row.changed_at),
        first_seen_at: iso(seen.row.first_seen_at),
      };
      const decision = draftCleanupDecision(facts, now);
      const payload = (extra: Record<string, unknown> = {}) => ({
        variant: ref.variant,
        tier: decision.tier,
        last_activity_at: decision.last_activity_at,
        ...extra,
      });
      const filePath = draftPathOf(dref);

      switch (decision.action) {
        case "keep":
          report.kept_by_reason[decision.reason] = (report.kept_by_reason[decision.reason] ?? 0) + 1;
          break;
        case "flag": {
          report.flagged.push(draft);
          if (dryRun) break;
          const cleanup = { flagged_at: new Date(now).toISOString(), deletes_at: decision.deletes_at! };
          writeDraftMeta(filePath, { cleanup }, writeOpts(filePath));
          deps.emit("draft_cleanup_flagged", ref, payload({ deletes_at: cleanup.deletes_at }));
          break;
        }
        case "clear_flag": {
          report.cleared.push(draft);
          if (dryRun) break;
          const keptLast =
            !!facts.kept_at && (!facts.content_changed_at || Date.parse(facts.kept_at) >= Date.parse(facts.content_changed_at));
          const cause = decision.reason === "activity_since_flag" ? (keptLast ? "kept" : "edited") : decision.reason;
          writeDraftMeta(filePath, { cleanup: null }, writeOpts(filePath));
          deps.emit("draft_cleanup_flag_cleared", ref, payload({ cause }));
          break;
        }
        case "delete": {
          report.deleted.push(draft);
          if (dryRun) break;
          const { entryDeleted } = await deps.remove(ref, DRAFT_CLEANUP_AUTHOR);
          deps.emit(
            "draft_cleanup_deleted",
            ref,
            payload({
              file: path.relative(path.dirname(resolveRoot(deps.contentRoot)), filePath).replace(/\\/g, "/"),
              entry_deleted: entryDeleted,
            }),
          );
          break;
        }
      }
    } catch (err) {
      report.errors.push({ draft, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return report;
}

/** Production wiring for one site. */
export async function runDraftCleanupForSite(
  site: import("../site-manager").SiteContext,
  opts: { now?: number; dryRun?: boolean } = {},
): Promise<DraftCleanupReport> {
  const { draftStoreForSite } = await import("../content-proposals/draft-store");
  const { buildVariantInfoContext } = await import("./variant-info");
  const { getLocaleEntries } = await import("../settings");
  const { emitEvent } = await import("../events/event-store");
  const { systemJobAttribution } = await import("../events/types");
  const store = draftStoreForSite(site);
  const locales = getLocaleEntries(site.contentRoot).map((l) => l.code);
  const vm = site.versioningManager;
  return runDraftCleanup(
    {
      contentRoot: site.contentRoot,
      listDrafts: () => store.listDrafts!(),
      infoContext: (contentType, slug) =>
        buildVariantInfoContext({
          contentType,
          slug,
          contentRoot: site.contentRoot,
          contentRootName: site.contentRootName,
          versioning: vm.getVersioningForContent(contentType, slug),
          vm,
          locales,
        }),
      remove: (ref, author) => store.remove(ref, author),
      emit: (type, ref, payload) =>
        emitEvent({
          site: site.contentRootName,
          type,
          resource: { contentType: ref.contentType, slug: ref.slug, locale: ref.locale },
          attribution: systemJobAttribution("draft-cleanup"),
          payload,
        }),
    },
    opts,
  );
}
