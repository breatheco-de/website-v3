/**
 * Read validation-issue workflow knobs from site llm.yml.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { child } from "../logger";

const log = child({ module: "ai/validationIssuesConfig" });

export const DEFAULT_VALIDATION_ISSUE_MAX_ATTEMPTS = 5;
export const MAX_VALIDATION_ISSUE_MAX_ATTEMPTS = 20;

type LlmYamlSlice = {
  validation_issues?: {
    max_attempts?: unknown;
  };
};

/** Cap for prior release/TTL attempts per issue (llm.yml validation_issues.max_attempts). */
export function resolveValidationIssueMaxAttempts(contentRoot: string): number {
  try {
    const configPath = path.join(contentRoot, "llm.yml");
    if (!fs.existsSync(configPath)) return DEFAULT_VALIDATION_ISSUE_MAX_ATTEMPTS;
    const raw = fs.readFileSync(configPath, "utf-8");
    const cfg = yaml.load(raw) as LlmYamlSlice | null;
    const n = cfg?.validation_issues?.max_attempts;
    if (typeof n !== "number" || !Number.isFinite(n)) {
      return DEFAULT_VALIDATION_ISSUE_MAX_ATTEMPTS;
    }
    const rounded = Math.floor(n);
    if (rounded < 1) return DEFAULT_VALIDATION_ISSUE_MAX_ATTEMPTS;
    return Math.min(rounded, MAX_VALIDATION_ISSUE_MAX_ATTEMPTS);
  } catch (err) {
    log.warn({ err }, "[validationIssuesConfig] Failed to read max_attempts from llm.yml");
    return DEFAULT_VALIDATION_ISSUE_MAX_ATTEMPTS;
  }
}
