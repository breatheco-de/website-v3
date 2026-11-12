/**
 * Server-side orchestration for section identity validation (conversion / CTA / ecommerce).
 */

import { validateDocumentSectionsIdentity } from "@shared/validateSectionIdentity";
import { normalizeFunnelBlock } from "@shared/funnel";
import { readFunnelBlockFromFile, commonYmlPath } from "./funnel-fields";
import { getDefaultContentRoot } from "./site-config";
import { getTrackingSettings, getAuthSettings, getAuthConversionEventConfig } from "./settings";
import { loadAllFieldEditors, getComponentInfo } from "./component-registry";
import { ecommerceManager } from "./ecommerce/ecommerce-manager";
import { contentIndex } from "./content-index";
import { getContentTypeConfig } from "./content-types";
import { loadYamlWithTemplateVars } from "./yaml-parse-cache";
import { parseFormLocationPolicy, resolveFormLocationSource } from "@shared/formLocationPolicy";
import fs from "fs";

function readCommonYml(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const data = loadYamlWithTemplateVars(fs.readFileSync(filePath, "utf-8"));
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function makeProductResolver() {
  return (programId: string) => {
    const byCms = ecommerceManager.findProductByCmsEntry("program", programId);
    if (byCms) {
      return { product_id: byCms.product_id, active: byCms.actively_selling };
    }
    const bySlug = ecommerceManager.findProductByProgramId(programId);
    if (bySlug) return { product_id: bySlug.product_id, active: bySlug.actively_selling };
    const byId = ecommerceManager.getProduct(programId);
    if (byId) return { product_id: byId.product_id, active: byId.actively_selling };
    return undefined;
  };
}

export function validateDocIdentity(
  doc: Record<string, unknown>,
  opts: {
    contentType: string;
    contentSlug: string;
    skipIdentityIndexes?: Set<number>;
    /** Section saves: only check these indexes. Publish/full-list rewrites omit. */
    onlyValidateIndexes?: Set<number>;
    contentRoot?: string;
  },
): string | null {
  const root = opts.contentRoot ?? getDefaultContentRoot();
  const conversionNames = getTrackingSettings(root).conversion_events.map((e) => e.name);
  const signupFieldMap = getAuthSettings(root).signup?.field_map;
  const authConversion = getAuthConversionEventConfig(root);
  const allFieldEditors = loadAllFieldEditors();
  const funnel = normalizeFunnelBlock(
    readFunnelBlockFromFile(commonYmlPath(opts.contentType, opts.contentSlug, root)),
  );
  const locationPolicy = parseFormLocationPolicy(getContentTypeConfig(opts.contentType, root));
  const pageEntry = locationPolicy
    ? { ...readCommonYml(commonYmlPath(opts.contentType, opts.contentSlug, root)), ...doc }
    : null;
  return validateDocumentSectionsIdentity(doc, {
    pageSetsLocation: locationPolicy
      ? (form) => !!form && resolveFormLocationSource({ form, entry: pageEntry, policy: locationPolicy }).layer === "entry"
      : undefined,
    fieldEditorsByType: allFieldEditors,
    hasEcommerceBehavior: (sectionType) =>
      Boolean(getComponentInfo(sectionType)?.behaviors?.includes("ecommerce")),
    contentType: opts.contentType,
    contentSlug: opts.contentSlug,
    funnel,
    conversionNames,
    signupFieldMap,
    authConversion,
    resolveProduct: makeProductResolver(),
    skipIdentityIndexes: opts.skipIdentityIndexes,
    onlyValidateIndexes: opts.onlyValidateIndexes,
  });
}

/** Parse YAML string and validate identity fields. */
export function validateYamlIdentity(
  yamlText: string,
  opts: { contentType: string; contentSlug: string },
): string | null {
  const parsed = contentIndex.safeYamlLoad(yamlText) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    return "Invalid YAML content";
  }
  return validateDocIdentity(parsed, opts);
}
