/**
 * Broken Anchor Links Validator
 *
 * Validates that anchor-style URLs (e.g. "#syllabus-modal", "#bottom") in
 * content files resolve to a `section_id` defined somewhere in the same file.
 *
 * Checks the following field names for anchor values:
 *   - url, cta_url, href, link
 *   - any key that ends in "_url" or "_href"
 */

import * as fs from "fs";
import * as yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { skipCrossEntryVariantRow } from "../shared/draftFiles";
import { BROKEN_ANCHORS_ISSUE_CODES } from "./broken-anchors.issueCodes";

const ANCHOR_FIELD_EXACT = new Set(["url", "cta_url", "href", "link"]);

function isAnchorField(key: string): boolean {
  if (ANCHOR_FIELD_EXACT.has(key)) return true;
  if (key.endsWith("_url") || key.endsWith("_href")) return true;
  return false;
}

function collectSectionIds(sections: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const section of sections) {
    if (section && typeof section === "object" && !Array.isArray(section)) {
      const s = section as Record<string, unknown>;
      if (typeof s.section_id === "string" && s.section_id.trim() !== "") {
        ids.add(s.section_id.trim());
      }
    }
  }
  return ids;
}

interface AnchorRef {
  value: string;
  fieldPath: string;
}

function collectAnchorRefs(obj: unknown, fieldPath: string, refs: AnchorRef[]): void {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectAnchorRefs(item, `${fieldPath}[${i}]`, refs));
    return;
  }

  const record = obj as Record<string, unknown>;
  for (const [key, val] of Object.entries(record)) {
    const childPath = fieldPath ? `${fieldPath}.${key}` : key;
    if (typeof val === "string") {
      if (isAnchorField(key) && val.startsWith("#") && val.length > 1) {
        refs.push({ value: val, fieldPath: childPath });
      }
    } else {
      collectAnchorRefs(val, childPath, refs);
    }
  }
}

export const brokenAnchorsValidator: Validator = {
  name: "broken-anchors",
  issueCodes: BROKEN_ANCHORS_ISSUE_CODES,
  description: "Validates that anchor URLs (#section) in content files resolve to a defined section_id",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "integrity",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const warnings: ValidationIssue[] = [];
    const errors: ValidationIssue[] = [];

    let filesScanned = 0;
    let anchorsChecked = 0;
    let brokenCount = 0;

    for (const contentFile of context.contentFiles) {
      if (skipCrossEntryVariantRow(contentFile)) continue;
      if (!contentFile.filePath || !fs.existsSync(contentFile.filePath)) continue;

      let parsed: unknown;
      try {
        const raw = fs.readFileSync(contentFile.filePath, "utf-8");
        parsed = yaml.load(raw);
      } catch {
        continue;
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;

      const doc = parsed as Record<string, unknown>;
      const sections = Array.isArray(doc.sections) ? doc.sections : [];

      const sectionIds = collectSectionIds(sections);

      const refs: AnchorRef[] = [];
      collectAnchorRefs(doc, "", refs);

      filesScanned++;
      anchorsChecked += refs.length;

      for (const ref of refs) {
        const target = ref.value.slice(1);
        if (!sectionIds.has(target)) {
          brokenCount++;
          warnings.push({
            type: "warning",
            code: "BROKEN_ANCHOR",
            message: `Anchor "${ref.value}" has no matching section_id in this file`,
            file: contentFile.filePath,
            suggestion: `Add \`section_id: ${target}\` to a section, or update the URL to point to an existing section_id`,
          });
        }
      }
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        filesScanned,
        anchorsChecked,
        brokenCount,
      },
    };
  },
};
