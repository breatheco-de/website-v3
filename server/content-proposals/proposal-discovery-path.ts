/**
 * Build discovery_path for list_proposals (single-id open|partial).
 * Prefer agent_preview think items from server review_context; fall back to kind-based defaults.
 */

import { parseContentTypeStrategy, type ContentTypeStrategy } from "../../shared/contentTypeStrategy.js";
import { TOOL_GATES } from "../../shared/mcp-tool-catalog.js";
import { buildEntryKey } from "../../scripts/validation/shared/entryKey.js";
import { hasTitleDescriptionOps } from "./proposal-review-rules.js";
import { discoveryContentLookForForSituations, type ReviewSituationId } from "./review-situations.js";

export type DiscoveryPathThinkItem = {
  kind: "think";
  id: string;
  title: string;
  why: string;
  look_for: string[];
};

export type DiscoveryPathToolItem = {
  kind: "tool";
  id: string;
  tool: string;
  why: string;
  look_for: string[];
  available: boolean;
  hint?: string;
  args_hint?: Record<string, unknown>;
};

export type DiscoveryPathItem = DiscoveryPathThinkItem | DiscoveryPathToolItem;

export type DiscoveryPath = {
  goal: string;
  items: DiscoveryPathItem[];
  non_effects: string[];
};

export type DiscoveryWarning = { code: string; message: string };

export const DISCOVERY_TOOL_CAPPED = "discovery_tool_capped";
/** Pending entries have filtered recent writes — inspect get_entry_activity before apply. */
export const RECENT_ENTRY_WRITES = "recent_entry_writes";

const CATALOG_NAMES = new Set(Object.keys(TOOL_GATES));

const RECENT_WRITES_LOOK_FOR = [
  "overlapping writers on the same fields this proposal touches (title/description / same paths)",
  "similar SERP fix already shipped and live not broken → SERP-only: reject duplicate_weaker; mixed: revise_entries to drop title/description ops then apply body",
  "unrelated recent body/CTA writes alone → do not reject",
  "only confirm/apply when live is still wrong or this change is clearly distinct",
];

const CORE_EDITS_TOOLS: Array<{
  id: string;
  tool: string;
  why: string;
  look_for: string[];
}> = [
  {
    id: "preview_content",
    tool: "get_entry_content",
    why: "See the page body the proposal would change.",
    look_for: [
      "proposed fields vs live copy",
      "broken CTAs or missing sections ops do not touch → adjacent_findings / notes, not default add_blocker",
    ],
  },
  {
    id: "recent_writes",
    tool: "get_entry_activity",
    why: "Check recent writes on the same fields before applying — stop title/description churn loops.",
    look_for: [...RECENT_WRITES_LOOK_FOR],
  },
  {
    id: "seo_context",
    tool: "get_entry_seo",
    why: "Review SEO/meta context for the entry.",
    look_for: [
      "title/description fit",
      "keyword or schema gaps",
      "keyword_metrics source/stale — prefer get_or_refresh_seo_research over inventing YAML kw_*",
    ],
  },
  {
    id: "diagnostics",
    tool: "run_entry_diagnostics",
    why: "Surface open validation issues on the entry.",
    look_for: [
      "issues the proposal claims to fix",
      "open issues ops do not touch → adjacent_findings / notes (same or other page), not default add_blocker",
    ],
  },
];

const ORGANIC_TOOL = {
  id: "traffic_risk",
  tool: "get_organic_traffic",
  why: "Gauge Search Console traffic risk before a go-live or high-visibility change.",
  look_for: ["high-traffic paths", "sudden drops after similar changes"],
} as const;

const IDEA_EXPLAIN_TOOL = {
  id: "idea_harm_playbook",
  tool: "explain_site",
  why: "Load the idea opportunity-vs-harm scorecard before accept or close.",
  look_for: [
    "Goal → Evidence → Fit → Brand → dilution",
    "incomplete brief → add_blocker; wrong vehicle → close and refile as edits",
    "accept ≠ live YAML; brand/figures ship on later edits",
  ],
} as const;

