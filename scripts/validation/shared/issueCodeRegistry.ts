/**
 * Thin registry of per-validator issue code catalogs (no validator run() imports).
 */

import type { IssueCodeDefinition } from "./types";
import {
  SEO_CLUSTER_ISSUE_CODES,
  SEO_CLUSTER_VALIDATOR_NAME,
} from "../validators/seo-cluster.issueCodes";

/** Explicit map: add new `*.issueCodes.ts` modules here as catalogs grow. */
export const ISSUE_CODE_CATALOGS: Record<string, Record<string, IssueCodeDefinition>> = {
  [SEO_CLUSTER_VALIDATOR_NAME]: SEO_CLUSTER_ISSUE_CODES,
};

export function getIssueCodeDefinition(
  validator: string | undefined | null,
  code: string | undefined | null,
): IssueCodeDefinition | undefined {
  if (!validator || !code) return undefined;
  return ISSUE_CODE_CATALOGS[validator]?.[code];
}

/** Instance suggestion wins when non-empty; otherwise catalog default. */
export function resolveIssueSuggestion(
  validator: string | undefined | null,
  code: string | undefined | null,
  instanceSuggestion?: string | null,
): string | undefined {
  const trimmed = typeof instanceSuggestion === "string" ? instanceSuggestion.trim() : "";
  if (trimmed) return trimmed;
  const fromCatalog = getIssueCodeDefinition(validator, code)?.suggestion?.trim();
  return fromCatalog || undefined;
}

/** Throws if the same code string appears under two validators. */
export function assertUniqueIssueCodes(
  catalogs: Record<string, Record<string, IssueCodeDefinition>> = ISSUE_CODE_CATALOGS,
): void {
  const owners = new Map<string, string>();
  for (const [validator, codes] of Object.entries(catalogs)) {
    for (const code of Object.keys(codes)) {
      const prev = owners.get(code);
      if (prev && prev !== validator) {
        throw new Error(
          `Duplicate issue code "${code}" in validators "${prev}" and "${validator}"`,
        );
      }
      owners.set(code, validator);
    }
  }
}

export function hasIssueCodeInRegistry(validator: string, code: string): boolean {
  return Boolean(ISSUE_CODE_CATALOGS[validator]?.[code]);
}
