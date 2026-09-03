/**
 * Section Variants Validator
 *
 * Ensures section-level `variant` values in page/shared-template/overlay YAML
 * match keys declared in the component registry schema. Missing variant is OK
 * (treated as default at runtime). When schema.yml has no `variants` map, only
 * the implicit layout name `"default"` is allowed (matches SectionRenderer /
 * Zod). Nested CTA variants are ignored.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type {
  Validator,
  ValidatorResult,
  ValidationContext,
  ValidationIssue,
} from "../shared/types";
import { getDefaultContentFolder } from "../../../server/site-config";
import { SECTION_VARIANTS_ISSUE_CODES } from "./section-variants.issueCodes";

function registryRoot(contentRoot?: string): string {
  const folder = contentRoot
    ? path.basename(contentRoot)
    : getDefaultContentFolder();
  return path.join(process.cwd(), folder, "component-registry");
}

function loadVariantKeys(componentType: string, registryPath: string): string[] | null {
  const componentPath = path.join(registryPath, componentType);
  if (!fs.existsSync(componentPath)) return null;
  const versions = fs
    .readdirSync(componentPath)
    .filter((d) => {
      const p = path.join(componentPath, d);
      return fs.statSync(p).isDirectory() && d.startsWith("v");
    })
    .sort()
    .reverse();
  if (versions.length === 0) return null;
  const schemaPath = path.join(componentPath, versions[0]!, "schema.yml");
  if (!fs.existsSync(schemaPath)) return null;
  try {
    const schema = yaml.load(fs.readFileSync(schemaPath, "utf-8")) as {
      variants?: Record<string, unknown>;
    } | null;
    if (!schema?.variants || typeof schema.variants !== "object") return [];
    return Object.keys(schema.variants);
  } catch {
    return null;
  }
}

/**
 * Whether a section-level variant is allowed given keys from schema.yml `variants`.
 * Empty keys = single-file schema with no variants map → only implicit "default".
 */
export function isDeclaredOrImplicitDefaultVariant(
  variant: string,
  keys: string[],
): boolean {
  if (keys.length === 0) return variant === "default";
  return keys.includes(variant);
}

function checkSectionsInData(
  data: unknown,
  file: string,
  registryPath: string,
  cacheBuiltAt: string,
  errors: ValidationIssue[],
): void {
  if (!data || typeof data !== "object") return;
  const sections = (data as Record<string, unknown>).sections;
  if (!Array.isArray(sections)) return;

  sections.forEach((sec, idx) => {
    if (!sec || typeof sec !== "object") return;
    const rec = sec as Record<string, unknown>;
    if (typeof rec.type !== "string") return;
    if (typeof rec.variant !== "string" || !rec.variant.trim()) return;

    const variant = rec.variant.trim();
    const type = rec.type;
    const keys = loadVariantKeys(type, registryPath);
    if (keys === null) return; // unknown component type — other validators handle
    if (isDeclaredOrImplicitDefaultVariant(variant, keys)) return;

    if (keys.length === 0) {
      errors.push({
        type: "error",
        code: "UNKNOWN_SECTION_VARIANT",
        message: `Section [${idx}] type "${type}" sets variant "${variant}" but schema declares no variants (only implicit "default" is allowed)`,
        file,
        suggestion: `Use variant "default", remove variant, or add "${variant}" under variants: in the component schema. Cache built at ${cacheBuiltAt} — refresh diagnostics if this may be stale.`,
        validationCacheBuiltAt: cacheBuiltAt,
      });
      return;
    }

    errors.push({
      type: "error",
      code: "UNKNOWN_SECTION_VARIANT",
      message: `Section [${idx}] type "${type}" has unknown variant "${variant}"`,
      file,
      suggestion: `Valid variants: ${keys.join(", ")}. Cache built at ${cacheBuiltAt} — refresh diagnostics if this may be stale.`,
      validationCacheBuiltAt: cacheBuiltAt,
    });
  });
}

export const sectionVariantsValidator: Validator = {
  name: "section-variants",
  issueCodes: SECTION_VARIANTS_ISSUE_CODES,
  description:
    "Validates section-level variant fields against component registry schema keys",
  apiExposed: true,
  estimatedDuration: "medium",
  category: "components",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const cacheBuiltAt = new Date().toISOString();
    const registryPath = registryRoot(context.contentRoot);

    for (const file of context.contentFiles) {
      try {
        if (!fs.existsSync(file.filePath)) continue;
        const raw = fs.readFileSync(file.filePath, "utf-8");
        const parsed = yaml.load(raw);
        checkSectionsInData(parsed, file.filePath, registryPath, cacheBuiltAt, errors);
      } catch {
        /* skip unreadable */
      }
    }

    // Shared templates (single.*.yml) at content-type roots
    const contentRoot = context.contentRoot || path.join(process.cwd(), getDefaultContentFolder());
    try {
      const dirs = fs.readdirSync(contentRoot, { withFileTypes: true });
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const dirPath = path.join(contentRoot, d.name);
        for (const name of [
          "template.en.yml",
          "template.es.yml",
          "single.en.yml",
          "single.es.yml",
          "_common.template.yml",
          "_common.single.yml",
        ]) {
          const fp = path.join(dirPath, name);
          if (!fs.existsSync(fp)) continue;
          try {
            const parsed = yaml.load(fs.readFileSync(fp, "utf-8"));
            checkSectionsInData(parsed, fp, registryPath, cacheBuiltAt, errors);
          } catch {
            /* skip */
          }
        }
      }
    } catch {
      /* skip */
    }

    // Overlays
    const overlaysPath = path.join(contentRoot, "overlays.yml");
    if (fs.existsSync(overlaysPath)) {
      try {
        const parsed = yaml.load(fs.readFileSync(overlaysPath, "utf-8")) as {
          overlays?: unknown[];
        } | null;
        const list = Array.isArray(parsed?.overlays) ? parsed!.overlays! : [];
        list.forEach((item, idx) => {
          if (!item || typeof item !== "object") return;
          checkSectionsInData(item, `${overlaysPath}#${idx}`, registryPath, cacheBuiltAt, errors);
        });
      } catch {
        /* skip */
      }
    }

    const status =
      errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed";

    return {
      name: this.name,
      description: this.description,
      status,
      errors,
      warnings,
      duration: Date.now() - startTime,
      artifacts: { validationCacheBuiltAt: cacheBuiltAt },
    };
  },
};
