/**
 * MCP guidance when live SEO + editor.required gates block a write.
 * Agents often hit a circular trap (empty meta.description AND empty description)
 * and need update_fields to set both in one call.
 */

import {
  LIVE_REQUIRED_FIELDS_CODE,
  circularRequiredFieldsHint,
  isCircularDescriptionTrap,
  parseLiveRequiredMissingFields,
} from "../../shared/liveSeoGate.js";
import {
  actionRequired,
  fail,
  type McpTextResult,
  type NextAction,
} from "./respond.js";

export function isLiveRequiredFieldsError(
  errMsg: string,
  code?: unknown,
): boolean {
  if (code === LIVE_REQUIRED_FIELDS_CODE) return true;
  if (/CIRCULAR_REQUIRED_FIELDS/i.test(errMsg)) return true;
  if (/meta\.(page_title|description) is required/i.test(errMsg)) return true;
  if (/Field "[^"]+" is required for publish/i.test(errMsg)) return true;
  return false;
}

export function liveRequiredFieldsActionRequired(opts: {
  errMsg: string;
  code?: unknown;
  missingFields?: unknown;
  slug?: string;
  locale?: string;
  contentType?: string;
}): McpTextResult {
  const fromApi = Array.isArray(opts.missingFields)
    ? (opts.missingFields as unknown[]).filter((f): f is string => typeof f === "string")
    : [];
  const missing_fields =
    fromApi.length > 0 ? fromApi : parseLiveRequiredMissingFields(opts.errMsg);

  const hint = circularRequiredFieldsHint(missing_fields);
  const message = hint && !opts.errMsg.includes("CIRCULAR_REQUIRED_FIELDS")
    ? `${opts.errMsg} ${hint}`
    : opts.errMsg;

  const updatesHint = missing_fields.map((field_path) => ({
    field_path,
    value: `<non-empty value for ${field_path}>`,
  }));

  const next_actions: NextAction[] = [
    {
      tool: "update_fields",
      priority: "required",
      reason: isCircularDescriptionTrap(missing_fields)
        ? "Set meta.description and description (and any other missing required fields) in ONE call — single-field writes stay blocked while the other side is empty."
        : "Set all missing live-required fields in one atomic update_fields call.",
      args_hint: {
        slug: opts.slug,
        locale: opts.locale ?? "en",
        contentType: opts.contentType,
        confirm_live_edit: true,
        updates: updatesHint,
      },
    },
    {
      tool: "get_entry_seo",
      priority: "recommended",
      reason: "Inspect current meta.page_title / meta.description before rewriting.",
      args_hint: {
        slug: opts.slug,
        locale: opts.locale ?? "en",
        contentType: opts.contentType,
      },
    },
    {
      tool: "get_entry_content",
      priority: "recommended",
      reason: "Inspect editor.required body fields (e.g. title, description) before rewriting.",
      args_hint: {
        slug: opts.slug,
        locale: opts.locale ?? "en",
        contentType: opts.contentType,
      },
    },
  ];

  return actionRequired(
    {
      success: false,
      action_required: "fix_live_required_fields",
      code: LIVE_REQUIRED_FIELDS_CODE,
      message,
      missing_fields,
      details: {
        remedy:
          "Use update_fields with every missing path in updates[]. " +
          "update_meta_fields is multi-entry meta-only and cannot set body description.",
        non_effects:
          "Draft-only writes are exempt. This gate does not auto-copy description ↔ meta.description.",
      },
      warnings: [
        {
          code: "circular_required_fields",
          message:
            "Live SEO meta and editor.required fields are validated together. " +
            "When both sides are empty, only a multi-field write unblocks the save.",
        },
      ],
    },
    next_actions,
  );
}

/** Prefer structured actionRequired; fall back to fail for unrelated errors. */
export function editApiErrorResult(
  errMsg: string,
  data: Record<string, unknown>,
  ctx?: { slug?: string; locale?: string; contentType?: string },
): McpTextResult {
  if (isLiveRequiredFieldsError(errMsg, data.code)) {
    return liveRequiredFieldsActionRequired({
      errMsg,
      code: data.code,
      missingFields: data.missing_fields,
      slug: ctx?.slug,
      locale: ctx?.locale,
      contentType: ctx?.contentType,
    });
  }
  if (data.code === "seo_keyword_taken" || data.code === "seo_index_unavailable") {
    return fail(errMsg, {
      code: data.code,
      warnings: [
        {
          code: String(data.code),
          message:
            data.code === "seo_keyword_taken"
              ? "Live seo.main_keyword must be unique across the whole site (exact string after trim). Case differs are allowed. Current entry may keep its own keyword. Does not check drafts/variants."
              : "On-disk seo-index.json is missing or invalid — uniqueness cannot be verified. Rebuild the cluster index, then retry. No YAML write occurred.",
        },
      ],
      side_effects: [],
      next_actions: [
        {
          tool: "get_entry_seo",
          priority: "recommended" as const,
          reason: "Confirm current main_keyword before retrying.",
          args_hint: {
            slug: ctx?.slug,
            locale: ctx?.locale ?? "en",
            contentType: ctx?.contentType,
          },
        },
        ...(data.code === "seo_keyword_taken"
          ? [
              {
                tool: "list_seo_cluster_entries",
                priority: "optional" as const,
                reason: "Find which live entry already owns this exact keyword.",
                args_hint: { bucket: "clustered", q: errMsg },
              },
            ]
          : []),
      ],
    });
  }
  return fail(errMsg, data.code ? { code: data.code } : undefined);
}
