#!/usr/bin/env tsx
/**
 * @migration 013_workshops_breathecode_ago
 * @description Workshop pages stop using a 12-month rule built into the site. The workshops
 *   database instead asks Breathecode for "upcoming plus the last 12 months" (the ago filter), so
 *   older workshops are never downloaded and their pages 404. Staff can change the window later in
 *   the workshops database's request params. Before changing anything it checks the live Breathecode
 *   API: if ago is not deployed yet, or would drop upcoming workshops, it stops and changes nothing.
 *   Run it after Breathecode ships ago. Changed files are pushed to the content repo.
 * @scope site
 * @dry-run
 * @production-only
 * @timeout 300
 *
 * Steps:
 *   1. Check: ago=-1 must answer 400; the ago window must contain every upcoming workshop and
 *      nothing that ended before the window. Any failure stops the site with nothing written.
 *   2. db/workshops/config.yml: `all_time` is removed and `ago: '31536000000'` (365 days) is added.
 *   3. The workshops database is fetched again with the new params, so the stored copy holds only
 *      the window before the page rule goes away.
 *   4. content-types.yml: the workshop `is_recent` field, its page filter and editor hint are
 *      removed; the strategy note now points at the database window.
 *   5. Changed files are pushed in one commit and the commitSha is printed. Recovery: files an
 *      earlier run wrote but did not push are pushed first.
 * Exits non-zero when the check fails, the refresh fails, or a push fails or returns no SHA.
 * Idempotent: a second run finds the database already on ago and no is_recent rule.
 *
 * Usage: MIGRATION_SITE=site_4geeks-com npx tsx scripts/migrations/013_workshops_breathecode_ago.ts [--dry-run]
 *        (without MIGRATION_SITE every site runs; sites without their own workshops database are skipped)
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const dryRun = process.argv.includes("--dry-run");
const site = process.env.MIGRATION_SITE?.trim() || undefined;

console.log(dryRun ? "DRY RUN: nothing is written or pushed." : "APPLY");
const { runWorkshopsAgoMigration } = await import("../../server/workshops-ago-migration");
const { failed, changed } = await runWorkshopsAgoMigration({ site, dryRun });
console.log(dryRun ? "would_change" : "changed", changed);
process.exit(failed ? 1 : 0);
