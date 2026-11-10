#!/usr/bin/env tsx
/**
 * Refresh the CI content fixture (fixtures/ci/content-4geeks-com) from the local,
 * synced site_4geeks-com: component registry + content-types.yml. Fixture pages
 * (pages/, landings/, …) are left as they are. Prints each ads-optimized content
 * type and whether the fixture has a page for it (server/ssr-smoke.test.ts needs one).
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "site_4geeks-com");
const FIXTURE = path.join(ROOT, "fixtures", "ci", "content-4geeks-com");

if (!fs.existsSync(path.join(SOURCE, "content-types.yml"))) {
  console.error(`No ${path.relative(ROOT, SOURCE)}/content-types.yml — pull content first (npm run content:pull).`);
  process.exit(1);
}

const registrySource = path.join(SOURCE, "component-registry");
const registryTarget = path.join(FIXTURE, "component-registry");
fs.rmSync(registryTarget, { recursive: true, force: true });
fs.cpSync(registrySource, registryTarget, { recursive: true });
console.log(`component-registry copied (${fs.readdirSync(registryTarget).length} entries)`);

fs.copyFileSync(path.join(SOURCE, "content-types.yml"), path.join(FIXTURE, "content-types.yml"));
console.log("content-types.yml copied");

type TypeConfig = { directory?: string; ads?: { optimize?: boolean } };
const types = (yaml.load(fs.readFileSync(path.join(FIXTURE, "content-types.yml"), "utf-8")) ?? {}) as Record<string, TypeConfig>;
const adsTypes = Object.entries(types).filter(([, cfg]) => cfg?.ads?.optimize === true);

let missing = 0;
for (const [name, cfg] of adsTypes) {
  const dir = path.join(FIXTURE, cfg.directory || name);
  const pages = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()) : [];
  if (pages.length === 0) missing += 1;
  console.log(`ads-optimized ${name}: ${pages.length ? `fixture pages ${pages.join(", ")}` : "NO fixture page — add one for server/ssr-smoke.test.ts"}`);
}
if (adsTypes.length === 0) console.log("no ads-optimized content types");
if (missing) console.warn(`${missing} ads-optimized type(s) have no fixture page; the SSR smoke test will fail until one is added.`);
