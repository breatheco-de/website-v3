/**
 * Fixer: shared-layout-singles
 *
 * For DB-backed and single_template types:
 * - Repair empty `single.{locale}.yml` stubs by mirroring a sibling with sections
 * - Strip `sections` from `_common.single.yml` and type `_common.yml` if present
 * - Report divergent type/version/variant across siblings as warnings (not auto-fixed)
 */

import * as fs from "fs";
import * as path from "path";
import * as jsYaml from "js-yaml";
import type { Fixer, FixerContext, FixerResult } from "./types";
import { getAllConfigs } from "../../../server/content-types";
import { getDefaultContentRoot } from "../../../server/site-config";
import {
  findBestSingleMirrorSource,
  buildMirroredLocaleSingle,
  listAllSinglePaths,
} from "../../../server/shared-layout-sync";
import {
  resolveCommonTemplatePath,
  COMMON_TEMPLATE_BASENAME,
  LEGACY_COMMON_SINGLE_BASENAME,
} from "../../../server/shared-layout-paths";
import { canonicalSectionId } from "../../../server/utils/sectionIdentity";

function dumpYaml(data: unknown): string {
  return jsYaml.dump(data, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
}

function safeLoad(raw: string): Record<string, unknown> | null {
  try {
    const parsed = jsYaml.load(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const sharedLayoutSinglesFixer: Fixer = {
  name: "shared-layout-singles",
  description:
    "Align empty shared-layout single.{locale}.yml stubs to a sibling template; strip sections from common files",

  async run(ctx: FixerContext): Promise<FixerResult> {
    const dryRun = ctx.dryRun !== false;
    const changes: string[] = [];
    const warnings: string[] = [];
    let fixed = 0;

    const root = getDefaultContentRoot();
    if (!fs.existsSync(root)) {
      return { ok: true, message: `Content root not found: ${root}` };
    }

    const configs = getAllConfigs(root);
    for (const [contentType, config] of Object.entries(configs)) {
      const isShared = !!(config.database?.slug || config.single_template);
      if (!isShared) continue;

      const folder = config.directory || contentType;
      const typeDir = path.join(root, folder);
      if (!fs.existsSync(typeDir)) continue;

      const commonSingle = resolveCommonTemplatePath(typeDir);
      if (fs.existsSync(commonSingle)) {
        const data = safeLoad(fs.readFileSync(commonSingle, "utf-8"));
        if (data && "sections" in data) {
          changes.push(`${folder}/${path.basename(commonSingle)}: remove sections (layout defaults only)`);
          if (!dryRun) {
            delete data.sections;
            fs.writeFileSync(commonSingle, dumpYaml(data) + "\n", "utf-8");
            fixed++;
          }
        }
      }
      // Also strip legacy common if both exist
      const legacyCommon = path.join(typeDir, LEGACY_COMMON_SINGLE_BASENAME);
      if (
        path.basename(commonSingle) === COMMON_TEMPLATE_BASENAME &&
        fs.existsSync(legacyCommon)
      ) {
        const data = safeLoad(fs.readFileSync(legacyCommon, "utf-8"));
        if (data && "sections" in data) {
          changes.push(`${folder}/${LEGACY_COMMON_SINGLE_BASENAME}: remove sections (layout defaults only)`);
          if (!dryRun) {
            delete data.sections;
            fs.writeFileSync(legacyCommon, dumpYaml(data) + "\n", "utf-8");
            fixed++;
          }
        }
      }

      const typeCommon = path.join(typeDir, "_common.yml");
      if (fs.existsSync(typeCommon)) {
        const data = safeLoad(fs.readFileSync(typeCommon, "utf-8"));
        if (data && "sections" in data) {
          changes.push(`${folder}/_common.yml: remove sections (banned for shared-layout)`);
          if (!dryRun) {
            delete data.sections;
            fs.writeFileSync(typeCommon, dumpYaml(data) + "\n", "utf-8");
            fixed++;
          }
        }
      }

      const mirror = findBestSingleMirrorSource(typeDir, safeLoad);
      for (const { locale, filePath } of listAllSinglePaths(typeDir)) {
        const data = safeLoad(fs.readFileSync(filePath, "utf-8"));
        const sections = Array.isArray(data?.sections) ? data!.sections : [];
        if (sections.length === 0 && mirror && mirror.locale !== locale) {
          changes.push(
            `${folder}/${path.basename(filePath)}: empty stub → mirror structure from ${mirror.locale}`,
          );
          if (!dryRun) {
            const mirrored = buildMirroredLocaleSingle(mirror.data);
            if (data?.meta) mirrored.meta = data.meta;
            fs.writeFileSync(filePath, dumpYaml(mirrored) + "\n", "utf-8");
            fixed++;
          }
        }
      }

      // Strip structural overlays from attached entry YAML (data-only compliance)
      for (const name of fs.readdirSync(typeDir)) {
        const entryDir = path.join(typeDir, name);
        if (!fs.statSync(entryDir).isDirectory()) continue;
        if (name.startsWith(".") || name.startsWith("_")) continue;

        const commonPath = path.join(entryDir, "_common.yml");
        let detached = false;
        if (fs.existsSync(commonPath)) {
          const commonData = safeLoad(fs.readFileSync(commonPath, "utf-8"));
          detached = commonData?.detached === true;
          if (!detached && commonData && ("sections" in commonData || "layout" in commonData)) {
            changes.push(
              `${folder}/${name}/_common.yml: strip sections/layout (attached data-only)`,
            );
            if (!dryRun) {
              delete commonData.sections;
              delete commonData.layout;
              fs.writeFileSync(commonPath, dumpYaml(commonData) + "\n", "utf-8");
              fixed++;
            }
          }
        }
        if (detached) continue;

        for (const file of fs.readdirSync(entryDir)) {
          if (!file.endsWith(".yml") || file === "versioning.yml" || file.startsWith("_")) continue;
          // Skip entry variants: {variant}.{locale}.yml (more than one dot before locale)
          const base = file.slice(0, -4);
          const parts = base.split(".");
          if (parts.length !== 1) continue; // only locale.yml like en.yml
          const localePath = path.join(entryDir, file);
          const data = safeLoad(fs.readFileSync(localePath, "utf-8"));
          if (!data) continue;
          if (!("sections" in data) && !("layout" in data)) continue;
          changes.push(
            `${folder}/${name}/${file}: strip sections/layout (attached data-only; detach to keep custom structure)`,
          );
          if (!dryRun) {
            delete data.sections;
            delete data.layout;
            fs.writeFileSync(localePath, dumpYaml(data) + "\n", "utf-8");
            fixed++;
          }
        }
      }

      const summaries = listAllSinglePaths(typeDir).map(({ locale, filePath }) => {
        const data = safeLoad(fs.readFileSync(filePath, "utf-8"));
        const sections = Array.isArray(data?.sections)
          ? (data!.sections as Record<string, unknown>[])
          : [];
        return { locale, sections };
      });
      if (summaries.length >= 2) {
        const byId = new Map<
          string,
          Array<{ locale: string; type?: unknown; version?: unknown; variant?: unknown }>
        >();
        for (const { locale, sections } of summaries) {
          for (const s of sections) {
            const id = canonicalSectionId(s);
            if (!id) continue;
            const list = byId.get(id) ?? [];
            list.push({ locale, type: s.type, version: s.version, variant: s.variant });
            byId.set(id, list);
          }
        }
        for (const [id, entries] of byId) {
          if (entries.length < 2) continue;
          const sig = (e: (typeof entries)[0]) => `${e.type}|${e.version}|${e.variant}`;
          const first = sig(entries[0]);
          if (entries.some((e) => sig(e) !== first)) {
            warnings.push(
              `${folder} section ${id}: type/version/variant differs across locales (${entries
                .map((e) => `${e.locale}=${sig(e)}`)
                .join(", ")}) — update manually`,
            );
          }
        }
      }
    }

    return {
      ok: true,
      message: dryRun
        ? `Dry run: ${changes.length} change(s), ${warnings.length} warning(s)`
        : `Applied ${fixed} fix(es); ${warnings.length} warning(s)`,
      details: { dryRun, changes, warnings, fixed },
    };
  },
};