const TRANSLATION_EXPLAIN_TOOL = {
  id: "translation_playbook",
  tool: "explain_site",
  why: "Load the locale translation draft→promote scorecard before apply.",
  look_for: [
    "Fidelity → Completeness → Slug → Shell → promote honesty",
    "draft vs source locale — not punchier copy vs live English",
    "apply promotes the variant — does not AI-translate",
  ],
} as const;

const LIST_VARIANTS_TOOL = {
  id: "variant_layers",
  tool: "list_variants",
  why: "Confirm which non-public layers exist before promoting a translated draft.",
  look_for: [
    "named variant on the proposal matches a real draft layer",
    "allocation / traffic on that variant before go-live",
  ],
} as const;

const IDEA_ENTRY_SEO_TOOL = {
  id: "related_seo",
  tool: "get_entry_seo",
  why: "Optional: cluster membership and public path for a related page named on the idea.",
  look_for: [
    "pillar / include_in_clustering / locale",
    "is this a new spoke vs refresh of an existing slug",
  ],
} as const;

const IDEA_CLUSTER_ENTRIES_TOOL = {
  id: "cluster_siblings",
  tool: "list_seo_cluster_entries",
  why: "Optional: sibling spokes for cannibal / dilution check.",
  look_for: [
    "nearby spokes with the same angle",
    "hub vs spoke traffic roles before deleting or adding URLs",
  ],
} as const;

const IDEA_ORGANIC_TOOL = {
  id: "idea_traffic_risk",
  tool: "get_organic_traffic",
  why: "Optional: visit risk on related paths (e.g. hub deletion or busy sibling).",
  look_for: [
    "does the hub or sibling still carry clicks the brief claims are dead",
    "short visit dip vs lasting loss — evidence in brief or here",
  ],
} as const;

const FUNNEL_ANALYTICS_TOOL = {
  id: "journey_metrics",
  tool: "get_product_funnel_analytics",
  why: "Optional: product journey page performance (GA4) before applying selling/funnel changes.",
  look_for: ["weak journey stages", "path sessions vs conversions"],
} as const;

const LIST_PRODUCTS_TOOL = {
  id: "product_inventory",
  tool: "list_products",
  why: "See purchasable products and persona ids before judging funnel bindings.",
  look_for: [
    "which products have personas that match this content's buyer intent",
    "audience_status missing/minimal → product-only binding OK with warn; do not invent persona ids",
    "do not map broad topic to products:all without checking persona fit first",
  ],
} as const;

const GET_PRODUCT_TOOL = {
  id: "product_audience",
  tool: "get_product",
  why: "Read offer + personas for the product(s) this proposal binds — cascade starts at persona.",
  look_for: [
    "Persona: content intent vs persona id / who_its_for / avatar (pass|fail|warn)",
    "Product: proposed funnel.products follow that fit; multi-bind OK when two+ personas truly fit",
    "Stage: proposed funnel.stage matches readiness even if only stage or only products moved",
    "products:all only when no single product's personas fit better; all never carries personas",
  ],
} as const;

const SITE_ANALYTICS_TOOL = {
  id: "site_ga",
  tool: "get_analytics_report",
  why: "Optional: GA4 behavioral traffic for this page or site before applying a live change.",
  look_for: ["high-traffic paths", "baseline sessions/views"],
} as const;

const SEO_RESEARCH_SERP_TOOL = {
  id: "seo_research_serp",
  tool: "get_or_refresh_seo_research",
  why: "Optional: refresh live SERP snapshot for the entry main keyword (cache-first; budgeted).",
  look_for: [
    "featured snippet / PAA / organic rivals for the target query",
    "do not invent SERP features; action:serp only",
  ],
} as const;

