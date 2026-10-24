#!/usr/bin/env tsx
/**
 * @migration 009_assign_tracking_short_keys
 * @description Gives every product and persona a short tracking key (for example "aie" for AI
 *   Engineering) so analytics events can say which product and persona a page is about without
 *   hitting Google Analytics' 100-character limit. Keys staff already typed in the Store are kept;
 *   only missing ones are filled. Product and persona tracking on events stays off on a site until
 *   this has run there. Page copy is not changed. Changed _product.yml files are pushed to the
 *   content repo.
 * @scope site
 * @dry-run
 * @production-only
 *
 * Steps:
 *   1. Reads every _product.yml on the site (removed products included, so their keys stay reserved).
 *   2. Suggests a key for each product / persona without one: initials of the name, extended until
 *      unique on the site (retired keys count as taken). Dry run lists them and writes nothing.
 *   3. Writes the files and pushes them, printing the commitSha. Recovery: _product.yml files left
 *      unpushed by an earlier run are pushed too.
 * Exits non-zero when a file can't be read or a push fails, so the run is never recorded as completed.
 * Idempotent: a second run finds nothing to assign.
 * The live server notices the new keys on its own, turns product/persona tracking on for the site
 * and clears its cached pages.
 *
 * Usage: MIGRATION_SITE=site_4geeks-com npx tsx scripts/migrations/009_assign_tracking_short_keys.ts [--dry-run]
 *        (without MIGRATION_SITE every site runs)
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const dryRun = process.argv.includes("--dry-run");
const site = process.env.MIGRATION_SITE?.trim() || undefined;

console.log(dryRun ? "DRY RUN: nothing is written or pushed." : "APPLY");
const { runTrackingKeysMigration } = await import("../../server/product/tracking-keys-migration");
const { failed } = await runTrackingKeysMigration({ site, dryRun });
process.exit(failed ? 1 : 0);
