/**
 * Standard MCP response envelope helpers.
 *
 * Mutating tools should return ok() / actionRequired() so agents always see
 * structured warnings + next_actions (empty arrays when none).
 */

export type NextActionPriority = "required" | "recommended" | "optional";

export type NextAction = {
  tool: string;
  reason: string;
  args_hint?: Record<string, unknown>;
  priority?: NextActionPriority;
};

export type McpWarning = {
  code: string;
  message: string;
};

export type McpSideEffect = {
  kind: string;
  summary: string;
  /** Concrete relative file paths when known (rule 10 — not top-level detach/reattach `paths`). */
  paths?: string[];
};

/** Optional research menu — deepen judgment before a consequential next step (≠ next_actions). */
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
  /** When available === false: ask human to enable access, then refresh MCP. */
  hint?: string;
};

export type DiscoveryPathItem = DiscoveryPathThinkItem | DiscoveryPathToolItem;

export type DiscoveryPath = {
  goal: string;
  /** Prefer think items first, then tool items. */
  items: DiscoveryPathItem[];
  non_effects: string[];
};

export type McpTextResult = {
  content: [{ type: "text"; text: string }];
  isError?: true;
};

/** Assert tool names appear in the MCP tool catalog (next_actions / discovery tool items). */
export function assertCatalogToolNames(
  toolNames: string[],
  catalogNames: ReadonlySet<string> | readonly string[],
): { ok: true } | { ok: false; unknown: string[] } {
  const set = catalogNames instanceof Set ? catalogNames : new Set(catalogNames);
  const unknown = [...new Set(toolNames.filter((t) => !set.has(t)))];
  return unknown.length === 0 ? { ok: true } : { ok: false, unknown };
}

