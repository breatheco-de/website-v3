/**
 * Conversion / ecommerce identity validation for save and publish.
 * Missing keys fail; explicit null (conversion / ecommerce_products) or CTA `none` means opted off.
 */

import {
  validateFormSection,
  validateRequiredConversionName,
} from "./validateFormSection";
import { validateSignupFormFields } from "./authSignupFieldMap";
import type { AuthSignupFieldMapEntry } from "./authSignupFieldMap";
import type { AuthConversionEventConfig } from "./authConversionEvents";
import {
  resolveBoundCtaPaths,
  validateCtaPurchasable,
  validateCtaTracking,
} from "./validateCtaTracking";
import { resolveBoundFormSettingsPath } from "./wipeOnDuplicate";
import {
  validateProductScope,
  type ProductResolveFn,
  type ProductScopeContext,
} from "./resolveProductScope";
import type { FunnelBlock } from "./funnel";

export type SectionIdentityOpts = {
  fieldEditors: Record<string, string>;
  hasEcommerceBehavior: boolean;
  contentType?: string;
  contentSlug?: string;
  funnel?: FunnelBlock | null;
  conversionNames?: string[];
  /** Site auth.signup.field_map for is_signup validation */
  signupFieldMap?: AuthSignupFieldMapEntry[] | null;
  /** Signup/login GTM names + aliases (membership for form conversion_name) */
  authConversion?: AuthConversionEventConfig | null;
  resolveProduct: ProductResolveFn;
  sectionIndex?: number;
  /** Skip conversion/CTA/product identity checks (e.g. freshly duplicated section). */
  skipIdentity?: boolean;
};

/**
 * Validate one section's conversion + CTA + product-scope identity.
 * Returns error message or null.
 */
export function validateSectionIdentity(
  section: Record<string, unknown>,
  opts: SectionIdentityOpts,
): string | null {
  const conversionNames = opts.conversionNames;
  const formErr = validateFormSection(section, conversionNames, opts.authConversion);
  if (formErr) return formErr;

  if (opts.skipIdentity) return null;

  const variant = typeof section.variant === "string" ? section.variant : undefined;
  const formSettingsPath = resolveBoundFormSettingsPath(opts.fieldEditors, variant);
  const convErr = validateRequiredConversionName(section, formSettingsPath);
  if (convErr) return convErr;

  if (formSettingsPath != null) {
    const formObj = (() => {
      if (!formSettingsPath) return section;
      const parts = formSettingsPath.split(".").filter(Boolean);
      let current: unknown = section;
      for (const part of parts) {
        if (!current || typeof current !== "object" || Array.isArray(current)) return null;
        current = (current as Record<string, unknown>)[part];
      }
      if (!current || typeof current !== "object" || Array.isArray(current)) return null;
      return current as Record<string, unknown>;
    })();
    const formLabel = formSettingsPath ? formSettingsPath : "form";
    const signupErr = validateSignupFormFields(
      formObj,
      opts.signupFieldMap,
      formLabel,
    );
    if (signupErr) return signupErr;
  }

  const ctaPaths = resolveBoundCtaPaths(opts.fieldEditors, variant);
  const trackingErr = validateCtaTracking(section, ctaPaths);
  if (trackingErr) return trackingErr;

  const purchasableErr = validateCtaPurchasable(section, ctaPaths, {
    contentSlug: opts.contentSlug,
    contentType: opts.contentType,
    resolveProduct: opts.resolveProduct,
  });
  if (purchasableErr) return purchasableErr;

  const scopeErr = validateProductScope(section, {
    contentSlug: opts.contentSlug,
    contentType: opts.contentType,
    funnel: opts.funnel,
    hasEcommerceBehavior: opts.hasEcommerceBehavior,
    ctaPaths,
    fieldEditors: opts.fieldEditors,
    resolveProduct: opts.resolveProduct,
    sectionIndex: opts.sectionIndex,
  });
  if (scopeErr) return scopeErr;

  return null;
}

export type DocumentIdentityOpts = {
  fieldEditorsByType: Record<string, Record<string, string>>;
  /** sectionType → has ecommerce behavior */
  hasEcommerceBehavior: (sectionType: string) => boolean;
  contentType?: string;
  contentSlug?: string;
  funnel?: FunnelBlock | null;
  conversionNames?: string[];
  signupFieldMap?: AuthSignupFieldMapEntry[] | null;
  authConversion?: AuthConversionEventConfig | null;
  resolveProduct: ProductResolveFn;
  skipIdentityIndexes?: Set<number>;
  /**
   * When set, only these section indexes are identity-checked (draft/variant
   * section saves). Publish/live omit this for full-document checks.
   */
  onlyValidateIndexes?: Set<number>;
};

/** Minimal op shape for collecting which section indexes a write touches. */
export type SectionIndexTouchOp = {
  action: string;
  index?: number;
  path?: string;
  from?: number;
  to?: number;
};

/**
 * Section indexes touched by edit ops, or `null` when an op rewrites / reorders
 * the whole sections list (caller must not scope identity validation).
 */
export function collectTouchedSectionIndexes(
  operations: SectionIndexTouchOp[],
): Set<number> | null {
  const indexes = new Set<number>();
  for (const op of operations) {
    if (op.action === "replace_all_sections" || op.action === "reorder_sections") {
      return null;
    }
    if (op.action === "update_section" && typeof op.index === "number") {
      indexes.add(op.index);
      continue;
    }
    if (
      (op.action === "add_item" || op.action === "remove_item") &&
      op.path === "sections"
    ) {
      if (typeof op.index === "number" && op.index >= 0) {
        indexes.add(op.index);
      }
      continue;
    }
    if (op.action === "update_field" && typeof op.path === "string") {
      const m = op.path.match(/^sections\.(\d+)(?:\.|$)/);
      if (m) indexes.add(Number(m[1]));
    }
  }
  return indexes;
}

/**
 * Validate sections in a locale/content document.
 * Returns first error prefixed with sections[i], or null.
 * When `onlyValidateIndexes` is set, siblings outside that set are skipped.
 */
export function validateDocumentSectionsIdentity(
  doc: Record<string, unknown>,
  opts: DocumentIdentityOpts,
): string | null {
  const sections = doc.sections;
  if (!Array.isArray(sections)) return null;

  for (let i = 0; i < sections.length; i++) {
    if (opts.onlyValidateIndexes && !opts.onlyValidateIndexes.has(i)) {
      continue;
    }
    const sec = sections[i];
    if (!sec || typeof sec !== "object" || Array.isArray(sec)) continue;
    const section = sec as Record<string, unknown>;
    const sectionType = String(section.type ?? "");
    const err = validateSectionIdentity(section, {
      fieldEditors: opts.fieldEditorsByType[sectionType] ?? {},
      hasEcommerceBehavior: opts.hasEcommerceBehavior(sectionType),
      contentType: opts.contentType,
      contentSlug: opts.contentSlug,
      funnel: opts.funnel,
      conversionNames: opts.conversionNames,
      signupFieldMap: opts.signupFieldMap,
      authConversion: opts.authConversion,
      resolveProduct: opts.resolveProduct,
      sectionIndex: i,
      skipIdentity: opts.skipIdentityIndexes?.has(i),
    });
    if (err) {
      return err.startsWith(`sections[${i}]`) ? err : `sections[${i}]: ${err}`;
    }
  }
  return null;
}

export type { ProductScopeContext };
