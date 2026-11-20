#!/usr/bin/env tsx
/**
 * @migration 018_wire_location_ct_to_db
 * @description Links the Locations content type to the Locations database, adds a minimal
 *   shared template for future attached campuses, and marks every existing campus as keeping
 *   its own layout (detached). Campus facts (city, coordinates, …) stay in the database —
 *   they are removed from each campus page's shared facts file so there is one source of truth.
 *   Changed files are pushed to the content repo.
 * @scope site
 * @dry-run
 * @production-only
 *
 * Usage: MIGRATION_SITE=site_4geeks-com npx tsx scripts/migrations/018_wire_location_ct_to_db.ts [--dry-run]
 */

import { config as loadDotenv } from "dotenv";
import fs from "fs";
import path from "path";

loadDotenv({ quiet: true });
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const dryRun = process.argv.includes("--dry-run");
const siteFilter = process.env.MIGRATION_SITE?.trim() || undefined;

console.log(dryRun ? "DRY RUN: nothing is written or pushed." : "APPLY");

const { wireLocationContentTypeToDatabase } = await import("../../server/location-ct-db-wire");
const { markFileAsModified, detectPendingChanges, updateFileAfterCommit } = await import(
  "../../server/sync-state"
);
const { getConflictInfo, commitAndPush } = await import("../../server/github");

function listSites(): string[] {
  if (siteFilter) return [siteFilter];
  return fs
    .readdirSync(process.cwd())
    .filter((d) => d.startsWith("site_") && fs.statSync(d).isDirectory())
    .filter(
      (d) =>
        fs.existsSync(path.join(d, "locations")) &&
        fs.existsSync(path.join(d, "db", "locations", "locations.yml")),
    );
}

let failed = false;
const batches: { contentRoot: string; files: string[] }[] = [];

for (const contentRoot of listSites()) {
  if (dryRun) {
    const locDir = path.join(contentRoot, "locations");
    const campuses = fs.existsSync(locDir)
      ? fs.readdirSync(locDir).filter((e) => {
          const p = path.join(locDir, e);
          return !e.startsWith("_") && !e.startsWith(".") && fs.statSync(p).isDirectory();
        })
      : [];
    console.log(contentRoot, "would_detach", campuses.length, "would_update content-types + templates + _common.yml");
    continue;
  }
  const { files, detached } = wireLocationContentTypeToDatabase(contentRoot);
  console.log(contentRoot, "detached", detached.length, "files", files.length);
  for (const f of files) markFileAsModified(f, "agent", undefined, contentRoot);
  batches.push({ contentRoot, files });
}

if (dryRun) process.exit(0);

for (const { contentRoot, files } of batches) {
  const conflicts = await getConflictInfo({ contentRoot });
  const remoteTouched: string[] = (conflicts as { changedFiles?: string[] })?.changedFiles ?? [];
  const overlap = files.filter((f) => remoteTouched.includes(f));
  if (overlap.length) {
    console.error("Resolve overlap before push:", overlap.join(", "));
    failed = true;
    continue;
  }
  const result = await commitAndPush(
    "Wire Locations content type to locations DB; detach existing campuses",
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
