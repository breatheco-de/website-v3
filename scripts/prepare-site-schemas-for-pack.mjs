/**
 * Before `npm pack` / publish: replace shared/site-component-schemas.ts with the
 * stub so the tarball never references gitignored site_* paths.
 * After pack: restore the real bridge from .site-schemas-pack-backup.ts.
 *
 * Usage:
 *   node scripts/prepare-site-schemas-for-pack.mjs
 *   node scripts/prepare-site-schemas-for-pack.mjs --restore
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const real = path.join(root, "shared", "site-component-schemas.ts");
const stub = path.join(root, "shared", "site-component-schemas.stub.ts");
const backup = path.join(root, "shared", ".site-schemas-pack-backup.ts");
const restore = process.argv.includes("--restore");

if (restore) {
  if (!fs.existsSync(backup)) {
    console.log("No site-schemas pack backup to restore — skipping.");
    process.exit(0);
  }
  fs.copyFileSync(backup, real);
  fs.unlinkSync(backup);
  console.log("Restored shared/site-component-schemas.ts from pack backup.");
  process.exit(0);
}

if (!fs.existsSync(stub)) {
  console.error(`Missing stub: ${stub}`);
  process.exit(1);
}
if (!fs.existsSync(real)) {
  console.error(`Missing bridge: ${real}`);
  process.exit(1);
}

// Already stubbed (e.g. re-entrant prepack) — detect by lack of site_ imports.
const current = fs.readFileSync(real, "utf8");
if (!current.includes("site_4geeks-com") && !fs.existsSync(backup)) {
  console.log("site-component-schemas.ts already has no site_* imports — pack-ready.");
  process.exit(0);
}

if (!fs.existsSync(backup)) {
  fs.copyFileSync(real, backup);
}
fs.copyFileSync(stub, real);
console.log(
  "Pack prep: wrote stub into shared/site-component-schemas.ts (backup at shared/.site-schemas-pack-backup.ts).",
);
