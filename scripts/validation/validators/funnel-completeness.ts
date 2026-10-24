/**
 * Funnel completeness validator — when site funnel.enforcement is on,
 * enforced content types require stage (+ products when site has purchasables)
 * and valid persona bindings.
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { skipCrossEntryVariantRow } from "../shared/draftFiles";
import { isSiteFunnelEnforcementEnabled, isFunnelEnforcedForType } from "../../../server/funnel-enforcement";
import { commonYmlPath, readFunnelBlockFromFile } from "../../../server/funnel-fields";
import { assertFunnelAudienceGates } from "../../../server/product/funnel-audience-gates";
import {
  FUNNEL_COMPLETENESS_ISSUE_CODES,
  FUNNEL_COMPLETENESS_VALIDATOR_NAME,
} from "./funnel-completeness.issueCodes";
import path from "path";
import { normalizeFunnelBlock } from "../../../shared/funnel";
import { measureFunnelTrackingLength } from "../../../shared/tracking-context";
import {
  findShortKeyConflicts,
  listMissingShortKeys,
  type ShortKeyConflict,
  type TrackingKeyProduct,
} from "../../../shared/tracking-keys";
import { loadTrackingKeyIndex } from "../../../server/product/tracking-key-index";
import { peekTrackingReady } from "../../../server/product/tracking-readiness";

const ASSIGN_KEYS_FIX = {
  type: "api" as const,
  label: "Assign suggested tracking keys",
  fixerName: "assign-tracking-short-keys",
};

/** Missing / duplicate tracking keys on this entry's product (reported on its _product.yml). */
function trackingKeyIssues(
  contentType: string,
  slug: string,
  contentRoot: string | undefined,
  products: TrackingKeyProduct[],
  conflicts: ShortKeyConflict[],
  ready: boolean,
): ValidationIssue[] {
  const product = products.find((p) => p.content_type === contentType && p.slug === slug);
  if (!product) return [];
  const file = path.join(path.dirname(commonYmlPath(contentType, slug, contentRoot)), "_product.yml");
  const issues: ValidationIssue[] = [];
  const missing = listMissingShortKeys([product]);
  if (missing.length > 0) {
    const names = missing.map((m) => (m.persona ? `persona ${m.persona}` : `product ${m.product}`)).join(", ");
    const code = ready ? "MISSING_TRACKING_SHORT_KEY" : "TRACKING_NOT_READY";
    issues.push({
      type: "warning",
      code,
      message: ready
        ? `No tracking key for ${names}, so reports show the full id instead of a code.`
        : `No tracking key for ${names}. Product and persona tracking stays off on this site until every product and persona has one.`,
      file,
      suggestion: FUNNEL_COMPLETENESS_ISSUE_CODES[code]?.suggestion,
      fix: ASSIGN_KEYS_FIX,
    });
  }
  for (const c of conflicts) {
    const mine = c.owners.filter((o) => o === slug || o.startsWith(`${slug}/`));
    if (mine.length === 0 || mine.every((o) => o.endsWith("(retired)"))) continue;
    issues.push({
      type: "warning",
      code: "DUPLICATE_TRACKING_SHORT_KEY",
      message: `Tracking key "${c.key}" (${c.type}) is used by ${c.owners.join(", ")}. Reports can't tell them apart.`,
      file,
      suggestion: FUNNEL_COMPLETENESS_ISSUE_CODES.DUPLICATE_TRACKING_SHORT_KEY?.suggestion,
    });
  }
  return issues;
}

const GATE_CODE_TO_ISSUE: Record<string, string> = {
  missing_funnel_stage: "MISSING_FUNNEL_STAGE",
  missing_funnel_products: "MISSING_FUNNEL_PRODUCTS",
  missing_product_audience: "MISSING_PRODUCT_AUDIENCE",
  missing_funnel_persona: "MISSING_FUNNEL_PERSONA",
  unknown_persona: "UNKNOWN_PERSONA",
};

export const funnelCompletenessValidator: Validator = {
  name: FUNNEL_COMPLETENESS_VALIDATOR_NAME,
  issueCodes: FUNNEL_COMPLETENESS_ISSUE_CODES,
  description:
    "When site funnel enforcement is on, requires funnel.stage (and products when the site has purchasables) plus valid personas on enforced content types. Always checks product/persona tracking keys and funnel values too long for Google Analytics",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "content",
  runClass: "entry-local",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const contentRoot = context.contentRoot;
    const enforced = isSiteFunnelEnforcementEnabled(contentRoot);
    const keyIndex = loadTrackingKeyIndex(contentRoot);
    const trackingReady = peekTrackingReady(contentRoot);
    const conflicts = findShortKeyConflicts(keyIndex.products);

    const seen = new Set<string>();
    for (const file of context.contentFiles) {
      if (skipCrossEntryVariantRow(file)) continue;
      const key = `${file.type}\0${file.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);

      warnings.push(...trackingKeyIssues(file.type, file.slug, contentRoot, keyIndex.products, conflicts, trackingReady));

      const filePath = commonYmlPath(file.type, file.slug, contentRoot);
      const funnel = readFunnelBlockFromFile(filePath);
      const length = measureFunnelTrackingLength(
        normalizeFunnelBlock(funnel),
        { contentType: file.type, contentSlug: file.slug },
        keyIndex,
      );
      if (length.over) {
        warnings.push({
          type: "warning",
          code: "TRACKING_VALUES_TOO_LONG",
          message: `Funnel products and personas add up to more than Google Analytics keeps (product ${length.product}, persona ${length.persona}, product_persona ${length.product_persona} of ${length.max} characters). Reports cut the list; leads and the CRM still get it all.`,
          file: filePath,
          suggestion: FUNNEL_COMPLETENESS_ISSUE_CODES.TRACKING_VALUES_TOO_LONG?.suggestion,
        });
      }

      if (!enforced || !isFunnelEnforcedForType(file.type, contentRoot)) continue;
      const gates = assertFunnelAudienceGates(funnel, {
        contentType: file.type,
        contentSlug: file.slug,
        contentRoot,
      });

      if (!gates.ok) {
        const issueCode = GATE_CODE_TO_ISSUE[gates.code] ?? gates.code.toUpperCase();
        errors.push({
          type: "error",
          code: issueCode,
          message: gates.error,
          file: filePath,
          suggestion: FUNNEL_COMPLETENESS_ISSUE_CODES[issueCode]?.suggestion,
        });
        continue;
      }

      for (const w of gates.warnings) {
        if (w.code === "inactive_product") {
          warnings.push({
            type: "warning",
            code: "INACTIVE_FUNNEL_PRODUCT",
            message: w.message,
            file: filePath,
            suggestion: FUNNEL_COMPLETENESS_ISSUE_CODES.INACTIVE_FUNNEL_PRODUCT?.suggestion,
          });
        }
      }
    }

    const status =
      errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed";

    return {
      name: FUNNEL_COMPLETENESS_VALIDATOR_NAME,
      description: funnelCompletenessValidator.description!,
      status,
      errors,
      warnings,
      duration: Date.now() - startTime,
      category: "content",
    };
  },
};
