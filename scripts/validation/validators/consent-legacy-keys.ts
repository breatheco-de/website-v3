/**
 * Consent Legacy Keys Validator
 *
 * Flags any YAML file under `4geeks-com/` that contains `marketing_text:`
 * or `sms_text:` under a `consent:` key.
 *
 * These keys are obsolete — the lead form always resolves consent text through
 * `reserved.consent_marketing` / `reserved.consent_sms` and silently ignores
 * per-entry overrides. Re-introducing them would confuse editors and create
 * dead configuration.
 *
 * To fix: remove the `marketing_text:` / `sms_text:` lines from the affected
 * `consent:` block, or run:
 *   npx tsx scripts/admin/remove-consent-legacy-keys.ts --write
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { findObsoleteConsentKeys } from "../../../shared/consentLegacyKeys";
import { CONSENT_LEGACY_KEYS_ISSUE_CODES } from "./consent-legacy-keys.issueCodes";

const MARKETING_CONTENT_DIR = path.join(process.cwd(), "4geeks-com");

function walkYamlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkYamlFiles(fullPath));
    } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
      results.push(fullPath);
    }
  }
  return results;
}

export const consentLegacyKeysValidator: Validator = {
  name: "consent-legacy-keys",
  issueCodes: CONSENT_LEGACY_KEYS_ISSUE_CODES,
  description: "Flags obsolete marketing_text / sms_text keys inside consent: blocks",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "forms",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const yamlFiles = walkYamlFiles(MARKETING_CONTENT_DIR);

    for (const filePath of yamlFiles) {
      let parsed: unknown;
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        parsed = yaml.load(raw);
      } catch {
        continue;
      }

      if (!parsed || typeof parsed !== "object") continue;

      const hits = findObsoleteConsentKeys(parsed);

      if (hits.length === 0) continue;

      const relativePath = path.relative(process.cwd(), filePath);

      for (const hit of hits) {
        const keyList = hit.keys.map((k) => `\`${k}:\``).join(" and ");
        errors.push({
          type: "error",
          code: "CONSENT_OBSOLETE_KEY",
          message:
            `Obsolete consent key(s) ${keyList} found at ${hit.breadcrumb || "(root)"} in ${relativePath}. ` +
            `These keys are silently ignored — the lead form always falls back to ` +
            `\`reserved.consent_marketing\` / \`reserved.consent_sms\`. Remove them.`,
          file: relativePath,
          suggestion:
            "Remove the obsolete key(s) from the consent: block, or run: " +
            "npx tsx scripts/admin/remove-consent-legacy-keys.ts --write",
          fix: {
            type: "script",
            label: "Remove obsolete consent keys",
            command: "npx tsx scripts/admin/remove-consent-legacy-keys.ts --write",
          },
        });
      }
    }

    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : "passed",
      errors,
      warnings,
      duration: Date.now() - startTime,
    };
  },
};
