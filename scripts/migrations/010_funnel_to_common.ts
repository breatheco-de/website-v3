#!/usr/bin/env tsx
/**
 * @migration 010_funnel_to_common
 * @description Some pages keep their funnel (stage, products and personas) inside a language file
 *   instead of the page's shared settings, so new drafts lose it and languages can disagree. This
 *   moves each page's funnel into the shared settings and removes the language copies. When copies
 *   differ: a copy naming a product or persona that doesn't exist never wins; a copy with a persona
 *   on every product (or "all products") beats one with bare products; otherwise the most recently
 *   edited copy wins. Drafts keep a valid funnel with personas until they are published. The dry
 *   run lists every page whose display changes, pages left with invalid personas to fix in the
 *   Funnel tab, and proposals whose draft will replace the page funnel on publish. Changed files
 *   are pushed to the content repo.
 * @scope site
 * @dry-run
 * @production-only
 * @timeout 900
 *
 * Steps (funnel only; other fields are untouched):
 *   1. Recovery: files an earlier run changed but did not push are pushed first.
 *   2. Drafts: a funnel only copied from the live language file is removed unless it is valid with a
 *      persona on every product (or "all"); such funnels, and funnels the author changed, stay staged
 *      and are listed (`draft_keeps_funnel`, `needs_fix` when invalid or missing personas).
 *   3. Live files: per page, candidates are `_common.yml` and every language copy. Rank: invalid
 *      (product or persona not in the site's `_product.yml` files) < bare products / stage only <
 *      persona on every product or "all". Within the top rank the newest value in the content repo
 *      history wins (no usable history → default language, flagged `no_history`). The whole block
 *      (stage + products) moves. No valid copy → the most complete moves anyway, flagged
 *      `no_valid_copy` with its invalid pairs. Other flags: `persona_preferred`, `invalid_dropped`,
 *      `bulk_change`.
 *   4. Drafts whose base matched live are re-stamped; proposals linked to rewritten drafts get the
 *      new fingerprint.
 *   5. All changed files are pushed in one commit and the commitSha is printed.
 * Exits non-zero when the history clone or a push fails, so the run is never recorded as
 * completed. Idempotent: a second run finds no language-file funnel to move.
 *
 * Usage: MIGRATION_SITE=site_4geeks-com npx tsx scripts/migrations/010_funnel_to_common.ts [--dry-run]
 *        (without MIGRATION_SITE every site runs)
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const dryRun = process.argv.includes("--dry-run");
const site = process.env.MIGRATION_SITE?.trim() || undefined;

console.log(dryRun ? "DRY RUN: nothing is written or pushed." : "APPLY");
const { runFieldScopeMigration } = await import("../../server/field-scope-migration");
const { failed } = await runFieldScopeMigration({
  site,
  dryRun,
  onlyPaths: ["funnel"],
  rankFunnel: true,
  author: "migration:010",
  commitMessage: (n) => `Funnel cleanup: each page's funnel lives once, in _common.yml (${n} file(s))`,
});
process.exit(failed ? 1 : 0);
