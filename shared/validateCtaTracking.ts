/**
 * CTA tracking validation for sections with field-editor `cta-tracking` paths.
 * Bound paths only — does not crawl arbitrary cta_* keys.
 */

import {
  isCtaTrackingValue,
  type CtaTrackingValue,
} from "./component-behaviors";

export type CtaPathResolver = (sectionType: string, variant?: string) => string[];

/** Strip variant prefixes (`course:signup_card.cta` → `signup_card.cta`) for the active variant. */
export function resolveBoundCtaPaths(
  fieldEditors: Record<string, string>,
  variant?: string,
): string[] {
  const paths: string[] = [];
  for (const [fieldPath, editorType] of Object.entries(fieldEditors)) {
    if (String(editorType).split(":")[0] !== "cta-tracking") continue;
    const colonIndex = fieldPath.indexOf(":");
    if (colonIndex > 0 && !fieldPath.startsWith("color-picker:")) {
      const variantPrefix = fieldPath.substring(0, colonIndex);
      const actual = fieldPath.substring(colonIndex + 1);
      if (!variant || variant === variantPrefix) paths.push(actual);
    } else {
      paths.push(fieldPath);
    }
  }
  return paths;
}

function getByPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.replace(/\[\]/g, ".$").split(".").filter(Boolean);
  return walk(obj, parts);
}

function walk(current: unknown, parts: string[]): unknown {
  if (parts.length === 0) return current;
  const [head, ...rest] = parts;
  if (head === "$") {
    if (!Array.isArray(current)) return undefined;
    return current.map((item) => walk(item, rest));
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
  return walk((current as Record<string, unknown>)[head!], rest);
}

function flattenCtaTargets(value: unknown): Array<{ pathHint: string; cta: Record<string, unknown> }> {
  const out: Array<{ pathHint: string; cta: Record<string, unknown> }> = [];
  const visit = (v: unknown, hint: string) => {
    if (Array.isArray(v)) {
      v.forEach((item, i) => visit(item, `${hint}[${i}]`));
      return;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (typeof o.url === "string" && typeof o.text === "string") {
        out.push({ pathHint: hint, cta: o });
      }
    }
  };
  visit(value, "");
  return out;
}

/**
 * Validate each CTA on bound `cta-tracking` paths has a valid `tracking` value.
 * Missing/empty fails — use `none` when no ecommerce event should fire.
 * Returns error message or null.
 */
export function validateCtaTracking(
  section: Record<string, unknown>,
  ctaPaths: string[],
): string | null {
  if (!ctaPaths.length) return null;
  const sectionType = String(section.type ?? "");

  for (const path of ctaPaths) {
    const raw = getByPath(section, path);
    if (raw === undefined) continue;
    const targets = flattenCtaTargets(raw);
    for (const { pathHint, cta } of targets) {
      const tracking = cta.tracking;
      if (tracking === undefined || tracking === null || tracking === "") {
        return `CTA at ${path}${pathHint} is missing required "tracking" (none | add_to_cart | click_begin_checkout) on ${sectionType || "section"}`;
      }
      if (!isCtaTrackingValue(tracking)) {
        return `CTA at ${path}${pathHint} has invalid tracking "${String(tracking)}". Valid: none, add_to_cart, click_begin_checkout`;
      }
    }
  }
  return null;
}

/** Bound CTAs whose tracking fires an enrollment click (anything but `none`). */
export function countTrackedCtas(section: Record<string, unknown>, ctaPaths: string[]): number {
  let n = 0;
  for (const path of ctaPaths) {
    const raw = getByPath(section, path);
    if (raw === undefined) continue;
    for (const { cta } of flattenCtaTargets(raw)) {
      if (isCtaTrackingValue(cta.tracking) && cta.tracking !== "none") n++;
    }
  }
  return n;
}

export type ProductResolveFn = (programId: string) => { product_id: string; active: boolean } | undefined;

/**
 * Non-none CTA tracking requires a resolvable purchasable product.
 */
export function validateCtaPurchasable(
  section: Record<string, unknown>,
  ctaPaths: string[],
  opts: {
    /** Content entry slug when editing a program page */
    contentSlug?: string;
    contentType?: string;
    resolveProduct: ProductResolveFn;
  },
): string | null {
  if (!ctaPaths.length) return null;
  const sectionType = String(section.type ?? "");

  for (const path of ctaPaths) {
    const raw = getByPath(section, path);
    if (raw === undefined) continue;
    const targets = flattenCtaTargets(raw);
    for (const { pathHint, cta } of targets) {
      const tracking = cta.tracking as CtaTrackingValue | undefined;
      if (!tracking || tracking === "none") continue;

      const programIds = collectProgramIdsForCta(section, cta, opts);
      if (programIds.length === 0) {
        return `CTA at ${path}${pathHint} has tracking "${tracking}" but no program/product id could be resolved on ${sectionType || "section"}. Set tracking to none, or link a purchasable program.`;
      }

      const resolved = programIds
        .map((id) => opts.resolveProduct(id))
        .find((p) => p && p.active);
      if (!resolved) {
        return `CTA at ${path}${pathHint} has tracking "${tracking}" but no purchasable product for program(s) [${programIds.join(", ")}]. Add _ecommerce.yml with purchasable: true, or set tracking to none.`;
      }
    }
  }
  return null;
}

function collectProgramIdsForCta(
  section: Record<string, unknown>,
  cta: Record<string, unknown>,
  opts: { contentSlug?: string; contentType?: string },
): string[] {
  const ids = new Set<string>();

  // From CTA URL ?program=
  const url = typeof cta.url === "string" ? cta.url : "";
  try {
    const u = new URL(url, "https://placeholder.local");
    const q = u.searchParams.get("program");
    if (q) ids.add(q);
  } catch {
    const m = url.match(/[?&]program=([^&]+)/);
    if (m?.[1]) ids.add(decodeURIComponent(m[1]));
  }

  // Program page context
  if (opts.contentType === "program" && opts.contentSlug) {
    ids.add(opts.contentSlug);
  }

  // Enrollment selector programs
  if (sectionTypeIs(section, "enrollment_selector") && Array.isArray(section.programs)) {
    for (const p of section.programs) {
      if (p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string") {
        ids.add((p as { id: string }).id);
      }
    }
  }

  return [...ids];
}

function sectionTypeIs(section: Record<string, unknown>, type: string): boolean {
  return String(section.type ?? "") === type;
}

export { getByPath, flattenCtaTargets };
