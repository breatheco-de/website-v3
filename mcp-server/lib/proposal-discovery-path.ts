/**
 * Build discovery_path for list_proposals (first consumer).
 * Same DiscoveryPath shape as respond.ts — proposal-specific = which items.
 */

import { parseContentTypeStrategy, type ContentTypeStrategy } from "../../shared/contentTypeStrategy.js";
import { TOOL_GATES } from "../../shared/mcp-tool-catalog.js";
import type { DiscoveryPath, DiscoveryPathItem, DiscoveryPathToolItem, McpWarning } from "./respond.js";

export const DISCOVERY_TOOL_CAPPED = "discovery_tool_capped";

const CATALOG_NAMES = new Set(Object.keys(TOOL_GATES));

const EDITS_TOOLS: Array<{
  id: string;
  tool: string;
  why: string;
  look_for: string[];
}> = [
  {
    id: "preview_content",
    tool: "get_entry_content",
    why: "See the page body the proposal would change.",
    look_for: ["proposed fields vs live copy", "broken CTAs or missing sections"],
  },
  {
    id: "recent_writes",
    tool: "get_entry_activity",
    why: "Check whether someone else edited the same entry recently.",
    look_for: ["overlapping writers", "stale proposal context"],
  },
  {
    id: "seo_context",
    tool: "get_entry_seo",
    why: "Review SEO/meta context for the entry.",
    look_for: ["title/description fit", "keyword or schema gaps"],
  },
  {
    id: "traffic_risk",
    tool: "get_organic_traffic",
    why: "Gauge traffic risk before a go-live or high-visibility change.",
    look_for: ["high-traffic paths", "sudden drops after similar changes"],
  },
  {
    id: "diagnostics",
    tool: "run_entry_diagnostics",
    why: "Surface open validation issues on the entry.",
    look_for: ["blocking SEO/content issues", "issues the proposal claims to fix"],
  },
];

const TOOL_UNAVAILABLE_HINT =
  "This tool is not on your MCP role. Ask a human to enable the needed access, then refresh/reconnect the MCP connector.";

export type ProposalDiscoveryInput = {
  id: string;
  status: string;
  kind: string;
  title?: string;
  summary?: string;
  entries?: Array<{
    contentType: string;
    slug: string;
    locale: string;
    variant?: string | null;
    status?: string;
  }>;
  open_blocker_count?: number;
  blockers?: unknown[];
};

export type BuildProposalDiscoveryPathOpts = {
  proposal: ProposalDiscoveryInput;
  /** Tool names the connector may call (from allowedToolNames(grants)). Empty/undefined = treat all catalog tools as available when grants unknown (dev). */
  allowedTools?: ReadonlySet<string> | readonly string[] | null;
  /** Content-type strategy for first open entry; null/undefined → generic fit copy. */
  strategy?: ContentTypeStrategy | null;
};

function allowedSet(
  allowedTools: BuildProposalDiscoveryPathOpts["allowedTools"],
): Set<string> | null {
  if (allowedTools == null) return null;
  return allowedTools instanceof Set ? allowedTools : new Set(allowedTools);
}

function firstOpenEntry(proposal: ProposalDiscoveryInput) {
  const entries = proposal.entries ?? [];
  const pending = entries.find((e) => !e.status || e.status === "pending" || e.status === "failed");
  return pending ?? entries[0] ?? null;
}

function truncateConstraints(constraints: string[] | undefined, max = 4): string[] {
  if (!constraints?.length) return [];
  return constraints.slice(0, max).map((c) => (c.length > 160 ? `${c.slice(0, 157)}…` : c));
}

function buildEditsThinkItems(
  proposal: ProposalDiscoveryInput,
  strategy: ContentTypeStrategy | null | undefined,
): DiscoveryPathItem[] {
  const entry = firstOpenEntry(proposal);
  const entryLabel = entry
    ? `${entry.contentType}/${entry.slug} (${entry.locale}${entry.variant ? ` · ${entry.variant}` : ""})`
    : "the linked entries on this proposal";

  const strategyLookFor =
    strategy != null
      ? [
          `purpose: ${strategy.purpose}`,
          ...truncateConstraints(strategy.constraints).map((c) => `constraint: ${c}`),
          "reject or block if the change fights this purpose",
        ]
      : [
          "fit the role of this content type on the site",
          "do not invent a strategy — ask for type strategy if unclear",
        ];

  return [
    {
      kind: "think",
      id: "read_card",
      title: "Read what is already on this proposal",
      why: "Summary, blockers, and entries are already in this response — start here before calling tools.",
      look_for: [
        proposal.summary ? `summary: ${proposal.summary.slice(0, 200)}${proposal.summary.length > 200 ? "…" : ""}` : "summary and rationale",
        `open blockers: ${proposal.open_blocker_count ?? (Array.isArray(proposal.blockers) ? proposal.blockers.length : 0)}`,
        `entries: ${(proposal.entries ?? []).length}`,
      ],
    },
    {
      kind: "think",
      id: "deep_read",
      title: "Deep-read the page vs the proposed change",
      why: `Compare live/draft content for ${entryLabel} with what this proposal would change. Use page content already in context or MCP reads — do not invent MCP tools.`,
      look_for: [
        "does the edit match the stated summary",
        "regressions in clarity, CTAs, or structure",
        "you may use other chat capabilities outside this MCP if helpful",
      ],
    },
    {
      kind: "think",
      id: "audience_intent",
      title: "Audience and buyer intent",
      why: "Judge whether the change helps the intended reader. Host-agnostic — outside research is fine; do not invent an MCP tool for this.",
      look_for: ["job-to-be-done", "objections the copy should answer", "tone fit for the funnel stage"],
    },
    {
      kind: "think",
      id: "strategy_fit",
      title: "Fit to content-type strategy",
      why:
        strategy != null
          ? "Evaluate the proposal against this content type's documented strategy."
          : "No type strategy on file — use a generic fit check; do not invent strategy text.",
      look_for: strategyLookFor,
    },
    {
      kind: "think",
      id: "disposition",
      title: "Choose a disposition",
      why: "After optional research, decide apply, reject, or add_blocker — discovery is not a gate.",
      look_for: [
        "apply only when you would ship this yourself",
        "reject with a clear reason",
        "add_blocker for fixable feedback (min 80 chars: wrong / fixed looks like / why)",
      ],
    },
  ];
}

