import * as fs from "fs";
import * as path from "path";
import type {
  Validator,
  ValidatorResult,
  ValidationContext,
  ValidationIssue,
} from "../shared/types";
import { IMAGE_TAGS_ISSUE_CODES } from "./image-tags.issueCodes";

const REGISTRY_PATH = path.join(
  process.cwd(),
  "4geeks-com",
  "image-registry.json",
);

interface TagDefinition {
  label: string;
  description: string;
  presets: string[];
  srcset_widths: number[];
  detection?: Record<string, unknown>;
}

interface ImageEntry {
  src: string;
  tags?: string[];
  preset?: string[];
  [key: string]: unknown;
}

interface Registry {
  presets: Record<string, unknown>;
  tagDefinitions?: Record<string, TagDefinition>;
  images: Record<string, ImageEntry>;
}

export const imageTagsValidator: Validator = {
  name: "image-tags",
  issueCodes: IMAGE_TAGS_ISSUE_CODES,
  description:
    "Reports untagged images, tags not in tagDefinitions, and images missing presets implied by their tags",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "content",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    let registry: Registry;
    try {
      registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
    } catch (err) {
      errors.push({
        type: "error",
        code: "REGISTRY_LOAD_ERROR",
        message: `Failed to load image registry: ${err instanceof Error ? err.message : String(err)}`,
        file: REGISTRY_PATH,
        suggestion:
          "Ensure 4geeks-com/image-registry.json exists and is valid JSON",
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

    const tagDefs = registry.tagDefinitions || {};
    const canonicalTags = new Set(Object.keys(tagDefs));
    const images = registry.images;
    const totalImages = Object.keys(images).length;

    let untaggedCount = 0;
    let invalidTagCount = 0;
    let missingPresetCount = 0;

    for (const [imageId, entry] of Object.entries(images)) {
      const tags = entry.tags || [];

      if (tags.length === 0) {
        untaggedCount++;
        warnings.push({
          type: "warning",
          code: "IMAGE_UNTAGGED",
          message: `Image "${imageId}" has no tags`,
          suggestion:
            'Use the "Auto-tag untagged" button or call POST /api/validation/fix/image-auto-tags',
          fix: {
            type: "api",
            label: "Auto-tag all untagged images",
            fixerName: "image-auto-tags",
          },
        });
        continue;
      }

      for (const tag of tags) {
        if (canonicalTags.size > 0 && !canonicalTags.has(tag)) {
          invalidTagCount++;
          warnings.push({
            type: "warning",
            code: "TAG_NOT_IN_DEFINITIONS",
            message: `Image "${imageId}" has tag "${tag}" which is not in tagDefinitions`,
            suggestion: `Remove the invalid tag — it was likely assigned incorrectly by the auto-tagger`,
            fix: {
              type: "api",
              label: "Remove all invalid tags from images",
              fixerName: "invalid-image-tags",
            },
          });
        }
      }

      const entryPresets = new Set(entry.preset || []);
      for (const tag of tags) {
        const def = tagDefs[tag];
        if (!def || !def.presets) continue;
        for (const requiredPreset of def.presets) {
          if (!entryPresets.has(requiredPreset)) {
            missingPresetCount++;
            warnings.push({
              type: "warning",
              code: "IMAGE_MISSING_PRESET_FOR_TAG",
              message: `Image "${imageId}" has tag "${tag}" but is missing preset "${requiredPreset}"`,
              suggestion: `Run image optimization to generate the "${requiredPreset}" preset variant`,
              fix: {
                type: "api",
                label: "Optimize images to generate missing presets",
                fixerName: "image-optimization",
              },
            });
            break;
          }
        }
      }
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status:
        errors.length > 0
          ? "failed"
          : warnings.length > 0
            ? "warning"
            : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        totalImages,
        untaggedCount,
        invalidTagCount,
        missingPresetCount,
        canonicalTagCount: canonicalTags.size,
      },
    };
  },
};
