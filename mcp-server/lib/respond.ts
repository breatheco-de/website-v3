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

export type McpTextResult = {
  content: [{ type: "text"; text: string }];
  isError?: true;
};

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
        "This content type uses a shared layout. Promoting a variant does not update sibling locale singles or other entries. The newly promoted live file may no longer match the shared layout structure. You must manually reconcile: either (A) edit the promoted live entry/locale so its structure aligns with the shared single.{locale}.yml peers, or (B) intentionally update the shared layout / other entries to adopt what this promoted variant introduced — then sync allowlisted structure across sibling locales via next_actions on those live shared-layout edits. Do not assume promote fixed shared layout.",
    });
  }
  return warnings;
}

/** Required follow-up after publish_draft / promote_variant — scoped hard refresh. */
export function diagnosticsAfterGoLiveNextAction(slug: string, site?: string): NextAction {
  return {
    tool: "run_entry_diagnostics",
    priority: "required",
    reason:
      "Hard-refresh diagnostics for the live page (async — then poll get_diagnostics_job)",
    args_hint: { slugs: [slug], freshness: "hard", confirm: true, ...(site ? { site } : {}) },
  };
}