const SEO_RESEARCH_IDEAS_TOOL = {
  id: "seo_research_ideas",
  tool: "get_or_refresh_seo_research",
  why: "Optional: keyword ideas around the page main keyword / seed (cache-first; budgeted).",
  look_for: [
    "related demand phrases for title/description or body angle",
    "action:keyword_ideas — not a substitute for get_organic_traffic",
  ],
} as const;

/** All tool names that may appear on a proposal discovery_path (for catalog checks). */
export function proposalDiscoveryToolNames(): string[] {
  return [
    ...CORE_EDITS_TOOLS.map((t) => t.tool),
    ORGANIC_TOOL.tool,
    FUNNEL_ANALYTICS_TOOL.tool,
    LIST_PRODUCTS_TOOL.tool,
    GET_PRODUCT_TOOL.tool,
    SITE_ANALYTICS_TOOL.tool,
    SEO_RESEARCH_SERP_TOOL.tool,
    SEO_RESEARCH_IDEAS_TOOL.tool,
    IDEA_EXPLAIN_TOOL.tool,
    TRANSLATION_EXPLAIN_TOOL.tool,
    LIST_VARIANTS_TOOL.tool,
    IDEA_ENTRY_SEO_TOOL.tool,
    IDEA_CLUSTER_ENTRIES_TOOL.tool,
    IDEA_ORGANIC_TOOL.tool,
  ];
}

const TOOL_UNAVAILABLE_HINT =
  "This tool is not on your MCP role. Ask a human to enable the needed access, then refresh/reconnect the MCP connector.";

export type ProposalDiscoveryEntry = {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
  status?: string;
  ops?: Array<{ field_path?: string } | null> | null;
};

export type ProposalDiscoveryInput = {
  id: string;
  status: string;
  kind: string;
  title?: string;
  summary?: string;
  escalated?: boolean;
  escalated_note?: string | null;
  entries?: ProposalDiscoveryEntry[];
  /** Idea context targets (slug may not exist yet). */
  related_entries?: Array<{
    contentType: string;
    slug: string;
    locale?: string;
  }>;
  open_blocker_count?: number;
  blockers?: unknown[];
};

export type RecentActivityForDiscovery = {
  entryKey: string;
  writeCount: number;
  windowDays: number;
};

export type AgentPreviewThink = {
  id: string;
  title: string;
  why: string;
  look_for: string[];
};

export type ReviewContextForDiscovery = {
  summary?: string;
  damage_class?: string;
  block_apply?: boolean;
  situation_changed_since_filed?: boolean;
  review_situations?: string[];
  agent_preview?: {
    think_items?: AgentPreviewThink[];
    warnings?: DiscoveryWarning[];
  };
};

export type BuildProposalDiscoveryPathOpts = {
  proposal: ProposalDiscoveryInput;
  allowedTools?: ReadonlySet<string> | readonly string[] | null;
  strategy?: ContentTypeStrategy | null;
  reviewContext?: ReviewContextForDiscovery | null;
  /** Gate-filtered activity rows (same semantics as apply confirm_recent_activity). */
  recentActivity?: RecentActivityForDiscovery[] | null;
};

function allowedSet(
  allowedTools: BuildProposalDiscoveryPathOpts["allowedTools"],
): Set<string> | null {
  if (allowedTools == null) return null;
  return allowedTools instanceof Set ? allowedTools : new Set(allowedTools);
}

function collectPendingFieldPaths(proposal: ProposalDiscoveryInput): string[] {
  const out: string[] = [];
  for (const e of proposal.entries ?? []) {
    if (e.status && e.status !== "pending" && e.status !== "failed") continue;
    for (const op of e.ops ?? []) {
      if (op && typeof op.field_path === "string" && op.field_path.trim()) {
        out.push(op.field_path.trim());
      }
    }
  }
  return out;
}

function pendingEntries(proposal: ProposalDiscoveryInput): ProposalDiscoveryEntry[] {
  const entries = proposal.entries ?? [];
  const pending = entries.filter((e) => !e.status || e.status === "pending" || e.status === "failed");
  return pending.length ? pending : entries.length ? [entries[0]!] : [];
}

