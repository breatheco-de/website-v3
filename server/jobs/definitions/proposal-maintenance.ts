import { Job } from "sidequest";
import { child } from "../../logger";
import { enqueueJob } from "../queue";

const log = child({ module: "job:proposal-maintenance" });

const DAY_MS = 24 * 60 * 60 * 1000;

async function reschedule(jobType: string, delayMs = DAY_MS): Promise<void> {
  try {
    await enqueueJob(jobType, {}, { delayMs, uniqueKey: jobType, uniqueWithArgs: false });
  } catch (err) {
    log.warn({ err, jobType }, "[proposal-maintenance] reschedule failed");
  }
}

/**
 * Daily (self-rescheduling): stale_since / 10-day flag / 30-day abandoned_stale close, then
 * open blockers / 10-day flag / 30-day abandoned_blocked close, then applies_after dependents
 * still open DEPENDENT_OVERDUE_HOURS (48) after their predecessor finished (flag only).
 */
export class ProposalStaleSweepJob extends Job {
  async run(): Promise<{ ok: boolean }> {
    const { getSiteContextMap } = await import("../../site-manager");
    const { proposalServiceForSite } = await import("../../content-proposals/service");
    try {
      for (const ctx of Array.from(getSiteContextMap().values())) {
        const svc = proposalServiceForSite(ctx);
        const report = await svc.staleSweep();
        log.info({ site: ctx.contentRootName, ...report }, "[ProposalStaleSweepJob] done");
        const blocked = await svc.blockedSweep();
        log.info({ site: ctx.contentRootName, ...blocked }, "[ProposalStaleSweepJob] blocked sweep done");
        const overdue = svc.dependentOverdueSweep();
        log.info({ site: ctx.contentRootName, ...overdue }, "[ProposalStaleSweepJob] dependent overdue sweep done");
      }
    } finally {
      await reschedule("proposal_stale_sweep");
    }
    return { ok: true };
  }
}

/**
 * Daily (self-rescheduling), live server only: unlink / delete drafts whose proposal is missing
 * or closed. A laptop holds a test copy of proposals and never cleans drafts.
 */
export class DraftLinkCheckJob extends Job {
  async run(): Promise<{ ok: boolean }> {
    const { isLiveServer } = await import("../../live-server");
    if (!isLiveServer()) {
      log.info("[DraftLinkCheckJob] skipped: not the live server");
      return { ok: true };
    }
    const { getSiteContextMap } = await import("../../site-manager");
    const { proposalServiceForSite } = await import("../../content-proposals/service");
    try {
      for (const ctx of Array.from(getSiteContextMap().values())) {
        const report = await proposalServiceForSite(ctx).verifyDraftLinks();
        log.info({ site: ctx.contentRootName, ...report }, "[DraftLinkCheckJob] done");
      }
    } finally {
      await reschedule("draft_link_check");
    }
    return { ok: true };
  }
}

/** Startup: queue the daily jobs once (draft link check only on the live server). */
export async function scheduleProposalMaintenance(): Promise<void> {
  const { isLiveServer } = await import("../../live-server");
  await reschedule("proposal_stale_sweep", 10 * 60 * 1000);
  if (isLiveServer()) await reschedule("draft_link_check", 15 * 60 * 1000);
}
