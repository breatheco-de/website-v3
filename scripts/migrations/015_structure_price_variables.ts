#!/usr/bin/env tsx
/**
 * @migration 015_structure_price_variables
 * @description Converts every price site variable from marketing strings (like "$10,999") into
 *   structured amount + currency so catalog Offers and the Variables UI share one source of truth.
 *   Also tags each price to one product when the name makes it obvious, sets list vs monthly role,
 *   and writes list tuition onto that product's pricing.list_price_variable. Copy on pages keeps
 *   working: tokens still resolve to a formatted price string.
 * @scope site
 * @dry-run
 * @production-only
 * @timeout 300
 *
 * Steps:
 *   1. For each category:price entry in variables.yml, parse default/conditions into
 *      { amount, currency, display }.
 *   2. Fill products (exactly one) and price_role from name heuristics when missing.
 *   3. For price_role:list, set programs/{slug}/_product.yml → pricing.list_price_variable.
 *   4. Push changed files to the content repo and print commitSha.
 * Idempotent: already-structured money values are left alone; bindings that already match are skipped.
 *
 * Usage: MIGRATION_SITE=site_4geeks-com npx tsx scripts/migrations/015_structure_price_variables.ts [--dry-run]
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const dryRun = process.argv.includes("--dry-run");
const site = process.env.MIGRATION_SITE?.trim() || undefined;

console.log(dryRun ? "DRY RUN: nothing is written or pushed." : "APPLY");
const { runPriceVariablesMigration } = await import("../../server/price-variables-migration");
const { failed, changed } = await runPriceVariablesMigration({ site, dryRun });
console.log(dryRun ? "would_change" : "changed", changed);
process.exit(failed ? 1 : 0);
