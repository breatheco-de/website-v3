/**
 * Warn-only scan: list /api routes registered via raw app.get/post/... instead of api.*.
 * Does not fail CI — informational until gradual migration.
 */
import fs from "fs";
import path from "path";

const ROUTES_DIR = path.join(process.cwd(), "server/routes");
const RAW_RE =
  /\bapp\.(get|post|put|patch|delete)\(\s*["'`]\/api/g;
const API_RE = /\bapi\.(get|post|put|patch|delete)\(\s*\n?\s*app,/g;

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walkTsFiles(full));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function lineNumber(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function main(): void {
  const files = walkTsFiles(ROUTES_DIR);
  const rawHits: { file: string; line: number; snippet: string }[] = [];
  const apiHits: { file: string; count: number }[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const rel = path.relative(process.cwd(), file);

    let m: RegExpExecArray | null;
    RAW_RE.lastIndex = 0;
    while ((m = RAW_RE.exec(content)) !== null) {
      const line = lineNumber(content, m.index);
      const snippet = content.slice(m.index, m.index + 60).replace(/\s+/g, " ").trim();
      rawHits.push({ file: rel, line, snippet });
    }

    const apiCount = (content.match(API_RE) || []).length;
    if (apiCount > 0) apiHits.push({ file: rel, count: apiCount });
  }

  console.log("API rate policy scan (warn-only)\n");
  console.log(`Routes using api.* helper: ${apiHits.reduce((n, h) => n + h.count, 0)} registration(s)`);
  for (const h of apiHits) {
    console.log(`  ${h.file}: ${h.count}`);
  }

  console.log(`\nRaw app.* /api routes (consider migrating to api.*): ${rawHits.length}`);
  for (const h of rawHits.slice(0, 40)) {
    console.log(`  ${h.file}:${h.line}  ${h.snippet}`);
  }
  if (rawHits.length > 40) {
    console.log(`  ... and ${rawHits.length - 40} more`);
  }

  if (rawHits.length === 0) {
    console.log("\nNo raw /api app.* registrations found.");
  } else {
    console.log(
      "\nNew endpoints should use server/rate-limit/api.ts — see .cursor/rules/api-rate-limits.mdc",
    );
  }
}

main();