/** Sum gate write counts for live + optional draft keys of one entry. */
export function activityWriteCountForEntry(
  entry: { contentType: string; slug: string; locale: string; variant?: string | null },
  recentActivity: RecentActivityForDiscovery[] | null | undefined,
): number {
  if (!recentActivity?.length) return 0;
  const live = buildEntryKey(entry.contentType, entry.slug, entry.locale);
  const draft = entry.variant?.trim()
    ? buildEntryKey(entry.contentType, entry.slug, entry.locale, entry.variant.trim())
    : null;
  let n = 0;
  for (const row of recentActivity) {
    if (row.entryKey === live || (draft && row.entryKey === draft)) {
      n += row.writeCount;
    }
  }
  return n;
}

export function pickHottestPendingEntry(
  proposal: ProposalDiscoveryInput,
  recentActivity: RecentActivityForDiscovery[] | null | undefined,
): ProposalDiscoveryEntry | null {
  const pending = pendingEntries(proposal);
  if (!pending.length) return null;
  let best = pending[0]!;
  let bestCount = -1;
  for (const e of pending) {
    const c = activityWriteCountForEntry(e, recentActivity);
    if (c > bestCount) {
      best = e;
      bestCount = c;
    }
  }
  return best;
}

export function buildRecentEntryWritesWarning(
  proposal: ProposalDiscoveryInput,
  recentActivity: RecentActivityForDiscovery[] | null | undefined,
): DiscoveryWarning | null {
  if (!recentActivity?.length) return null;
  const pending = pendingEntries(proposal);
  const parts: string[] = [];
  let windowDays = recentActivity[0]?.windowDays ?? 14;
  for (const e of pending) {
    const c = activityWriteCountForEntry(e, recentActivity);
    if (c <= 0) continue;
    const live = buildEntryKey(e.contentType, e.slug, e.locale);
    const draft = e.variant?.trim()
      ? buildEntryKey(e.contentType, e.slug, e.locale, e.variant.trim())
      : null;
    const label = draft ? `${live} (incl. draft): ${c}` : `${live}: ${c}`;
    parts.push(label);
    const row = recentActivity.find(
      (r) => r.entryKey === live || (draft && r.entryKey === draft),
    );
    if (row?.windowDays) windowDays = row.windowDays;
  }
  if (!parts.length) return null;
  return {
    code: RECENT_ENTRY_WRITES,
    message:
      `Recent writes (${windowDays}d, gate-filtered) on pending entries: ${parts.join("; ")}. ` +
      `Call get_entry_activity before apply. Same-field SERP churn + live not broken → reject duplicate_weaker (title/description-only) ` +
      `or revise_entries to drop title/description ops then apply (mixed). Unrelated body/CTA writes alone do not justify reject.`,
  };
}

function activityArgsHint(
  entry: ProposalDiscoveryEntry | null,
): Record<string, unknown> | undefined {
  if (!entry?.contentType || !entry.slug || !entry.locale) return undefined;
  return {
    contentType: entry.contentType,
    slug: entry.slug,
    locale: entry.locale,
    ...(entry.variant?.trim() ? { variant: entry.variant.trim() } : {}),
  };
}

function toToolItem(
  def: {
    id: string;
    tool: string;
    why: string;
    look_for: string[];
  },
  allowed: Set<string> | null,
  args_hint?: Record<string, unknown>,
): DiscoveryPathToolItem {
  if (!CATALOG_NAMES.has(def.tool)) {
    throw new Error(`discovery tool not in catalog: ${def.tool}`);
  }
  const available = allowed == null ? true : allowed.has(def.tool);
  return {
    kind: "tool",
    id: def.id,
    tool: def.tool,
    why: def.why,
    look_for: [...def.look_for],
    available,
    ...(available ? {} : { hint: TOOL_UNAVAILABLE_HINT }),
    ...(args_hint ? { args_hint } : {}),
  };
}

