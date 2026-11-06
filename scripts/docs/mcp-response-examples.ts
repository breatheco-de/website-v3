/**
 * Builds the JSON blocks in docs/mcp-response-examples.md from the real MCP response helpers,
 * so the examples cannot drift from what agents receive.
 *
 *   npm run docs:mcp-examples          rewrite the blocks in place
 *   npm run docs:mcp-examples -- --check   exit 1 when the doc is stale (same check as the test)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { TOOL_GATES } from "../../shared/mcp-tool-catalog.js";
import { ok, type McpTextResult } from "../../mcp-server/lib/respond.js";
import {
  resolveLayoutTargetGate,
  sharedStructuralEnvelope,
  wrotePayload,
} from "../../mcp-server/lib/page-tool-helpers.js";
import {
  REORDER_NO_BINDING_FANOUT,
  SHARED_TEMPLATE_HTML_CACHE_WARNING,
} from "../../mcp-server/lib/shared-layout.js";
import type { ContentTypeConfig } from "../../mcp-server/lib/content.js";
import {
  buildProposalDiscoveryPath,
  type BuildProposalDiscoveryPathOpts,
} from "../../server/content-proposals/proposal-discovery-path.js";
import { THINK_TEMPLATES, type ChecklistId } from "../../server/content-proposals/proposal-review-rules.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DOC_PATH = path.join(ROOT, "docs/mcp-response-examples.md");

/** look_for lists are cut to this many lines in the doc; the doc says so above each block. */
const LOOK_FOR_KEEP = 2;

const BLOG_CONFIG = { single_template: true } as unknown as ContentTypeConfig;
const BLOG = { contentType: "blog", slug: "what-is-python", locale: "en" };

function parse(result: McpTextResult): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function gateResult(r: ReturnType<typeof resolveLayoutTargetGate>): McpTextResult {
  if (!("gate" in r)) throw new Error("expected a layout gate");
  return r.gate;
}

function trimLookFor<T extends { look_for?: string[] }>(item: T): T {
  const all = item.look_for ?? [];
  if (all.length <= LOOK_FOR_KEEP) return item;
  return { ...item, look_for: [...all.slice(0, LOOK_FOR_KEEP), `… +${all.length - LOOK_FOR_KEEP} more`] };
}

function thinkItems(ids: ChecklistId[]) {
  return ids.map((id) => {
    const t = THINK_TEMPLATES[id];
    return { id: t.id, title: t.title, why: t.why, look_for: t.look_for };
  });
}

const CATALOG = new Set(Object.keys(TOOL_GATES));

const FIGURES_PROPOSAL: BuildProposalDiscoveryPathOpts["proposal"] = {
  id: "prop_8f2c",
  status: "open",
  kind: "edits",
  title: "Update Full Stack price and hire rate",
  summary: "Replace the hardcoded price and hire rate on the Miami Full Stack landing with site variables.",
  open_blocker_count: 0,
  entries: [
    {
      contentType: "landing",
      slug: "full-stack-miami",
      locale: "en",
      status: "pending",
      ops: [{ field_path: "sections.0.data.price" }, { field_path: "sections.3.data.stats.0.value" }],
    },
  ],
};

const FIGURES_REVIEW_CONTEXT: BuildProposalDiscoveryPathOpts["reviewContext"] = {
  summary: "Outcome figures on a live page",
  damage_class: "selling_page",
  active_checklists: ["selling_page_figures", "verify_copy", "adjacent_findings", "disposition"],
  figure_variables: [{ name: "global.price_fullstack" }, { name: "global.hire_rate" }],
  agent_preview: {
    think_items: thinkItems(["selling_page_figures", "verify_copy", "adjacent_findings", "disposition"]),
    warnings: [
      {
        code: "figure_variable_tokens",
        message:
          "Outcome figures turned on by variable tokens: global.price_fullstack, global.hire_rate. Check each is the right fact with list_variables.",
      },
    ],
  },
};

