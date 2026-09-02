/**
 * Shared helpers for MCP mutating page tools: live-edit gate, layout_target,
 * edit-sections API wrappers, and next_actions builders.
 */

import { z } from "zod";
import { AGENT_REPORT_MUTATE_DESC } from "./agent-report.js";
import {
  loadVersioning,
  isSharedLayoutConfig,
  type ContentTypeConfig,
} from "./content.js";
import {
  listSiblingSingleLocales,
  confirmLayoutTargetPayload,
  siblingSingleStructuralActions,
  sharedTemplateBlastSideEffect,
  localeSiblingSyncSideEffect,
  type LayoutTarget,
} from "./shared-layout.js";
import {
  LAYOUT_TARGET_TYPE_TEMPLATE,
  isTypeLayoutTarget,
  liveTemplateBasename,
} from "@shared/sharedLayoutPaths";
import {
  ok,
  fail,
  actionRequired,
  VARIANT_WARNINGS,
  type McpTextResult,
  type NextAction,
  type McpWarning,
  type McpSideEffect,
} from "./respond.js";

export const LAYOUT_TARGET_DESC =
  'For shared-layout types (DB-backed or single_template): "auto" (default) may ask confirm_layout_target; ' +
  '"type_template" (alias "type_single") writes template.{locale}.yml (all entries); "entry" writes only this entry overlay.';

/** Zod fields for MCP content mutates that hit edit-sections / edit-common APIs. */
export const mutateReportZodFields = {
  report: z.string().describe(AGENT_REPORT_MUTATE_DESC),
  agent_session_id: z
    .string()
    .optional()
    .describe("Optional. From agent_session start — groups this write for staff monitoring."),
};

export function requireMutateReport(
  report: unknown,
): { ok: true; trimmedReport: string } | { ok: false; result: McpTextResult } {
  const trimmedReport = typeof report === "string" ? report.trim() : "";
  if (trimmedReport.length < 80) {
    return {
      ok: false,
      result: actionRequired(
        {
          success: false,
          action_required: "report_required",
          code: trimmedReport ? "report_too_short" : "report_required",
          message:
            "report required (min 80 characters): explain what you are changing and why. " +
            "For copy you set, list plain values (Title: …); do not paste JSON/YAML.",
        },
        [],
      ),
    };
  }
  return { ok: true, trimmedReport };
}

export function confirmLiveEditGate(opts: {
  tool: string;
  slug: string;
  contentType: string;
  locale: string;
  contentPath: string;
  variant?: string;
  confirm_live_edit?: boolean;
  extraArgsHint?: Record<string, unknown>;
}): McpTextResult | null {
  if (opts.variant || opts.confirm_live_edit) return null;
  const versioning = loadVersioning(opts.contentType, opts.slug, opts.contentPath);
  if (!versioning) return null;
  const availableVariants = Object.entries(versioning).flatMap(([loc, data]) =>
    (data.variants || []).map((v) => ({ locale: loc, slug: v.slug, allocation: v.allocation })),
  );
  return actionRequired(
    {
      action_required: "confirm_live_edit",
      message:
        `Page '${opts.slug}' has active variants. Before editing the live version, please ask the user: ` +
        `"Do you want to edit the live version directly, or create a new draft variant first?" ` +
        `To edit the live version, re-call with confirm_live_edit: true. ` +
        `To edit a draft, call create_variant then re-call with variant: <variantSlug>.`,
      available_variants: availableVariants,
      options: [
        "Pass confirm_live_edit: true to overwrite the live locale file directly",
        "Call create_variant to create a draft, then pass variant: <variantSlug> to edit the draft instead",
      ],
    },
    [
      {
        tool: "create_variant",
        priority: "recommended",
        reason: "Create a draft variant instead of editing live.",
        args_hint: {
          contentType: opts.contentType,
          slug: opts.slug,
          locale: opts.locale,
        },
      },
      {
        tool: opts.tool,
        priority: "optional",
        reason: "Re-call this tool with confirm_live_edit: true to edit live.",
        args_hint: {
          slug: opts.slug,
          locale: opts.locale,
          contentType: opts.contentType,
          confirm_live_edit: true,
          ...(opts.extraArgsHint ?? {}),
        },
      },
    ],
  );
}