function buildNotesThinkItems(proposal: ProposalDiscoveryInput): DiscoveryPathItem[] {
  return [
    {
      kind: "think",
      id: "read_card",
      title: "Read the notes card",
      why: "Notes do not change YAML on close — understand the handoff before closing.",
      look_for: [
        proposal.summary ? `summary: ${proposal.summary.slice(0, 200)}${proposal.summary.length > 200 ? "…" : ""}` : "what was tried",
        "related issues and blockers",
      ],
    },
    {
      kind: "think",
      id: "close_disposition",
      title: "Close disposition",
      why: "Pick a close_reason that matches reality (wont_fix, fixed_elsewhere, tracked_elsewhere, other).",
      look_for: [
        "is work truly done elsewhere",
        "should this stay open for the next agent instead",
        "close_note when required",
      ],
    },
  ];
}

function buildToolItems(allowed: Set<string> | null): {
  items: DiscoveryPathToolItem[];
  anyCapped: boolean;
} {
  let anyCapped = false;
  const items: DiscoveryPathToolItem[] = EDITS_TOOLS.map((t) => {
    if (!CATALOG_NAMES.has(t.tool)) {
      throw new Error(`discovery tool not in catalog: ${t.tool}`);
    }
    const available = allowed == null ? true : allowed.has(t.tool);
    if (!available) anyCapped = true;
    return {
      kind: "tool" as const,
      id: t.id,
      tool: t.tool,
      why: t.why,
      look_for: t.look_for,
      available,
      ...(available ? {} : { hint: TOOL_UNAVAILABLE_HINT }),
    };
  });
  return { items, anyCapped };
}

/**
 * Returns discovery_path for a decidable single-proposal read, or null.
 */
export function buildProposalDiscoveryPath(
  opts: BuildProposalDiscoveryPathOpts,
): { discovery_path: DiscoveryPath | null; warnings: McpWarning[] } {
  const { proposal, strategy } = opts;
  const status = proposal.status;
  if (status !== "open" && status !== "partial") {
    return { discovery_path: null, warnings: [] };
  }

  const allowed = allowedSet(opts.allowedTools);
  const warnings: McpWarning[] = [];
  const kind = proposal.kind === "notes" ? "notes" : "edits";

  let think: DiscoveryPathItem[];
  let tools: DiscoveryPathToolItem[] = [];
  if (kind === "notes") {
    think = buildNotesThinkItems(proposal);
  } else {
    think = buildEditsThinkItems(proposal, strategy ?? null);
    const built = buildToolItems(allowed);
    tools = built.items;
    if (built.anyCapped) {
      warnings.push({
        code: DISCOVERY_TOOL_CAPPED,
        message:
          "One or more discovery research tools are not available on this role. See discovery_path items with available:false — ask a human to enable access, then refresh MCP.",
      });
    }
  }

  if (think.length > 5) {
    think = think.slice(0, 5);
  }

  const items: DiscoveryPathItem[] = [...think, ...tools];

  const discovery_path: DiscoveryPath = {
    goal:
      kind === "notes"
        ? "Optional context before close/withdraw. Not next_actions — you choose; skip does not block."
        : "Optional context before apply | reject | add_blocker. Not next_actions — you choose; skip does not block apply.",
    items,
    non_effects: [
      "Following discovery_path is optional; skip does not unlock or block update_proposal.",
      "discovery_path is not next_actions — do not treat items as required tool calls.",
    ],
  };

  return { discovery_path, warnings };
}

export function resolveStrategyForContentType(
  strategyRaw: unknown,
): ContentTypeStrategy | null {
  return parseContentTypeStrategy(strategyRaw);
}

/** Catalog names used by the edits discovery tool list (for tests). */
export function proposalDiscoveryToolNames(): string[] {
  return EDITS_TOOLS.map((t) => t.tool);
}