function templateWriteOk(): McpTextResult {
  const contentPath = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-examples-"));
  try {
    fs.mkdirSync(path.join(contentPath, "blog"));
    for (const loc of ["en", "es"]) fs.writeFileSync(path.join(contentPath, "blog", `template.${loc}.yml`), "sections: []\n");
    const relativePath = "blog/template.en.yml";
    const env = sharedStructuralEnvelope({
      tool: "reorder_sections",
      contentType: BLOG.contentType,
      config: BLOG_CONFIG,
      contentPath,
      sourceLocale: BLOG.locale,
      relativePath,
      argsHintBase: { order: [1, 0, 2], confirm_live_edit: true },
      reasonPrefix: "Shared layout section order changed.",
    });
    return ok(
      {
        message: `Sections reordered in ${relativePath}`,
        ...wrotePayload({ layer: "type_template", contentType: BLOG.contentType, path: relativePath, locale: BLOG.locale, slug: BLOG.slug }),
      },
      { warnings: [REORDER_NO_BINDING_FANOUT, SHARED_TEMPLATE_HTML_CACHE_WARNING], ...env },
    );
  } finally {
    fs.rmSync(contentPath, { recursive: true, force: true });
  }
}

function figuresPath(allowedTools: Set<string>) {
  return buildProposalDiscoveryPath({ proposal: FIGURES_PROPOSAL, allowedTools, reviewContext: FIGURES_REVIEW_CONTEXT });
}

/** Example id → payload shown in the doc. Order matches the doc. */
export function buildMcpResponseExamples(): Record<string, unknown> {
  const layoutArgs = { tool: "reorder_sections", config: BLOG_CONFIG, requireConfirmWhenAuto: true, ...BLOG };

  const figures = figuresPath(CATALOG);
  const figuresPathTrimmed = {
    ...figures.discovery_path!,
    items: figures.discovery_path!.items.map(trimLookFor),
  };

  const capped = figuresPath(new Set([...CATALOG].filter((t) => t !== "list_variables")));
  const cappedItem = capped.discovery_path!.items.find((i) => i.kind === "tool" && i.tool === "list_variables");

  const hold = buildProposalDiscoveryPath({
    proposal: {
      ...FIGURES_PROPOSAL,
      escalated: true,
      escalated_note: "Price change is waiting on finance sign-off. Do not touch until released.",
    },
    allowedTools: CATALOG,
  });

  return {
    layout_gate: parse(gateResult(resolveLayoutTargetGate(layoutArgs))),
    layout_fail: parse(gateResult(resolveLayoutTargetGate({ ...layoutArgs, confirm_layout_target: true }))),
    template_write_ok: parse(templateWriteOk()),
    discovery_figures: { discovery_path: figuresPathTrimmed, warnings: figures.warnings },
    discovery_capped: {
      discovery_path: { items: ["…", trimLookFor(cappedItem!), "…"] },
      warnings: capped.warnings,
    },
    steward_hold: hold,
  };
}

const BLOCK_RE = /<!-- mcp-example:([a-z_]+) -->\n```json\n[\s\S]*?\n```\n<!-- \/mcp-example -->/g;

/** Doc text with every example block replaced by the generated JSON. Throws on unknown or missing ids. */
export function renderDoc(doc: string, examples = buildMcpResponseExamples()): string {
  const seen = new Set<string>();
  const out = doc.replace(BLOCK_RE, (_m, id: string) => {
    if (!(id in examples)) throw new Error(`Unknown example id in doc: ${id}`);
    seen.add(id);
    return `<!-- mcp-example:${id} -->\n\`\`\`json\n${JSON.stringify(examples[id], null, 2)}\n\`\`\`\n<!-- /mcp-example -->`;
  });
  const missing = Object.keys(examples).filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`Doc is missing example blocks: ${missing.join(", ")}`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const doc = fs.readFileSync(DOC_PATH, "utf-8");
  const next = renderDoc(doc);
  if (process.argv.includes("--check")) {
    if (next !== doc) {
      console.error("docs/mcp-response-examples.md is stale. Run: npm run docs:mcp-examples");
      process.exit(1);
    }
    console.log("docs/mcp-response-examples.md is up to date");
  } else {
    fs.writeFileSync(DOC_PATH, next);
    console.log("updated", path.relative(ROOT, DOC_PATH));
  }
}