function textResult(payload: Record<string, unknown>, isError?: true): McpTextResult {
  const result: McpTextResult = {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
  if (isError) result.isError = true;
  return result;
}

/**
 * Success: always serializes warnings + next_actions (default []).
 * Caller may also pass side_effects / wrote on the payload itself.
 */
export function ok(
  payload: Record<string, unknown>,
  options?: {
    next_actions?: NextAction[];
    warnings?: McpWarning[];
    side_effects?: McpSideEffect[];
  },
): McpTextResult {
  const body: Record<string, unknown> = {
    success: true,
    ...payload,
    warnings: options?.warnings ?? (Array.isArray(payload.warnings) ? payload.warnings : []),
    next_actions:
      options?.next_actions ?? (Array.isArray(payload.next_actions) ? payload.next_actions : []),
  };
  if (options?.side_effects) {
    body.side_effects = options.side_effects;
  } else if (payload.side_effects === undefined) {
    // leave absent unless caller put side_effects on payload
  }
  return textResult(body);
}

/** Error: JSON message + details, isError: true. No next_actions. */
export function fail(
  message: string,
  details?: Record<string, unknown>,
): McpTextResult {
  return textResult(
    {
      success: false,
      message,
      ...(details ?? {}),
    },
    true,
  );
}

/**
 * Non-error gate (e.g. confirm_live_edit, confirm_layout_target).
 * May include next_actions for what to call next.
 */
export function actionRequired(
  payload: Record<string, unknown>,
  next_actions: NextAction[] = [],
): McpTextResult {
  return textResult({
    ...payload,
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    next_actions,
  });
}

/** Override on a database-sourced field: the source keeps its value but stops reaching the page. */
export function overrideMasksSourceWarning(field: string, writtenTo: string): McpWarning {
  return {
    code: "override_masks_source",
    message: `Source value unchanged. ${writtenTo} now takes priority over future source updates for ${field}; reset the field to follow the source again.`,
  };
}

/** Common variant-isolation warnings for create_variant / edits with variant set. */
export const VARIANT_WARNINGS: McpWarning[] = [
  {
    code: "variant_no_binding_propagate",
    message:
      "Edits to this variant do not propagate to section-binding siblings. Bindings only sync on live (non-variant) updates.",
  },
  {
    code: "variant_no_shared_layout_sync",
    message:
      "Variant structural edits are not synced to sibling locale singles or shared layout. Only this draft file is affected.",
  },
];

export function promoteWarnings(sharedLayout: boolean): McpWarning[] {
  const warnings: McpWarning[] = [
    {
      code: "promote_locale_only",
      message:
        "Promote copies this variant over the live file for this locale/entry only.",
    },
    {
      code: "promote_no_binding_replay",
      message:
        "Promote does not re-run binding propagation. If bound siblings must match the promoted content, update live bound sections (or edit live so propagate runs).",
    },
  ];
  if (sharedLayout) {
    warnings.push({
      code: "promote_shared_layout_drift",
      message:
        "This content type uses a shared layout. Promoting a variant does not update sibling locale templates or other entries. The newly promoted live file may no longer match the shared layout structure. You must manually reconcile: either (A) edit the promoted live entry/locale so its structure aligns with the shared template.{locale}.yml peers, or (B) intentionally update the shared layout / other entries to adopt what this promoted variant introduced — then sync allowlisted structure across sibling locales via next_actions on those live shared-layout edits. Do not assume promote fixed shared layout.",
    });
  }
  return warnings;
}

/**
 * next_actions for draft-first promote rejections (publish_draft / promote_variant).
 * `retryTool` is the tool that failed; confirm flags are only suggested after asking the user.
 */
export function promoteFailureNextActions(opts: {
  code: string | undefined;
  details?: Record<string, unknown>;
  retryTool: "publish_draft" | "promote_variant";
  contentType: string;
  slug: string;
  locale?: string;
  variantSlug: string;
  site?: string;
}): NextAction[] {
  const base = {
    contentType: opts.contentType,
    slug: opts.slug,
    ...(opts.locale ? { locale: opts.locale } : {}),
    variantSlug: opts.variantSlug,
    ...(opts.site ? { site: opts.site } : {}),
  };
  switch (opts.code) {
    case "draft_in_proposal": {
      const proposalId = opts.details?.proposal_id;
      return [
        {
          tool: "list_proposals",
          priority: "required",
          reason:
            "This draft belongs to an open proposal. Review and apply that proposal with update_proposal (four-eyes applies); do not publish the draft directly.",
          args_hint: { proposal_id: proposalId, ...(opts.site ? { site: opts.site } : {}) },
        },
      ];
    }
    case "proposal_required":
      return [
        {
          tool: "propose_change",
          priority: "required",
          reason: "Swarm roles never publish directly. Open an edits proposal with promote_on_apply so someone else applies it.",
          args_hint: { entries: [{ contentType: opts.contentType, slug: opts.slug, locale: opts.locale, variant: opts.variantSlug }] },
        },
      ];
    case "draft_base_stale":
    case "draft_base_unknown":
      return [
        {
          tool: opts.retryTool,
          priority: "recommended",
          reason:
            "Live changed after this draft was created (or the draft has no recorded base). Show the user details.conflicting_fields / live_changes_since_base; retry with confirm_overwrite_newer_live: true only after they agree to discard those live changes.",
          args_hint: { ...base, confirm_overwrite_newer_live: true },
        },
      ];
    case "translation_source_changed":
      return [
        {
          tool: opts.retryTool,
          priority: "recommended",
          reason:
            "The source locale changed after this translation was made. Update the translation, or retry with confirm_source_changed: true after the user agrees.",
          args_hint: { ...base, confirm_source_changed: true },
        },
      ];
    case "attached_draft_structure":
      return [
        {
          tool: "get_entry_content",
          priority: "required",
          reason: `Attached drafts may only change fields. Remove ${String(opts.details?.property_path ?? "sections/layout")} from the draft, or detach the entry first.`,
          args_hint: { contentType: opts.contentType, slug: opts.slug, locale: opts.locale, variant: opts.variantSlug },
        },
      ];
    default:
      return [];
  }
}

/** Required follow-up after publish_draft / promote_variant — scoped hard refresh. */
export function diagnosticsAfterGoLiveNextAction(slug: string, site?: string): NextAction {
  return {
    tool: "run_entry_diagnostics",
    priority: "required",
    reason:
      "Hard-refresh diagnostics for the live page (one slug — sync completed in that call; do not poll get_diagnostics_job)",
    args_hint: { slugs: [slug], freshness: "hard", confirm: true, ...(site ? { site } : {}) },
  };
}