/**
 * Resolve layout_target for shared-layout types.
 * Structural / ambiguous ops with auto → confirm_layout_target gate.
 */
export function resolveLayoutTargetGate(opts: {
  tool: string;
  contentType: string;
  config: ContentTypeConfig;
  slug: string;
  locale: string;
  layout_target?: LayoutTarget;
  confirm_layout_target?: boolean;
  /** When true, auto is treated as ambiguous and requires confirm. */
  requireConfirmWhenAuto: boolean;
}): { target: "entry" | "type_template" | "type_single" } | { gate: McpTextResult } {
  if (!isSharedLayoutConfig(opts.config)) {
    return { target: "entry" };
  }
  const raw = opts.layout_target ?? "auto";
  if (raw === "entry" || isTypeLayoutTarget(raw)) {
    return { target: raw === "entry" ? "entry" : raw };
  }
  // auto
  if (opts.confirm_layout_target && opts.requireConfirmWhenAuto) {
    // confirm without explicit target is invalid
    return {
      gate: fail(
        'layout_target must be "entry" or "type_template" when confirm_layout_target is set',
      ),
    };
  }
  if (opts.requireConfirmWhenAuto) {
    return {
      gate: actionRequired(
        confirmLayoutTargetPayload({
          contentType: opts.contentType,
          slug: opts.slug,
          locale: opts.locale,
          tool: opts.tool,
        }),
        [
          {
            tool: opts.tool,
            priority: "required",
            reason: 'Re-call with layout_target: "type_template" or "entry".',
            args_hint: {
              contentType: opts.contentType,
              slug: opts.slug,
              locale: opts.locale,
              layout_target: LAYOUT_TARGET_TYPE_TEMPLATE,
              confirm_layout_target: true,
            },
          },
        ],
      ),
    };
  }
  // Unambiguous content-only path: default to entry overlay
  return { target: "entry" };
}

export function variantWarningsIfNeeded(variant?: string): McpWarning[] {
  return variant ? [...VARIANT_WARNINGS] : [];
}

export function wrotePayload(opts: {
  layer: "entry_locale" | "type_single" | "type_template" | "variant";
  contentType: string;
  path: string;
  locale: string;
  section_id?: string;
  slug?: string;
}): Record<string, unknown> {
  return {
    wrote: {
      layer: opts.layer,
      contentType: opts.contentType,
      path: opts.path,
      locale: opts.locale,
      ...(opts.slug ? { slug: opts.slug } : {}),
      ...(opts.section_id ? { section_id: opts.section_id } : {}),
    },
  };
}

/** Structural success envelope pieces for shared-layout type_template writes (alias type_single). */
export function sharedStructuralEnvelope(opts: {
  tool: string;
  contentType: string;
  config: ContentTypeConfig;
  contentPath: string;
  sourceLocale: string;
  relativePath: string;
  argsHintBase: Record<string, unknown>;
  reasonPrefix: string;
}): {
  side_effects: McpSideEffect[];
  next_actions: NextAction[];
} {
  const siblings = listSiblingSingleLocales(
    opts.contentType,
    opts.sourceLocale,
    opts.contentPath,
    opts.config,
  );
  const side_effects: McpSideEffect[] = [
    sharedTemplateBlastSideEffect(opts.contentType, opts.sourceLocale),
  ];
  if (siblings.length > 0) {
    side_effects.push(
      localeSiblingSyncSideEffect(
        `Allowlisted structure must also be applied to sibling shells (${siblings
          .map((l) => liveTemplateBasename(l))
          .join(", ")}). Do not copy marketing copy.`,
      ),
    );
  }
  return {
    side_effects,
    next_actions: siblingSingleStructuralActions({
      tool: opts.tool,
      contentType: opts.contentType,
      sourceLocale: opts.sourceLocale,
      siblingLocales: siblings,
      reasonPrefix: opts.reasonPrefix,
      argsHintBase: opts.argsHintBase,
    }),
  };
}

export { ok, fail, actionRequired, VARIANT_WARNINGS };
export type { LayoutTarget, McpTextResult, NextAction, McpWarning, McpSideEffect };
