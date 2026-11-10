#!/usr/bin/env tsx
/**
 * @migration 012_remove_common_locale
 * @description Removes the ignored `locale:` line from the shared settings (_common.yml) of pages
 *   that use one address for every language, like landings. A page's language comes from its
 *   language file (es.yml / en.yml) whose slug matches the address; the old line is no longer read
 *   and teaches a bad practice. Nothing visitors see changes. Run it after the deploy that stopped
 *   reading the line. Changed files are pushed to the content repo.
 * @scope site
 * @dry-run
 * @production-only
 * @timeout 300
 *
 * Steps:
 *   1. Recovery: _common.yml files an earlier run edited but did not push are pushed first.
 *   2. For each content type whose url_pattern is only `default` (no :locale), every entry whose
 *      _common.yml has a top-level `locale:` line: that line is removed by text (no YAML re-dump;
 *      other keys, order and template values stay byte-identical).
 *   3. All changed files are pushed in one commit and the commitSha is printed.
 * Exits non-zero when a push fails or returns no SHA, so the run is never recorded as completed.
 * Idempotent: a second run finds no `locale:` line to remove.
 *
 * Usage: MIGRATION_SITE=site_4geeks-com npx tsx scripts/migrations/012_remove_common_locale.ts [--dry-run]
 *        (without MIGRATION_SITE every site runs)
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const dryRun = process.argv.includes("--dry-run");
const site = process.env.MIGRATION_SITE?.trim() || undefined;

console.log(dryRun ? "DRY RUN: nothing is written or pushed." : "APPLY");
const { runCommonLocaleMigration } = await import("../../server/common-locale-migration");
const { failed, changed } = await runCommonLocaleMigration({ site, dryRun });
console.log(dryRun ? "would_change" : "changed", changed.length);
process.exit(failed ? 1 : 0);
