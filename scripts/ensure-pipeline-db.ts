#!/usr/bin/env tsx
/**
 * Pipeline SQLite migration preflight (dry-run) or manual apply.
 *
 * Usage:
 *   npm run ensure:pipeline-db -- --dry-run   # deploy preflight (copies DBs, migrates copies only)
 *   npm run ensure:pipeline-db -- --apply     # manual live apply
 */

import { config as loadDotenv } from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";

loadDotenv({ quiet: true });

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || !args.includes("--apply");
if (args.includes("--dry-run") && args.includes("--apply")) {
  console.error("Use only one of --dry-run or --apply");
  process.exit(1);
}

const { requireSiteConfigs } = await import("../server/site-config");
const { ensurePipelineDbForSites } = await import("../server/pipeline-db/runner");
const { configureJobQueue, stopJobQueue } = await import("../server/jobs/queue");

const dataDir = path.resolve("data");
const sites = requireSiteConfigs().map((c) => c.contentFolder);

if (sites.length === 0) {
  console.error("[pipeline-db] no sites in sites.yml");
  process.exit(1);
}

function siteSafeName(site: string): string {
  return site.replace(/[/\\]/g, "-");
}

function copySiteDb(site: string, workDir: string): void {
  const safe = siteSafeName(site);
  const destDir = path.join(workDir, safe);
  fs.mkdirSync(destDir, { recursive: true });
  const src = path.join(dataDir, safe, "app.db");
  const dest = path.join(destDir, "app.db");
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

async function probeSidequestCopy(workDir: string): Promise<void> {
  const src = path.join(dataDir, "sidequest.sqlite");
  const dest = path.join(workDir, "sidequest.sqlite");
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
  try {
    await configureJobQueue({ sqlitePath: dest });
  } finally {
    // Sidequest.configure() keeps SQLite handles open; release before deploy continues.
    await stopJobQueue();
  }
}

try {
  if (dryRun) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-db-dry-"));
    try {
      for (const site of sites) {
        copySiteDb(site, workDir);
      }
      ensurePipelineDbForSites(sites, { dryRun: true, workDir, skipBackup: true });
      await probeSidequestCopy(workDir);
      console.log("[pipeline-db] dry-run complete for all sites");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  } else {
    ensurePipelineDbForSites(sites, { skipBackup: false });
    try {
      await configureJobQueue();
    } finally {
      await stopJobQueue();
    }
    console.log("[pipeline-db] apply complete for all sites");
  }
} catch (err) {
  console.error("[pipeline-db] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}

// CLI one-shot: Sidequest / better-sqlite3 may leave the event loop alive.
process.exit(0);