/**
 * Core content tools + at most 2 traffic tools:
 * always organic; second is funnel analytics (selling/funnel) else site GA (live public damage).
 * When prioritizeActivity, get_entry_activity is first among tools.
 */
export function buildEditsDiscoveryToolItems(opts: {
  allowed: Set<string> | null;
  damageClass?: string | null;
  pendingFieldPaths?: string[];
  entry?: { contentType: string; slug: string; locale?: string; variant?: string | null } | null;
  prioritizeActivity?: boolean;
  activityEntry?: ProposalDiscoveryEntry | null;
  /** Extra look_for lines prepended on get_entry_content (situation overlays). */
  contentLookFor?: string[];
  /** When funnel_classification is active, include list_products / get_product. */
  includeProductAudienceTools?: boolean;
  /** SERP title/description situations — optional research serp + ideas (≤2). */
  includeSeoResearchTools?: boolean;
  /** locale_translation — playbook + list_variants. */
  includeTranslationTools?: boolean;
}): { items: DiscoveryPathToolItem[]; anyCapped: boolean } {
  const {
    allowed,
    damageClass,
    pendingFieldPaths = [],
    entry,
    prioritizeActivity = false,
    activityEntry = null,
    includeProductAudienceTools = false,
    includeSeoResearchTools = false,
    includeTranslationTools = false,
  } = opts;

  const activityHint = activityArgsHint(activityEntry ?? (entry as ProposalDiscoveryEntry | null));
  const contentHint =
    entry?.contentType && entry.slug
      ? {
          contentType: entry.contentType,
          slug: entry.slug,
          ...(entry.locale ? { locale: entry.locale } : {}),
          ...(entry.variant?.trim() ? { variant: entry.variant.trim() } : {}),
        }
      : undefined;

  const core = CORE_EDITS_TOOLS.map((t) => {
    if (t.id === "recent_writes") {
      const look_for = includeProductAudienceTools
        ? [
            "overlapping writers on funnel.stage / funnel.products (same paths)",
            "similar funnel classification already shipped and live not broken → leave live or reject duplicate_weaker",
            "unrelated recent body/CTA writes alone → do not reject",
            ...t.look_for,
          ]
        : [...t.look_for];
      return toToolItem({ ...t, look_for }, allowed, activityHint);
    }
    if (t.id === "preview_content") {
      const look_for =
        opts.contentLookFor?.length
          ? [...opts.contentLookFor, ...t.look_for]
          : [...t.look_for];
      return toToolItem({ ...t, look_for }, allowed, contentHint);
    }
    return toToolItem(t, allowed, contentHint);
  });

  let items: DiscoveryPathToolItem[];
  if (prioritizeActivity) {
    const recent = core.find((t) => t.id === "recent_writes");
    const rest = core.filter((t) => t.id !== "recent_writes");
    items = recent ? [recent, ...rest] : [...core];
  } else {
    items = [...core];
  }

  if (includeTranslationTools) {
    items.unshift(
      toToolItem(TRANSLATION_EXPLAIN_TOOL, allowed, {
        topic: "proposals",
        subtopic: "translations",
      }),
    );
    if (entry?.contentType && entry.slug) {
      items.push(
        toToolItem(LIST_VARIANTS_TOOL, allowed, {
          contentType: entry.contentType,
          slug: entry.slug,
          ...(entry.locale ? { locale: entry.locale } : {}),
        }),
      );
    }
  }

  if (includeProductAudienceTools) {
    items.push(toToolItem(LIST_PRODUCTS_TOOL, allowed));
    items.push(toToolItem(GET_PRODUCT_TOOL, allowed));
  }

  items.push(toToolItem(ORGANIC_TOOL, allowed));

  const hasFunnelOp = pendingFieldPaths.some((p) => p === "funnel" || p.startsWith("funnel."));
  const sellingOrFunnel = damageClass === "selling_page" || hasFunnelOp;
  const livePublic =
    damageClass === "existing_metadata" ||
    damageClass === "existing_content" ||
    damageClass === "selling_page";

  if (sellingOrFunnel) {
    const productSlug =
      entry?.contentType === "program" || entry?.contentType === "programs"
        ? entry.slug
        : entry?.slug;
    items.push(
      toToolItem(FUNNEL_ANALYTICS_TOOL, allowed, productSlug ? { slug: productSlug } : undefined),
    );
  } else if (livePublic) {
    const args_hint =
      entry?.contentType && entry.slug
        ? {
            report: "page_detail",
            content_type: entry.contentType,
            slug: entry.slug,
            ...(entry.locale ? { locale: entry.locale } : {}),
          }
        : { report: "site_summary" };
    items.push(toToolItem(SITE_ANALYTICS_TOOL, allowed, args_hint));
  }

  if (includeSeoResearchTools && entry?.contentType && entry.slug) {
    const researchHint: Record<string, unknown> = {
      contentType: entry.contentType,
      slug: entry.slug,
      locale: entry.locale || "en",
    };
    items.push(
      toToolItem(SEO_RESEARCH_SERP_TOOL, allowed, { ...researchHint, action: "serp" }),
    );
    items.push(
      toToolItem(SEO_RESEARCH_IDEAS_TOOL, allowed, { ...researchHint, action: "keyword_ideas" }),
    );
  }

  const anyCapped = items.some((i) => !i.available);
  return { items, anyCapped };
}

