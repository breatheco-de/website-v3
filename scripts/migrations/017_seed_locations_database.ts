#!/usr/bin/env tsx
/**
 * @migration 017_seed_locations_database
 * @description Creates the Locations private database (campus catalog) and fills it from each
 *   campus page's shared facts (city, coordinates, region, etc.). Latitude and longitude are
 *   required — campuses without pins are reported and the run fails. Staff and the visitor
 *   session will use this bank as the source of truth for campuses. Changed files are pushed
 *   to the content repo.
 * @scope site
 * @dry-run
 * @production-only
 *
 * Usage: MIGRATION_SITE=site_4geeks-com npx tsx scripts/migrations/017_seed_locations_database.ts [--dry-run]
 */

import { config as loadDotenv } from "dotenv";
import fs from "fs";
import path from "path";

loadDotenv({ quiet: true });
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const dryRun = process.argv.includes("--dry-run");
const siteFilter = process.env.MIGRATION_SITE?.trim() || undefined;

console.log(dryRun ? "DRY RUN: nothing is written or pushed." : "APPLY");

const {
  collectLocationRowsFromCommon,
  writeLocationsDbItems,
  ensureLocationsDbConfig,
} = await import("../../server/locations-db-seed");
const { markFileAsModified, detectPendingChanges, updateFileAfterCommit } = await import(
  "../../server/sync-state"
);
const { getConflictInfo, commitAndPush } = await import("../../server/github");

function listSites(): string[] {
  if (siteFilter) return [siteFilter];
  return fs
    .readdirSync(process.cwd())
    .filter((d) => d.startsWith("site_") && fs.statSync(d).isDirectory())
    .filter((d) => fs.existsSync(path.join(d, "locations")));
}

const templateConfig = path.join(process.cwd(), "site_4geeks-com/db/locations/config.yml");
if (!fs.existsSync(templateConfig)) {
  console.error("Missing template config", templateConfig);
  process.exit(1);
}

let failed = false;
const allFiles: { contentRoot: string; files: string[] }[] = [];

for (const contentRoot of listSites()) {
  const { rows, missingCoords } = collectLocationRowsFromCommon(contentRoot);
  console.log(contentRoot, "campuses", rows.length, "missing_coords", missingCoords.length);
  if (missingCoords.length) {
    console.error("Missing latitude/longitude:", missingCoords.join(", "));
    failed = true;
    continue;
  }
  if (rows.length === 0) {
    console.log(contentRoot, "skip: no location folders");
    continue;
  }

  if (dryRun) {
    console.log(contentRoot, "would_write", [
      `${contentRoot}/db/locations/config.yml`,
      `${contentRoot}/db/locations/locations.yml`,
    ]);
    continue;
  }

  const configPath = ensureLocationsDbConfig(contentRoot, templateConfig);
  const itemsPath = writeLocationsDbItems(contentRoot, rows);
  const files = [
    path.relative(process.cwd(), configPath).split(path.sep).join("/"),
    path.relative(process.cwd(), itemsPath).split(path.sep).join("/"),
  ];
  for (const f of files) markFileAsModified(f, "agent", undefined, contentRoot);
  allFiles.push({ contentRoot, files });
  console.log(contentRoot, "wrote", files.join(", "));
}

if (failed) process.exit(1);
if (dryRun) process.exit(0);

for (const { contentRoot, files } of allFiles) {
  const conflicts = await getConflictInfo({ contentRoot });
  const remoteTouched: string[] = (conflicts as { changedFiles?: string[] })?.changedFiles ?? [];
  const overlap = files.filter((f) => remoteTouched.includes(f));
  if (overlap.length) {
    console.error("Resolve overlap before push:", overlap.join(", "));
    failed = true;
    continue;
  }
  const result = await commitAndPush(
    "Seed Locations database from campus page facts (lat/lon required)",
    { files, contentRoot },
  );
  const sha = (result as { commitHash?: string }).commitHash;
  if (!sha) {
    console.error("Content push failed:", (result as { error?: string }).error);
    failed = true;
    continue;
  }
  console.log("commitSha", sha, contentRoot);
  for (const f of files) updateFileAfterCommit(f, sha, contentRoot);
  const still = detectPendingChanges(contentRoot).filter((c) => files.includes(c.file));
  if (still.length) console.warn("still pending", still);
}

process.exit(failed ? 1 : 0);
