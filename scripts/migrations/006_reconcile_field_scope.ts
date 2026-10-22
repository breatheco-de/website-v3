#!/usr/bin/env tsx
/**
 * @migration 006_reconcile_field_scope
 * @description Some pages keep the same setting in two places: once for the whole page and
 *   once inside a language. This keeps the most recently set value in the right place and
 *   removes the old copy. Funnel, authors and publish date become page-wide; search settings
 *   (robots, priority, change frequency) become per-language. Drafts lose only the values they
 *   copied from the live page, never the author's edits. The dry run lists every page whose live
 *   display changes, values picked without history or from a bulk change, and the proposals to
 *   re-check. Changed files are pushed to the content repo.
 * @scope site
 * @dry-run
 * @production-only
 * @timeout 900
 *
 * Steps:
 *   1. Recovery: files an earlier run changed but did not push are pushed first.
 *   2. Drafts: page-level values equal to what the live locale file had when the draft was made
 *      are removed (the draft base, else today's live). Values the author changed stay staged.
 *   3. Live files: page-level fields leave the language files for `_common.yml`; per-language
 *      fields leave `_common.yml` for each language (a language without its own copy keeps the
 *      value it showed; a language's own title / description / content is never replaced).
 *      When page-level or search-setting copies differ, the newest real value wins, dated by when
 *      the value itself last changed in the content repo history (a full clone, removed afterwards).
 *      Empty placeholders never win; no usable history → what visitors see today (flagged);
 *      a winner from a commit touching more than 50 files is applied and flagged.
 *   4. Drafts whose base / translation source matched live before are re-stamped; proposals
 *      linked to a rewritten draft get its new fingerprint (not a co-author edit).
 *   5. All changed files are pushed in one commit and the commitSha is printed; proposals linked
 *      to cleaned drafts with open needs-changes are listed ("re-preview, then resolve").
 * Exits non-zero when the history clone or a push fails, so the run is never recorded as
 * completed. Idempotent: a second run finds every field already in the right file.
 * Type-wide defaults in `{type}/_common.template.yml` are not touched.
 *
 * Usage: MIGRATION_SITE=site_4geeks-com npx tsx scripts/migrations/006_reconcile_field_scope.ts [--dry-run]
 *        (without MIGRATION_SITE every site runs)
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const dryRun = process.argv.includes("--dry-run");
const site = process.env.MIGRATION_SITE?.trim() || undefined;

console.log(dryRun ? "DRY RUN: nothing is written or pushed." : "APPLY");
const { runFieldScopeMigration } = await import("../../server/field-scope-migration");
const { failed } = await runFieldScopeMigration({ site, dryRun });
process.exit(failed ? 1 : 0);
