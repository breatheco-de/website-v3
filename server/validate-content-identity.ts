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
    /** Draft/variant section saves: only check these indexes. Live/publish omit. */
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
  return validateDocumentSectionsIdentity(doc, {
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
