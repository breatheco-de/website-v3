#!/usr/bin/env tsx
/**
 * @migration 008_pause_ab_tests
 * @description Pauses every page test: all variant traffic goes to 0%, so visitors see the
 *   live page. Page tests are switched off until A/B testing is set up in Settings → A/B testing;
 *   without this step, finishing setup would restart old tests at their old splits. Variants and
 *   their content are kept; staff restart the tests they want from the traffic editor. The hidden
 *   A/B check page is not touched. versioning.yml files are pushed to the content repo.
 * @scope site
 * @dry-run
 * @production-only
 *
 * Steps:
 *   1. Every versioning.yml in the site: each variant allocation becomes 0 (other keys kept).
 *   2. Pushes the changed files and prints the commitSha. Recovery: versioning.yml files changed by
 *      an earlier run but not pushed are pushed first.
 * Exits non-zero when a push fails, so the run is never recorded as completed.
 * Idempotent: a second run finds nothing to do.
 *
 * Usage: MIGRATION_SITE=site_4geeks-com npx tsx scripts/migrations/008_pause_ab_tests.ts [--dry-run]
 *        (without MIGRATION_SITE every site runs)
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const dryRun = process.argv.includes("--dry-run");
const site = process.env.MIGRATION_SITE?.trim() || undefined;

console.log(dryRun ? "DRY RUN: nothing is written or pushed." : "APPLY");
const { runPauseAbTestsMigration } = await import("../../server/ab-testing/pause-migration");
const { failed, changed } = await runPauseAbTestsMigration({ site, dryRun });
console.log("tests_paused", changed);
process.exit(failed ? 1 : 0);
