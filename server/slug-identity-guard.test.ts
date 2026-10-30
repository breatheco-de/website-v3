/**
 * Guards for the one-identity model: callers name pages by any slug, boundaries resolve
 * through server/entry-ref.ts, and page slugs use shared/slug.ts only.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ENTRY_REF_TOOLS } from "../mcp-server/lib/entry-ref-mcp";

const ROOT = path.resolve(__dirname, "..");

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (d.name === "node_modules" || d.name.startsWith(".")) continue;
      out.push(...walk(rel, exts));
    } else if (exts.some((e) => d.name.endsWith(e)) && !/\.test\.tsx?$/.test(d.name)) {
      out.push(rel);
    }
  }
  return out;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

/** MCP tools with a slug/slugs arg that intentionally do not resolve it (and why). */
const NON_RESOLVING_SLUG_TOOLS: Record<string, string> = {
  create_entry: "creates a page; the slug is new and must never resolve onto an existing page",
  delete_entries: "destructive: requires exact page IDs (no spelling resolution)",
  list_entries: "filter: slugs / search already match any address by slugKey",
  propose_change: "entries[] are resolved server-side by the proposal service",
  update_proposal: "entries / accepted_entry are resolved or gated server-side",
  get_product: "product content slug (page ID) from product tools",
  create_or_update_product: "product content slug (page ID) from product tools",
  get_product_funnel: "product content slug (page ID) from product tools",
  get_product_funnel_analytics: "product content slug (page ID) from product tools",
  list_variables: "nested context.entry, resolved by the variable catalog route",
};

/** Request-boundary files allowed to join a slug variable into a content path (reason in comment). */
const SLUG_PATH_JOIN_ALLOWLIST: Record<string, number> = {
  "server/routes/databases.ts": 1, // dataset folders under db/, not pages
  "server/routes/content.ts": 3, // readdir loops: the slug is a real folder name
  "mcp-server/tools/pages.ts": 3, // create_entry (new slug) + wrapped entry-ref tools
};

/** Identifier kinds that are not page slugs keep their own helpers. */
const OTHER_IDENTIFIER_SLUGIFIERS = new Set([
  "client/src/pages/SecurityPage.tsx", // role IDs (underscore)
  "shared/consent-settings.ts", // consent keys
  "client/src/pages/PrivateDatabases.tsx", // database names (underscore)
  "server/gsc-organic-markets.ts", // market IDs
  "client/src/components/article/variants/ArticleDefault.tsx", // heading anchors
  "client/src/components/theme/ThemeBackgroundUsage.tsx", // theme color IDs
  "client/src/components/pipeline/EventWebhooksDialog.tsx", // webhook IDs
]);
const OTHER_IDENTIFIER_SLUG_REGEX = new Set([
  "server/validation-issue-context.ts", // validator names
]);

describe("slug identity guards", () => {
  it("every MCP tool with a slug arg resolves it or is explicitly exempt", () => {
    const offenders: string[] = [];
    for (const file of walk("mcp-server/tools", [".ts"])) {
      const lines = read(file).split("\n");
      let tool = "";
      for (let i = 0; i < lines.length; i++) {
        if (/mcp\.tool\(\s*$/.test(lines[i]!) || /mcp\.tool\(\s*"/.test(lines[i]!)) {
          const m = (lines[i]!.match(/mcp\.tool\(\s*"([^"]+)"/) ?? lines[i + 1]?.match(/^\s*"([^"]+)"/)) as
            | RegExpMatchArray
            | null;
          if (m) tool = m[1]!;
        }
        if (tool && /^\s+slugs?: z\./.test(lines[i]!)) {
          if (!ENTRY_REF_TOOLS.has(tool) && !(tool in NON_RESOLVING_SLUG_TOOLS)) offenders.push(`${file}: ${tool}`);
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("request boundaries do not join raw slugs into content paths", () => {
    const counts: Record<string, number> = {};
    const re = /path\.join\([^)]*\b(slug|folderSlug|entrySlug)\b[^)]*\)/;
    for (const file of [...walk("server/routes", [".ts"]), ...walk("mcp-server/tools", [".ts"])]) {
      for (const line of read(file).split("\n")) {
        if (re.test(line) && !line.includes("entryIdFor(")) counts[file] = (counts[file] ?? 0) + 1;
      }
    }
    expect(counts).toEqual(SLUG_PATH_JOIN_ALLOWLIST);
  });

  it("page slugs are generated and validated only through shared/slug.ts", () => {
    const helpers: string[] = [];
    const regexes: string[] = [];
    const files = [
      ...walk("server", [".ts"]),
      ...walk("shared", [".ts"]),
      ...walk("mcp-server", [".ts"]),
      ...walk("client/src", [".ts", ".tsx"]),
    ];
    for (const file of files) {
      if (file === "shared/slug.ts") continue;
      const src = read(file);
      if (/function slugify\w*\(|const slugify\w*\s*=/.test(src) && !OTHER_IDENTIFIER_SLUGIFIERS.has(file)) {
        helpers.push(file);
      }
      if (src.includes("[a-z0-9]+(?:-[a-z0-9]+)*") && !OTHER_IDENTIFIER_SLUG_REGEX.has(file)) regexes.push(file);
    }
    expect({ helpers, regexes }).toEqual({ helpers: [], regexes: [] });
  });
});
