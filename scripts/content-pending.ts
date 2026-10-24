#!/usr/bin/env tsx
/**
 * Read-only: list content changes in this tree that GitHub does not have yet (every site in
 * sites.yml), using each site's .sync-state.json. Used by scripts/deploy.sh when the live
 * server does not answer, and to back up files before a deploy that skips the content check.
 *
 * Run with the tree to inspect as the working directory:
 *   (cd /opt/website-v3/current && npx tsx /path/to/release/scripts/content-pending.ts)
 *   ... --backup <dir>   copy the listed files (and manifest.json) into <dir>
 *
 * Prints JSON: { ok, sites: [{ site, content_root, files: [{ file, author, kind }], baseline_missing }] }.
 * Exits 0 even when files are pending; the caller decides.
 */

import fs from "fs";
import path from "path";

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const backupIdx = process.argv.indexOf("--backup");
const backupDir = backupIdx >= 0 ? process.argv[backupIdx + 1] : undefined;
if (backupIdx >= 0 && !backupDir) {
  console.error("--backup needs a directory");
  process.exit(2);
}

const { getSiteConfigs } = await import("../server/site-config");
const { listUnpushedContent } = await import("../server/content-flush");

const sites = getSiteConfigs().map((s) => {
  const list = listUnpushedContent(s.contentFolder);
  return { site: s.domain, content_root: s.contentFolder, files: list.files, baseline_missing: list.baselineMissing };
});

if (backupDir) {
  const copied: string[] = [];
  for (const s of sites) {
    for (const f of s.files) {
      if (f.kind === "delete") continue;
      const src = path.join(process.cwd(), f.file);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(backupDir, f.file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      copied.push(f.file);
    }
  }
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(
    path.join(backupDir, "manifest.json"),
    JSON.stringify({ created_at: new Date().toISOString(), source_tree: process.cwd(), sites, copied }, null, 2),
    "utf-8",
  );
}

console.log(JSON.stringify({ ok: sites.every((s) => s.files.length === 0), sites }));
