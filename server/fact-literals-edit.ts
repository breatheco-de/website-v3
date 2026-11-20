/**
 * Sync (request-thread) exact-match fact-literal warnings for live selling-page edits.
 * No Jev here — paid layer runs via cue-invited on-save validation.
 */

import { evaluateClaimCues, textFromUnknown } from "./content-proposals/claim-cues";
import {
  buildLiteralIndex,
  findLiterals,
  funnelStageFromData,
  isNonCopyFieldPath,
  isSellingFunnelStage,
  pageProductSlugsFromFunnel,
  rankVariablesByProduct,
  sameFactLiteral,
  warningMessageForHit,
  type FactLiteralWarning,
  type LiteralHitStatus,
} from "./fact-literals";
import { audienceFromEntryData, audienceValuesFor } from "./page-audience";
import { setPendingFactLiteralsDelta } from "./pipeline-state";
import { getVariableManager, type VariableContext } from "./variable-manager";

export type FactLiteralFieldChange = {
  field_path: string;
  value: unknown;
};

export type EvaluateFactLiteralWarningsOpts = {
  contentRoot: string;
  /** Site id for pipeline_state (e.g. site_4geeks-com). */
  site?: string;
  entryKey?: string;
  /** Live locale write / publish / promote — not draft or variant. */
  isLiveWrite: boolean;
  /** Merged entry data for funnel.stage + products + audience. */
  entryData?: Record<string, unknown> | null;
  changes: FactLiteralFieldChange[];
  locale?: string;
  /**
   * When true (default), stash changed-field delta for cue-invited on-save.
   * Set false for dry-run promote/publish so nothing is queued.
   */
  stashForOnSave?: boolean;
};

function locationRegionsFromEntry(_entryData: Record<string, unknown> | null | undefined): Map<string, string> {
  return new Map();
}

/**
 * Exact catalog matches on changed fields. Also stashes delta for on-save invite when cues fire.
 */
export function evaluateFactLiteralWarnings(
  opts: EvaluateFactLiteralWarningsOpts,
): FactLiteralWarning[] {
  if (!opts.isLiveWrite) return [];
  const stage = funnelStageFromData(opts.entryData ?? undefined);
  if (!isSellingFunnelStage(stage)) return [];

  const delta = opts.changes
    .filter((c) => typeof c.field_path === "string" && c.field_path.trim())
    .map((c) => ({
      field_path: c.field_path.trim(),
      text: textFromUnknown(c.value),
    }))
    .filter((d) => d.text.trim() && !isNonCopyFieldPath(d.field_path));

  if (delta.length === 0) return [];

  // Stash for cue-invited on-save even when sync finds no exact hit (Jev layer may still run).
  const cueText = delta.map((d) => d.text).join("\n");
  const cue = evaluateClaimCues(cueText);
  if (
    opts.stashForOnSave !== false &&
    (cue === "clear_yes" || cue === "ambiguous") &&
    opts.site &&
    opts.entryKey
  ) {
    setPendingFactLiteralsDelta(opts.site, opts.entryKey, delta);
  }

  let defs: ReturnType<ReturnType<typeof getVariableManager>["getDefinitions"]>;
  let resolve: (name: string, ctx: VariableContext) => { value: string } | null;
  try {
    const vm = getVariableManager(opts.contentRoot);
    defs = vm.getDefinitions();
    resolve = (name, ctx) => vm.resolveVariable(name, ctx);
  } catch {
    return [];
  }

  const index = buildLiteralIndex(defs);
  const audience = audienceFromEntryData(opts.entryData, locationRegionsFromEntry(opts.entryData));
  const pageProducts = pageProductSlugsFromFunnel(opts.entryData?.funnel);
  const locale = opts.locale?.trim() || "en";
  const out: FactLiteralWarning[] = [];

  for (const d of delta) {
    for (const hit of findLiterals(d.text, index)) {
      const names = rankVariablesByProduct([...hit.names], defs, pageProducts);
      const perName = names.map((n) => ({
        name: n,
        ...audienceValuesFor(n, resolve, audience, locale, locationRegionsFromEntry(opts.entryData)),
      }));
      const exact = perName.find((p) => p.literal_ok != null && sameFactLiteral(p.literal_ok, hit.literal));
      const anyFixed = perName.find((p) => p.literal_ok !== null);
      const status: LiteralHitStatus = exact
        ? "token_recommended"
        : anyFixed
          ? "wrong_for_audience"
          : "varies";
      const variables = exact ? [exact.name, ...names.filter((n) => n !== exact.name)] : names;
      out.push({
        field_path: d.field_path,
        literal: hit.literal,
        kind: hit.kind,
        variables,
        status,
        message: warningMessageForHit({ literal: hit.literal, variables, status }),
      });
    }
  }

  return out;
}
