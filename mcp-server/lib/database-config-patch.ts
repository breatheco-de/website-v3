/**
 * Pure helpers for create_or_update_database config patch / confirm gate.
 * Keeps preview vs apply decisions testable without registering the MCP tool.
 */

import { deepMerge } from "./content.js";

export type DatabaseConfigSummary = {
  name: unknown;
  source_type: string | null;
  vector_search: unknown;
};

export type DatabaseConfigPatchPlan =
  | { ok: false; code: "invalid_merged_config"; message: string }
  | {
      ok: true;
      mode: "preview" | "apply";
      merged: Record<string, unknown>;
      beforeSummary: DatabaseConfigSummary;
      afterSummary: DatabaseConfigSummary;
      patch_keys: string[];
      needsReindex: boolean;
    };

function summarizeConfig(cfg: Record<string, unknown>): DatabaseConfigSummary {
  return {
    name: cfg.name,
    source_type: (cfg.source as { type?: string } | undefined)?.type ?? null,
    vector_search: cfg.vector_search ?? null,
  };
}

/** True when vector_search was enabled/changed such that reindex is recommended. */
export function vectorSearchPatchNeedsReindex(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  merged: Record<string, unknown>,
): boolean {
  const beforeVs = JSON.stringify(before.vector_search ?? null);
  const afterVs = JSON.stringify(merged.vector_search ?? null);
  const vectorTouched =
    Object.prototype.hasOwnProperty.call(patch, "vector_search") || beforeVs !== afterVs;
  const vectorEnabledAfter =
    merged.vector_search != null &&
    typeof merged.vector_search === "object" &&
    (merged.vector_search as { enabled?: boolean }).enabled === true;
  return vectorTouched && vectorEnabledAfter && beforeVs !== afterVs;
}

/**
 * Deep-merge patch into existing config. Without confirm:true → mode "preview"
 * (caller should return action_required: confirm_database_config_patch).
 * With confirm:true → mode "apply".
 */
export function planDatabaseConfigPatch(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  confirm?: boolean,
): DatabaseConfigPatchPlan {
  const merged = deepMerge(before, patch);
  if (typeof merged.name !== "string" || !merged.source || typeof merged.source !== "object") {
    return {
      ok: false,
      code: "invalid_merged_config",
      message: "Merged config must include name and source.",
    };
  }

  const needsReindex = vectorSearchPatchNeedsReindex(before, patch, merged);
  const shared = {
    ok: true as const,
    merged,
    beforeSummary: summarizeConfig(before),
    afterSummary: summarizeConfig(merged),
    patch_keys: Object.keys(patch),
    needsReindex,
  };

  if (confirm !== true) {
    return { ...shared, mode: "preview" };
  }
  return { ...shared, mode: "apply" };
}
