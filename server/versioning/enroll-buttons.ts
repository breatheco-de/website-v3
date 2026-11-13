/**
 * Tracked enrollment buttons per test version: bound `cta-tracking` CTAs whose tracking is
 * not `none`. Purchasable products are already enforced on save (`validateCtaPurchasable`),
 * so only the tracking value is checked. Used to warn when an "Enrollment clicks" goal can't move.
 */

import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import { countTrackedCtas, resolveBoundCtaPaths } from "@shared/validateCtaTracking";
import { escapeTemplateVars, unescapeObjectVars } from "@shared/templateVars";
import { TEST_DEFAULT_VERSION } from "@shared/page-stats";
import { loadAllFieldEditors } from "../component-registry";
import { liveLocaleFileName } from "../draft-entry";
import { isTemplateVersioningSlug } from "../shared-layout-entry";
import type { VersioningManager } from "./VersioningManager";
import { child } from "../logger";

const log = child({ module: "versioning/enroll-buttons" });

type FieldEditorsByType = Record<string, Record<string, string>>;

/** Tracked CTAs across a page's sections (each section's own variant decides its bound paths). */
export function countTrackedEnrollButtons(sections: unknown, fieldEditors: FieldEditorsByType): number {
  if (!Array.isArray(sections)) return 0;
  let n = 0;
  for (const s of sections) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const section = s as Record<string, unknown>;
    const editors = fieldEditors[String(section.type ?? "")];
    if (!editors) continue;
    const variant = typeof section.variant === "string" ? section.variant : undefined;
    n += countTrackedCtas(section, resolveBoundCtaPaths(editors, variant));
  }
  return n;
}

function readLiveSections(contentDir: string, locale: string, templateMode: boolean): unknown {
  const file = path.join(contentDir, liveLocaleFileName(locale, templateMode));
  if (!fs.existsSync(file)) return null;
  const { escaped, map } = escapeTemplateVars(fs.readFileSync(file, "utf-8"));
  const parsed = yaml.load(escaped) as Record<string, unknown> | null;
  return parsed ? (unescapeObjectVars(parsed, map) as Record<string, unknown>).sections : null;
}

/** Tracked buttons per version (`default` = the live page). Null when the page can't be read. */
export function trackedEnrollButtonsByVersion(opts: {
  vm: VersioningManager;
  contentType: string;
  slug: string;
  locale: string;
  versions: string[];
  contentFolder?: string;
}): Record<string, number> | null {
  try {
    const fieldEditors = loadAllFieldEditors(opts.contentFolder) as FieldEditorsByType;
    const templateMode = isTemplateVersioningSlug(opts.slug);
    const contentDir = opts.vm.getVersioningContentDir(opts.contentType, opts.slug);
    const out: Record<string, number> = {};
    for (const version of opts.versions) {
      const sections =
        version === TEST_DEFAULT_VERSION
          ? readLiveSections(contentDir, opts.locale, templateMode)
          : (opts.vm.getVariantContent(opts.contentType, opts.slug, version, opts.locale) as { sections?: unknown } | null)
              ?.sections;
      out[version] = countTrackedEnrollButtons(sections, fieldEditors);
    }
    return out;
  } catch (err) {
    log.warn({ err, contentType: opts.contentType, slug: opts.slug }, "[versioning] tracked button check failed");
    return null;
  }
}