/**
 * Idea discovery: playbook always; SEO/cluster/organic when related_entries exist.
 * Unavailable tools stay listed with available:false — skip never blocks accept.
 */
export function buildIdeaDiscoveryToolItems(opts: {
  allowed: Set<string> | null;
  related?: Array<{ contentType: string; slug: string; locale?: string }> | null;
}): { items: DiscoveryPathToolItem[]; anyCapped: boolean } {
  const { allowed, related } = opts;
  const items: DiscoveryPathToolItem[] = [
    toToolItem(IDEA_EXPLAIN_TOOL, allowed, {
      topic: "proposals",
      subtopic: "idea-opportunity-harm",
    }),
  ];

  const first = related?.find((r) => r.contentType?.trim() && r.slug?.trim()) ?? null;
  if (first) {
    const locale = first.locale?.trim() || "en";
    items.push(
      toToolItem(IDEA_ENTRY_SEO_TOOL, allowed, {
        contentType: first.contentType,
        slug: first.slug,
        locale,
      }),
    );
    items.push(
      toToolItem(IDEA_CLUSTER_ENTRIES_TOOL, allowed, {
        q: first.slug,
        bucket: "clustered",
      }),
    );
    items.push(
      toToolItem(IDEA_ORGANIC_TOOL, allowed, {
        mode: "paths",
        // Agent resolves public paths via get_entry_seo.urls when needed.
      }),
    );
  }

  const anyCapped = items.some((i) => !i.available);
  return { items, anyCapped };
}

function thinkFromPreview(items: AgentPreviewThink[]): DiscoveryPathItem[] {
  return items.slice(0, 6).map((t) => ({
    kind: "think" as const,
    id: t.id,
    title: t.title,
    why: t.why,
    look_for: t.look_for,
  }));
}

