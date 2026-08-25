import * as fs from "fs";
import * as path from "path";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { mergeWidths } from "../../../server/image-optimizer";
import type { Preset } from "../../../server/image-optimizer";

const REGISTRY_PATH = path.join(process.cwd(), "4geeks-com", "image-registry.json");

const SKIP_EXTENSIONS = new Set([".svg", ".gif"]);
const RASTER_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);

function getExtension(src: string): string {
  try {
    const url = new URL(src);
    return path.extname(url.pathname).toLowerCase();
  } catch {
    return path.extname(src).toLowerCase();
  }
}

function missingWidths(
  presetNames: string[],
  widthsGenerated: number[],
  presets: Record<string, Preset>,
  intrinsicWidth: number,
): number[] {
  const { widths: expected } = mergeWidths(presetNames, presets);
  const filtered = expected.filter(w => w <= intrinsicWidth);
  const stored = new Set(widthsGenerated);
  return filtered.filter(w => !stored.has(w));
}

export const imageOptimizationValidator: Validator = {
  name: "image-optimization",
  description: "Checks image registry for raster images missing srcset, width, or height optimization data, or whose srcset is missing widths added to their preset",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "content",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    type RegistryEntry = {
      src: string;
      srcset?: { w: number; url: string }[];
      width?: number;
      height?: number;
      tags?: string[];
      preset?: string[];
      widths_generated?: number[];
    };

    let registry: {
      images: Record<string, RegistryEntry>;
      presets?: Record<string, Preset>;
    };

    try {
      const raw = fs.readFileSync(REGISTRY_PATH, "utf-8");
      registry = JSON.parse(raw);
    } catch (err) {
      errors.push({
        type: "error",
        code: "REGISTRY_LOAD_ERROR",
        message: `Failed to load image registry: ${err instanceof Error ? err.message : String(err)}`,
        file: REGISTRY_PATH,
        suggestion: "Ensure 4geeks-com/image-registry.json exists and is valid JSON",
      });
      return {
        name: this.name,
        description: this.description,
        status: "failed",
        errors,
        warnings,
        duration: Date.now() - startTime,
      };
    }

    const images = registry.images || {};
    const presets = (registry.presets ?? {}) as Record<string, Preset>;
    let optimized = 0;
    let needsOptimization = 0;
    let widthsOutdated = 0;
    let skipped = 0;

    for (const [id, entry] of Object.entries(images)) {
      const ext = getExtension(entry.src);

      if (SKIP_EXTENSIONS.has(ext)) {
        skipped++;
        continue;
      }

      if (!RASTER_EXTENSIONS.has(ext)) {
        skipped++;
        continue;
      }

      const hasSrcset = Array.isArray(entry.srcset) && entry.srcset.length > 0;
      const hasWidth = typeof entry.width === "number" && entry.width > 0;
      const hasHeight = typeof entry.height === "number" && entry.height > 0;

      if (!hasSrcset || !hasWidth || !hasHeight) {
        needsOptimization++;
        const missing: string[] = [];
        if (!hasSrcset) missing.push("srcset");
        if (!hasWidth) missing.push("width");
        if (!hasHeight) missing.push("height");

        warnings.push({
          type: "warning",
          code: "IMAGE_NOT_OPTIMIZED",
          message: `Image "${id}" is missing optimization data: ${missing.join(", ")}`,
          file: REGISTRY_PATH,
          suggestion: "Run the backfill script or trigger batch optimization to generate responsive variants",
          fix: {
            type: "api",
            label: "Optimize all unoptimized images",
            fixerName: "image-optimization",
          },
        });
        continue;
      }

      const presetNames = entry.preset ?? [];
      if (presetNames.length > 0 && Object.keys(presets).length > 0) {
        const missing = missingWidths(
          presetNames,
          entry.widths_generated ?? [],
          presets,
          entry.width!,
        );
        if (missing.length > 0) {
          widthsOutdated++;
          warnings.push({
            type: "warning",
            code: "IMAGE_WIDTHS_OUTDATED",
            message: `Image "${id}" is missing srcset widths added to its preset (${presetNames.join(", ")}): ${missing.join(", ")}px`,
            file: REGISTRY_PATH,
            suggestion: "Run the image optimization fixer to generate the missing width variants",
            fix: {
              type: "api",
              label: "Re-optimize images with outdated widths",
              fixerName: "image-optimization",
            },
          });
          continue;
        }
      }

      optimized++;
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        totalImages: Object.keys(images).length,
        optimized,
        needsOptimization,
        widthsOutdated,
        skipped,
      },
    };
  },
};
