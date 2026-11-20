/**
 * Fact-literals validator (paid / cue-invited).
 *
 * Not in default Diagnostics or ENTRY_LOCAL_VALIDATOR_NAMES. On-save may append this
 * validator when metadata.onSaveInvite is "claim_cues" and gates pass: live write,
 * funnel.stage consideration|decision, claim cues clear_yes|ambiguous.
 *
 * Layer 1: exact catalog literal match (free). Layer 2: one-noul Jev when no exact hit
 * but copy still looks figure-ish (fail-open). Warn only — never blocks save/publish.
 * When context.factLiteralsDelta is set, scans that changed-field text only.
 */

import type {
  ValidationContext,
  ValidationIssue,
  Validator,
  ValidatorResult,
} from "../shared/types";
import { skipCrossEntryVariantRow } from "../shared/draftFiles";
import {
  askHardcodedSiteFactLiteral,
  getDecisionClient,
} from "../../../server/ai/decisions";
import {
  buildLiteralIndex,
  findLiterals,
  isNonCopyFieldPath,
  pageProductSlugsFromFunnel,
  rankVariablesByProduct,
  sameFactLiteral,
  warningMessageForHit,
  type LiteralHitStatus,
} from "../../../server/fact-literals";
import { evaluateClaimCues } from "../../../server/content-proposals/claim-cues";
import { audienceFromEntryData, audienceValuesFor } from "../../../server/page-audience";
import { getVariableManager, type VariableContext } from "../../../server/variable-manager";
import { getDefaultContentRoot } from "../../../server/site-config";
import {
  FACT_LITERALS_ISSUE_CODES,
  FACT_LITERALS_VALIDATOR_NAME,
} from "./fact-literals.issueCodes";

function resolveContentRoot(context: ValidationContext): string {
  if (context.contentRoot) {
    return context.contentRoot.startsWith("/")
      ? context.contentRoot
      : `${process.cwd()}/${context.contentRoot}`;
  }
  return getDefaultContentRoot();
}