function fallbackNotesThink(proposal: ProposalDiscoveryInput): DiscoveryPathItem[] {
  return [
    {
      kind: "think",
      id: "read_card",
      title: "Read the notes card",
      why: "Notes do not change YAML on close — understand the handoff before closing.",
      look_for: [
        proposal.summary
          ? `summary: ${proposal.summary.slice(0, 200)}${proposal.summary.length > 200 ? "…" : ""}`
          : "what was tried",
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

function fallbackIdeaThink(proposal: ProposalDiscoveryInput): DiscoveryPathItem[] {
  return [
    {
      kind: "think",
      id: "idea_accept",
      title: "Accept greenlights a brief only",
      why: "Accept does not create pages or write YAML. Lock accepted_entry; follow-up is a later edits proposal with implements_proposal_id.",
      look_for: [
        proposal.summary
          ? `summary: ${proposal.summary.slice(0, 200)}${proposal.summary.length > 200 ? "…" : ""}`
          : "brief intent",
        "accepted_entry required (contentType, slug, locale)",
        "next_step is concrete (min 20 characters)",
        "follow-up edits use implements_proposal_id",
        "close/park means no — not yes",
      ],
    },
  ];
}

export function buildProposalDiscoveryPath(
  opts: BuildProposalDiscoveryPathOpts,
): { discovery_path: DiscoveryPath | null; warnings: DiscoveryWarning[] } {
  const { proposal, strategy: _strategy, reviewContext, recentActivity } = opts;
  const status = proposal.status;
  if (status !== "open" && status !== "partial") {
    return { discovery_path: null, warnings: [] };
  }

  const warnings: DiscoveryWarning[] = [];

  if (proposal.escalated) {
    warnings.push({
      code: "proposal_escalated",
      message:
        "A steward paused agent work on this proposal. Do not call update_proposal until they release the hold. " +
        (proposal.escalated_note
          ? `Note: ${proposal.escalated_note.slice(0, 240)}${proposal.escalated_note.length > 240 ? "…" : ""}`
          : "Read escalated_note on the proposal for why."),
    });
    return {
      discovery_path: {
        goal: "Steward hold — agents must not mutate this proposal. Skip discovery tools until released.",
        items: [
          {
            kind: "think",
            id: "steward_hold",
            title: "Respect the steward hold",
            why: "Escalate freezes all MCP update_proposal actions until a Platform Steward releases it in the staff UI.",
            look_for: [
              proposal.escalated_note
                ? `steward note: ${proposal.escalated_note.slice(0, 200)}${proposal.escalated_note.length > 200 ? "…" : ""}`
                : "escalated_note on the proposal",
              "do not claim, add_blocker, apply, reject, or revise",
            ],
          },
        ],
        non_effects: [
          "Following discovery_path is optional; skip does not unlock or block update_proposal.",
          "discovery_path is not next_actions — do not treat items as required tool calls.",
        ],
      },
      warnings,
    };
  }

  if (!proposal.escalated && proposal.escalated_note) {
    warnings.push({
      code: "proposal_escalated_history",
      message:
        "A steward previously paused agents on this proposal. Mutations are allowed again. " +
        `Prior note: ${proposal.escalated_note.slice(0, 240)}${proposal.escalated_note.length > 240 ? "…" : ""}`,
    });
  }

  const allowed = allowedSet(opts.allowedTools);

  if (reviewContext?.agent_preview?.warnings?.length) {
    warnings.push(...reviewContext.agent_preview.warnings);
  }

  const kind = proposal.kind === "notes" ? "notes" : proposal.kind === "idea" ? "idea" : "edits";

  let think: DiscoveryPathItem[] = [];
  const previewThink = reviewContext?.agent_preview?.think_items;
  if (previewThink?.length) {
    think = thinkFromPreview(previewThink);
  } else if (kind === "notes") {
    think = fallbackNotesThink(proposal);
  } else if (kind === "idea") {
    think = fallbackIdeaThink(proposal);
  } else {
    think = [
      {
        kind: "think",
        id: "read_card",
        title: "Read what is already on this proposal",
        why: "Summary, blockers, and entries are already in this response — start here before calling tools.",
        look_for: [
          proposal.summary
            ? `summary: ${proposal.summary.slice(0, 200)}${proposal.summary.length > 200 ? "…" : ""}`
            : "summary and rationale",
          `open blockers: ${proposal.open_blocker_count ?? 0}`,
          reviewContext?.summary ? `situation: ${reviewContext.summary.slice(0, 200)}` : "review situation",
        ],
      },
      {
        kind: "think",
        id: "disposition",
        title: "Choose a disposition",
        why: "After optional research, decide apply, reject, add_blocker, or park adjacent notes — discovery is not a gate.",
        look_for: [
          "apply only when you would ship this yourself",
          "add_blocker when the proposed change is wrong or invents claims (then revise_entries)",
          "out-of-scope live defects → adjacent_findings notes park; do not default every finding to add_blocker",
          "reject only for bad/impossible/illegal/harmful/duplicate/target missing — confirm_reject + reject_kind + note",
          "same-field SERP churn after recent title/description writes + live not broken → reject (SERP-only) or revise_entries to drop SERP ops then apply (mixed)",
        ],
      },
    ];
  }

  if (think.length > 6) think = think.slice(0, 6);

  let tools: DiscoveryPathToolItem[] = [];
  if (kind === "edits" && !reviewContext?.block_apply) {
    const pendingFieldPaths = collectPendingFieldPaths(proposal);
    const hasSerp = hasTitleDescriptionOps(proposal.entries ?? []);
    const hasFunnelOp = pendingFieldPaths.some((p) => p === "funnel" || p.startsWith("funnel."));
    const situations = (reviewContext?.review_situations ?? []) as ReviewSituationId[];
    const funnelClassification =
      situations.includes("funnel_classification") || hasFunnelOp;
    const localeTranslation = situations.includes("locale_translation");
    const contentLookFor = discoveryContentLookForForSituations(situations);
    const pending = pendingEntries(proposal);
    const gateWriteCount = pending.reduce(
      (s, e) => s + activityWriteCountForEntry(e, recentActivity),
      0,
    );
    const prioritizeActivity =
      hasSerp ||
      hasFunnelOp ||
      situations.includes("serp_title_description") ||
      situations.includes("funnel_classification") ||
      gateWriteCount > 0;

    const includeSeoResearchTools =
      hasSerp || situations.includes("serp_title_description");

    const hottest = pickHottestPendingEntry(proposal, recentActivity);
    const first = pending[0] ?? proposal.entries?.[0] ?? null;

    const activityWarn = buildRecentEntryWritesWarning(proposal, recentActivity);
    if (activityWarn) warnings.push(activityWarn);

    const built = buildEditsDiscoveryToolItems({
      allowed,
      damageClass: reviewContext?.damage_class,
      pendingFieldPaths,
      entry: first
        ? { contentType: first.contentType, slug: first.slug, locale: first.locale, variant: first.variant }
        : null,
      prioritizeActivity,
      activityEntry: hottest,
      contentLookFor,
      includeProductAudienceTools: funnelClassification,
      includeSeoResearchTools,
      includeTranslationTools: localeTranslation,
    });
    tools = built.items;
    if (built.anyCapped) {
      warnings.push({
        code: DISCOVERY_TOOL_CAPPED,
        message:
          "One or more discovery research tools are not available on this role. See discovery_path items with available:false — ask a human to enable access, then refresh MCP.",
      });
    }
  } else if (kind === "idea") {
    const built = buildIdeaDiscoveryToolItems({
      allowed,
      related: proposal.related_entries ?? null,
    });
    tools = built.items;
    if (built.anyCapped) {
      warnings.push({
        code: DISCOVERY_TOOL_CAPPED,
        message:
          "One or more discovery research tools are not available on this role. See discovery_path items with available:false — ask a human to enable access, then refresh MCP. Skip does not block accept or close.",
      });
    }
  }

  const goal =
    kind === "notes"
      ? "Optional context before close/withdraw. Not next_actions — you choose; skip does not block."
      : kind === "idea"
        ? "Optional context before accept | close. Not next_actions — skip does not block."
        : reviewContext?.block_apply
          ? "Target missing — apply is blocked. Prefer reject or withdraw. discovery_path is optional context only."
          : "Optional context before apply | reject | add_blocker. Not next_actions — you choose; skip does not block apply.";

  const discovery_path: DiscoveryPath = {
    goal,
    items: [...think, ...tools],
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
