import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import * as fs from "fs";
import * as path from "path";
import { ORPHANED_FILES_ISSUE_CODES } from "./orphaned-files.issueCodes";

const CONTENT_ROOT = path.resolve("4geeks-com");

const KNOWN_ORPHANED_PATTERNS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /experiments\.yml$/,
    reason: "ExperimentManager has been removed; experiments.yml files are no longer read or used",
  },
];

function walkDir(dir: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, results);
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

export const orphanedFilesValidator: Validator = {
  name: "orphaned-files",
  issueCodes: ORPHANED_FILES_ISSUE_CODES,
  description: "Detects orphaned content files left behind by removed systems (e.g. experiments.yml)",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "integrity",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const allFiles = walkDir(CONTENT_ROOT);

    for (const filePath of allFiles) {
      const relative = path.relative(CONTENT_ROOT, filePath);
      for (const { pattern, reason } of KNOWN_ORPHANED_PATTERNS) {
        if (pattern.test(filePath)) {
          errors.push({
            type: "error",
            code: "ORPHANED_FILE",
            message: `Orphaned file: 4geeks-com/${relative}`,
            file: `4geeks-com/${relative}`,
            suggestion: `Delete this file. ${reason}`,
          });
        }
      }
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        filesScanned: allFiles.length,
        orphansFound: errors.length,
      },
    };
  },
};
