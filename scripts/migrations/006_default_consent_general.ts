#!/usr/bin/env tsx
/**
 * @migration 006_default_consent_general
 * @description Makes sure every lead form has at least one checkbox visitors must tick. Sites
 *   without a Default consent get General as their Default (it appears only on forms that have no
 *   mandatory checkbox of their own). 4Geeks Florida also gets the request_downloadable conversion
 *   event, copied exactly from 4geeks.com, because some Florida forms already use that name. Pages
 *   are not edited. Run this before deploying the mandatory-consent update. settings.yml is pushed
 *   to the content repo.
 * @scope site
 * @dry-run
 * @production-only
 *
 * Steps:
 *   1. No valid consent.fallback: set it to consent_general (text edit, formatting kept).
 *   2. 4Geeks Florida only: copy the request_downloadable entry from 4geeks.com's settings.yml into
 *      tracking.conversion_events. Fails without writing if 4geeks.com has no such entry.
 *   3. Each result is parsed again and compared with the expected settings; any difference blocks
 *      the site and nothing is written.
 *   4. Pushes settings.yml and prints the commitSha. Recovery: a settings.yml changed by an earlier
 *      run but not pushed is pushed first.
 * Exits non-zero when a site is blocked or a push fails, so the run is never recorded as completed.
 * Idempotent: a second run finds nothing to do.
 *
 * Usage: MIGRATION_SITE=site_4geeks-florida npx tsx scripts/migrations/006_default_consent_general.ts [--dry-run]
 *        (without MIGRATION_SITE every site runs)
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const dryRun = process.argv.includes("--dry-run");
const site = process.env.MIGRATION_SITE?.trim() || undefined;

console.log(dryRun ? "DRY RUN: nothing is written or pushed." : "APPLY");
const { runDefaultConsentMigration } = await import("../../server/default-consent-migration");
const { failed } = await runDefaultConsentMigration({ site, dryRun });
process.exit(failed ? 1 : 0);
