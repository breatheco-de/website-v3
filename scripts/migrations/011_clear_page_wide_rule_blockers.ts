#!/usr/bin/env tsx
/**
 * @migration 011_clear_page_wide_rule_blockers
 * @description Clears "needs a staff fix" notes that review agents added only because a change
 *   applies to every language of a page (for example who the page targets). Those changes can now
 *   be approved normally. Affected proposals go back to the review queue; nothing is published and
 *   no page changes. Notes about values a publish would remove stay open.
 * @scope site
 * @dry-run
 *
 * Only open notes starting with "STAFF FIX" that cite the old rule, on open or partly published
 * edit proposals whose page-wide changes were all requested by the author (no detached change).
 * Idempotent: resolved notes are not picked again. Exits non-zero when a note could not be resolved.
 *
 * Usage: MIGRATION_SITE=site_4geeks-com npx tsx scripts/migrations/011_clear_page_wide_rule_blockers.ts [--dry-run]
 *        (without MIGRATION_SITE every site runs)
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const dryRun = process.argv.includes("--dry-run");
const site = process.env.MIGRATION_SITE?.trim() || undefined;

console.log(dryRun ? "DRY RUN: nothing is written." : "APPLY");
const { runClearPageWideRuleBlockers } = await import("../../server/content-proposals/page-wide-rule-blockers");
const { failed } = await runClearPageWideRuleBlockers({ site, dryRun });
process.exit(failed ? 1 : 0);
