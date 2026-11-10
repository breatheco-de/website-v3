#!/usr/bin/env tsx
/**
 * Read-only: rows in each evidence database (press_mentions…) that the save-time duplicate checks
 * would flag today — same link, redirect links, and "looks like the same story" pairs. Writes nothing;
 * staff clean up (Reject or delete) on the Databases page.
 *
 *   npx tsx scripts/evidence/duplicates-report.ts                 # every site in sites.yml
 *   npx tsx scripts/evidence/duplicates-report.ts --site=4geeks.com
 *   ... --json                                                    # machine-readable output
 */

import path from "path";

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const siteArg = process.argv.find((a) => a.startsWith("--site="))?.slice("--site=".length);
const asJson = process.argv.includes("--json");

const { getSiteConfigs } = await import("../../server/site-config");
const { listEvidenceDatabases, readEvidenceRows } = await import("../../server/evidence-archive/rows");
const { siteBrandTerms } = await import("../../server/content-proposals/site-brand");
const { findEvidenceDuplicates, ignoreWordSet, isRedirectLink } = await import("../../shared/evidence-duplicates");
const { isRowRejected } = await import("../../shared/evidence-kinds");
const { rowProofLink } = await import("../../shared/evidence-archive");

type RowRef = { index: number; title: string | null; locale: string | null; link: string | null; rejected: boolean };
type Pair = { a: RowRef; b: RowRef; signals?: string[] };

const ref = (rows: Record<string, unknown>[], index: number, proofField: string): RowRef => {
  const r = rows[index] ?? {};
  return {
    index,
    title: typeof r.title === "string" ? r.title : null,
    locale: typeof r.locale === "string" ? r.locale : null,
    link: rowProofLink(r, proofField),
    rejected: isRowRejected(r),
  };
};

const sites = getSiteConfigs().filter((s) => !siteArg || s.domain === siteArg);
if (siteArg && sites.length === 0) {
  console.error(`Unknown site "${siteArg}". Sites: ${getSiteConfigs().map((s) => s.domain).join(", ")}`);
  process.exit(2);
}

const report = sites.map((site) => {
  const contentRoot = path.resolve(process.cwd(), site.contentFolder);
  const ignoreWords = ignoreWordSet(siteBrandTerms(contentRoot, site.domain));
  const databases = listEvidenceDatabases(contentRoot).map((db) => {
    const rows = readEvidenceRows(db);
    const proofField = db.cfg.proof_field;
    const sameLink: Pair[] = [];
    const similar: Pair[] = [];
    const redirects: RowRef[] = [];
    rows.forEach((row, i) => {
      if (isRedirectLink(rowProofLink(row, proofField))) redirects.push(ref(rows, i, proofField));
      const check = findEvidenceDuplicates({ rows, candidate: row, proofField, excludeIndex: i, ignoreWords });
      const b = check.blocked;
      if (b && b.index !== undefined && b.index < i && (b.code === "duplicate_link" || b.code === "rejected_link")) {
        sameLink.push({ a: ref(rows, b.index, proofField), b: ref(rows, i, proofField) });
      }
      for (const s of check.similar) {
        if (s.index < i) similar.push({ a: ref(rows, s.index, proofField), b: ref(rows, i, proofField), signals: s.signals });
      }
    });
    return {
      database: db.dbName,
      file: db.relPath,
      rows: rows.length,
      rejected: rows.filter(isRowRejected).length,
      same_link: sameLink,
      redirect_links: redirects,
      similar,
    };
  });
  return { site: site.domain, content_root: site.contentFolder, databases };
});

if (asJson) {
  console.log(JSON.stringify({ ok: true, sites: report }, null, 2));
  process.exit(0);
}

const label = (r: RowRef) =>
  `#${r.index} ${r.title ?? "(no title)"}${r.locale ? ` [${r.locale}]` : ""}${r.rejected ? " (rejected)" : ""}`;

for (const s of report) {
  console.log(`\n${s.site} (${s.content_root})`);
  if (s.databases.length === 0) {
    console.log("  No evidence databases.");
    continue;
  }
  for (const d of s.databases) {
    console.log(`  ${d.database} — ${d.rows} rows, ${d.rejected} rejected (${d.file})`);
    if (!d.same_link.length && !d.redirect_links.length && !d.similar.length) {
      console.log("    Nothing to clean up.");
      continue;
    }
    for (const p of d.same_link) console.log(`    Same link: ${label(p.a)}  ↔  ${label(p.b)}\n      ${p.b.link}`);
    for (const r of d.redirect_links) console.log(`    Redirect link: ${label(r)}\n      ${r.link}`);
    for (const p of d.similar) console.log(`    Looks alike (${p.signals?.join(", ")}): ${label(p.a)}  ↔  ${label(p.b)}`);
  }
}