function walkStrings(node: unknown, prefix: string, out: Array<{ path: string; text: string }>): void {
  if (typeof node === "string") {
    out.push({ path: prefix, text: node });
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => walkStrings(v, `${prefix}[${i}]`, out));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walkStrings(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
}

function codeForStatus(status: LiteralHitStatus): string {
  if (status === "wrong_for_audience") return "FACT_LITERAL_WRONG_AUDIENCE";
  if (status === "varies") return "FACT_LITERAL_VARIES";
  return "FACT_LITERAL_TOKEN_RECOMMENDED";
}

export const factLiteralsValidator: Validator = {
  name: FACT_LITERALS_VALIDATOR_NAME,
  issueCodes: FACT_LITERALS_ISSUE_CODES,
  description:
    "Warns when live selling-page copy hardcodes site facts (prices, hire rates, phones) instead of {{ global.* }} tokens. Paid: cue-invited on-save only; not in default Diagnostics.",
  apiExposed: true,
  estimatedDuration: "medium",
  category: "content",
  runClass: "decision",
  cost: "paid",
  onSaveInvite: "claim_cues",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const warnings: ValidationIssue[] = [];
    const contentRoot = resolveContentRoot(context);

    let defs: ReturnType<ReturnType<typeof getVariableManager>["getDefinitions"]>;
    let resolve: (name: string, ctx: VariableContext) => { value: string } | null;
    try {
      const vm = getVariableManager(contentRoot);
      defs = vm.getDefinitions();
      resolve = (name, ctx) => vm.resolveVariable(name, ctx);
    } catch {
      return {
        name: this.name,
        description: this.description,
        status: "passed",
        errors: [],
        warnings: [],
        duration: Date.now() - startTime,
        category: this.category,
      };
    }

    const index = buildLiteralIndex(defs);
    const locationRegions = new Map<string, string>();
    // Best-effort: locations from contentFiles of type location
    for (const f of context.contentFiles) {
      if (f.type === "location" && typeof f.entryFields?.region === "string") {
        locationRegions.set(f.slug, f.entryFields.region.trim());
      }
    }

    const delta = context.factLiteralsDelta;
    const pairs: Array<{ file?: string; field_path: string; text: string; entryData?: Record<string, unknown> }> =
      [];

    if (delta && delta.length > 0) {
      const firstFile = context.contentFiles.find((f) => !skipCrossEntryVariantRow(f));
      const entryData = firstFile
        ? ({ ...(firstFile.entryFields || {}), funnel: firstFile.entryFields?.funnel } as Record<
            string,
            unknown
          >)
        : {};
      for (const d of delta) {
        if (isNonCopyFieldPath(d.field_path)) continue;
        if (!d.text.trim()) continue;
        pairs.push({
          file: firstFile?.filePath,
          field_path: d.field_path,
          text: d.text,
          entryData,
        });
      }
    } else {
      for (const file of context.contentFiles) {
        if (skipCrossEntryVariantRow(file)) continue;
        const entryData = { ...(file.entryFields || {}) } as Record<string, unknown>;
        const strings: Array<{ path: string; text: string }> = [];
        walkStrings(entryData, "", strings);
        if (file.title) strings.push({ path: "title", text: String(file.title) });
        if (file.description) strings.push({ path: "description", text: String(file.description) });
        for (const { path: fieldPath, text } of strings) {
          if (isNonCopyFieldPath(fieldPath)) continue;
          if (!text.trim()) continue;
          pairs.push({ file: file.filePath, field_path: fieldPath, text, entryData });
        }
      }
    }

    let anyExact = false;
    const allTextParts: string[] = [];

    for (const pair of pairs) {
      allTextParts.push(pair.text);
      const hits = findLiterals(pair.text, index);
      if (hits.length === 0) continue;
      anyExact = true;
      const audience = audienceFromEntryData(pair.entryData, locationRegions);
      const pageProducts = pageProductSlugsFromFunnel(pair.entryData?.funnel);
      const locale =
        typeof pair.entryData?.locale === "string" ? pair.entryData.locale : "en";

      for (const hit of hits) {
        const names = rankVariablesByProduct([...hit.names], defs, pageProducts);
        const perName = names.map((n) => ({
          name: n,
          ...audienceValuesFor(n, resolve, audience, locale, locationRegions),
        }));
        const exact = perName.find((p) => p.literal_ok != null && sameFactLiteral(p.literal_ok, hit.literal));
        const anyFixed = perName.find((p) => p.literal_ok !== null);
        const status: LiteralHitStatus = exact
          ? "token_recommended"
          : anyFixed
            ? "wrong_for_audience"
            : "varies";
        const variables = exact ? [exact.name, ...names.filter((n) => n !== exact.name)] : names;
        const code = codeForStatus(status);
        warnings.push({
          type: "warning",
          code,
          message: warningMessageForHit({ literal: hit.literal, variables, status }),
          file: pair.file,
          suggestion: FACT_LITERALS_ISSUE_CODES[code]?.suggestion,
          category: this.category,
        });
      }
    }

    if (!anyExact && allTextParts.length > 0) {
      const joined = allTextParts.join("\n");
      const cue = evaluateClaimCues(joined);
      if (cue === "clear_yes" || cue === "ambiguous") {
        try {
          const { outcome } = await askHardcodedSiteFactLiteral(getDecisionClient(), joined);
          if (outcome === "yes") {
            warnings.push({
              type: "warning",
              code: "FACT_LITERAL_SUSPECTED",
              message:
                "Changed copy looks like a site fact (price, outcome, or company figure) without a matching variable token. Check list_variables before leaving a hardcoded number.",
              file: pairs[0]?.file,
              suggestion: FACT_LITERALS_ISSUE_CODES.FACT_LITERAL_SUSPECTED?.suggestion,
              category: this.category,
            });
          }
        } catch {
          // fail-open
        }
      }
    }

    return {
      name: this.name,
      description: this.description,
      status: warnings.length > 0 ? "warning" : "passed",
      errors: [],
      warnings,
      duration: Date.now() - startTime,
      category: this.category,
    };
  },
};
