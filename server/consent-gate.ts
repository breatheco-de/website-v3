/**
 * Publish gate: every lead form on the page must have at least one checkbox visitors must
 * tick (rule in `resolveConsentRequirement`). Publishing blocks; saving never does.
 * A site without a Default consent adds a site-level warning to every publish.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { escapeTemplateVars, unescapeObjectVars } from "@shared/templateVars";
import {
  CONSENT_REQUIRED_CODE,
  SITE_NO_DEFAULT_CONSENT_CODE,
  checkFormConsent,
  formObjectAtPath,
  type ConsentGateForm,
} from "@shared/formConsentCheck";
import { normalizeConsentFallbackKey } from "@shared/consent-settings";
import type { ConversionEventDefaults } from "@shared/resolveFormDefaults";
import { resolveBoundFormSettingsPath } from "@shared/wipeOnDuplicate";
import { getConsentFallback, getTrackingSettings } from "./settings";
import { loadAllFieldEditors } from "./component-registry";

const SKIP_DIRS = new Set(["component-registry", "node_modules", ".git", ".cache", "db", "media", "images"]);

function listYamlFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listYamlFiles(p, out);
    else if (/\.ya?ml$/.test(e.name) && e.name !== "settings.yml") out.push(p);
  }
  return out;
}

/**
 * Forms on this site (live and draft files, including form_overrides) that have no
 * mandatory checkbox of their own and rely on the Default consent. Read-only.
 */
export function countFormsRelyingOnDefault(contentRoot: string): { forms: number; files: number } {
  const root = path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot);
  const events = getTrackingSettings(contentRoot).conversion_events as ConversionEventDefaults[];
  const allEditors = loadAllFieldEditors(path.basename(root));
  let forms = 0;
  let files = 0;
  for (const file of listYamlFiles(root)) {
    let doc: unknown;
    try {
      const { escaped, map } = escapeTemplateVars(fs.readFileSync(file, "utf-8"));
      doc = unescapeObjectVars(yaml.load(escaped), map);
    } catch {
      continue;
    }
    const sections = doc && typeof doc === "object" ? (doc as Record<string, unknown>).sections : null;
    if (!Array.isArray(sections)) continue;
    let inFile = 0;
    for (const raw of sections) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const section = raw as Record<string, unknown>;
      const editors = allEditors[String(section.type ?? "")] ?? {};
      const variant = typeof section.variant === "string" ? section.variant : undefined;
      const form = formObjectAtPath(section, resolveBoundFormSettingsPath(editors, variant));
      if (!form) continue;
      inFile += checkFormConsent(form, events, null).filter((v) => v.reliesOnDefault).length;
    }
    if (inFile > 0) {
      forms += inFile;
      files++;
    }
  }
  return { forms, files };
}

export type ConsentGateResult = {
  failure: { code: typeof CONSENT_REQUIRED_CODE; message: string; forms: ConsentGateForm[] } | null;
  warnings: Array<{ code: string; message: string }>;
};

export function runConsentGate(opts: { pageData: Record<string, unknown>; contentRoot?: string }): ConsentGateResult {
  const sections = Array.isArray(opts.pageData.sections) ? opts.pageData.sections : [];
  const fallback = getConsentFallback(opts.contentRoot);
  const warnings: ConsentGateResult["warnings"] = [];
  if (!normalizeConsentFallbackKey(fallback)) {
    warnings.push({
      code: SITE_NO_DEFAULT_CONSENT_CODE,
      message:
        "This site has no Default consent (Settings → consent copy). Forms without a mandatory checkbox of their own can't be published until it is turned on.",
    });
  }
  if (sections.length === 0) return { failure: null, warnings };

  const events = getTrackingSettings(opts.contentRoot).conversion_events as ConversionEventDefaults[];
  const allEditors = loadAllFieldEditors(opts.contentRoot ? path.basename(opts.contentRoot) : undefined);
  const forms: ConsentGateForm[] = [];

  sections.forEach((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const section = raw as Record<string, unknown>;
    const editors = allEditors[String(section.type ?? "")] ?? {};
    const variant = typeof section.variant === "string" ? section.variant : undefined;
    const formPath = resolveBoundFormSettingsPath(editors, variant);
    const form = formObjectAtPath(section, formPath);
    if (!form) return;
    const base = formPath ? `sections[${i}].${formPath}` : `sections[${i}]`;
    const fixBase = formPath ? `sections.${i}.${formPath}` : `sections.${i}`;
    for (const v of checkFormConsent(form, events, fallback)) {
      if (v.required.length > 0) continue;
      forms.push({
        property_path: v.where === "form" ? base : `${base}.${v.where}`,
        fix_field_path: `${fixBase}.consent.general`,
        conversion_name: v.conversionName,
      });
    }
  });

  if (forms.length === 0) return { failure: null, warnings };
  return {
    failure: {
      code: CONSENT_REQUIRED_CODE,
      message:
        `${forms.length} form(s) on this page have no checkbox visitors must tick (${forms.map((f) => f.property_path).join(", ")}). ` +
        "Turn on the site Default consent in Settings, or turn on General or Marketing for the form or its conversion event. SMS, Email and WhatsApp are always optional.",
      forms,
    },
    warnings,
  };
}
