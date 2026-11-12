#!/usr/bin/env tsx
/**
 * @migration 014_fix_landing_locations
 * @description Landing pages: the page's Locations field becomes a pick list of real locations
 *   (a link to the Locations content type) instead of free text, and the location names that don't
 *   exist are fixed: barcelona-espana → barcelona-spain (4 Spain pages), ciudad-de-mexico →
 *   mexicocity-mexico (mexico-ai-engineering) and the form on ai-engineering-coding-florida
 *   (downtown-miami → miami-usa). Stored values are slugs already, so nothing else changes on live
 *   pages. Run it before turning off location detection for landings. Changed files are pushed to
 *   the content repo.
 * @scope site
 * @dry-run
 * @production-only
 *
 * Steps:
 *   1. content-types.yml: landing.editor.locations → type relation, source location, value slug, multiple
 *      (field_mapping unchanged). Skipped when it already links to location.
 *   2. Landing _common.yml `locations:` items and landing form `fields.location.default` values with a
 *      known wrong name are renamed in place (only those lines change), when the real slug exists.
 *   3. Remaining unknown page locations are printed (fix by hand in Page Meta → Fields).
 *   4. Changed files are pushed in one commit and the commitSha is printed. Recovery: files an earlier
 *      run wrote but did not push are pushed first.
 * Exits non-zero when a push fails or returns no SHA.
 * Idempotent: a second run finds the field already a link and no wrong names left.
 *
 * Usage: MIGRATION_SITE=site_4geeks-com npx tsx scripts/migrations/014_fix_landing_locations.ts [--dry-run]
 *        (without MIGRATION_SITE every site runs; sites without landings or locations are skipped)
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const dryRun = process.argv.includes("--dry-run");
const site = process.env.MIGRATION_SITE?.trim() || undefined;

console.log(dryRun ? "DRY RUN: nothing is written or pushed." : "APPLY");
const { runLandingLocationsMigration } = await import("../../server/landing-locations-migration");
const { failed, changed } = await runLandingLocationsMigration({ site, dryRun });
console.log(dryRun ? "would_change" : "changed", changed);
process.exit(failed ? 1 : 0);
