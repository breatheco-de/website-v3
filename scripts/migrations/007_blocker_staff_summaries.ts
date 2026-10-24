#!/usr/bin/env tsx
/**
 * @migration 007_blocker_staff_summaries
 * @description Writes a plain-English version of older "needs changes" notes on open proposals, so
 *   staff no longer read text written for agents. Only notes that have no plain version yet, on
 *   proposals still open or partly published. The original technical text is kept as is.
 * @scope site
 * @dry-run
 * @timeout 900
 *
 * Uses the configured AI model. Each rewrite must pass the same plain-English check new blockers
 * face; a rewrite that fails twice is left out and the run exits non-zero, so it is not recorded
 * as completed. Idempotent: a re-run only picks up blockers still missing a staff version.
 *
 * Usage: MIGRATION_SITE=site_4geeks-com npx tsx scripts/migrations/007_blocker_staff_summaries.ts [--dry-run]
 *        (without MIGRATION_SITE every site runs)
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const dryRun = process.argv.includes("--dry-run");
const site = process.env.MIGRATION_SITE?.trim() || undefined;

console.log(dryRun ? "DRY RUN: nothing is written." : "APPLY");
const { runBlockerStaffSummaryBackfill } = await import("../../server/content-proposals/blocker-staff-summary-backfill");
const { failed } = await runBlockerStaffSummaryBackfill({ site, dryRun });
process.exit(failed ? 1 : 0);
