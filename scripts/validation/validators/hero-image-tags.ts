import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { escapeTemplateVars } from "../../../shared/templateVars";
import { getAllDirectories } from "../../../server/content-types";
import { HERO_IMAGE_TAGS_ISSUE_CODES } from "./hero-image-tags.issueCodes";

const MARKETING_CONTENT_DIR = path.join(process.cwd(), "4geeks-com");
const REGISTRY_PATH = path.join(MARKETING_CONTENT_DIR, "image-registry.json");

const CONTENT_DIRS = getAllDirectories().map(dir => path.join(MARKETING_CONTENT_DIR, dir));

const HERO_VARIANT_KEYS = new Set([
  "hero",
  "hero_singleColumn",
  "hero_showcase",
  "hero_productShowcase",
  "hero_simpleTwoColumn",
  "hero_simpleStacked",
  "hero_twoColumn",
  "hero_course",
  "hero_ApplyFormProductShowcase",
]);

interface ImageEntry {
  src: string;
  tags?: string[];
  preset?: string[];
}

interface Registry {
  presets: Record<string, unknown>;
  images: Record<string, ImageEntry>;
}

interface HeroImageRef {
  src: string;
  field: string;
  file: string;
}

function getAllYamlFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
        files.push(fullPath);
      }
    }
  }
  walk(dir);
  return files;
}

function extractSrcFromImageField(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "src" in (value as Record<string, unknown>)) {
    const src = (value as Record<string, unknown>).src;
    if (typeof src === "string" && src.length > 0) return src;
  }
  return null;
}

function extractHeroImageSrcs(section: Record<string, unknown>, file: string): HeroImageRef[] {
  const refs: HeroImageRef[] = [];
  const singleImageFields = ["image", "background_image", "form_card_image"];
  for (const field of singleImageFields) {
    if (field in section) {
      const src = extractSrcFromImageField(section[field]);
      if (src) refs.push({ src, field, file });
    }
  }
  const arrayImageFields = ["left_images", "right_images"];
  for (const field of arrayImageFields) {
    if (field in section && Array.isArray(section[field])) {
      for (const item of section[field] as unknown[]) {
        const src = extractSrcFromImageField(item);
        if (src) refs.push({ src, field, file });
      }
    }
  }
  if (section.media && typeof section.media === "object") {
    const media = section.media as Record<string, unknown>;
    if (typeof media.src === "string" && media.src.length > 0) {
      refs.push({ src: media.src, field: "media.src", file });
    }
  }
  return refs;
}

function isKeyedHeroSection(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  const firstKey = keys[0];
  return HERO_VARIANT_KEYS.has(firstKey) || firstKey.startsWith("hero");
}

function findHeroSections(parsed: unknown): Record<string, unknown>[] {
  const heroes: Record<string, unknown>[] = [];
  if (!parsed || typeof parsed !== "object") return heroes;
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const section = item as Record<string, unknown>;
      if (section.type === "hero") {
        heroes.push(section);
      } else if (!("type" in section) && isKeyedHeroSection(section)) {
        const firstKey = Object.keys(section)[0];
        const inner = section[firstKey];
        if (inner && typeof inner === "object" && !Array.isArray(inner)) {
          heroes.push(inner as Record<string, unknown>);
        }
      }
    }
    return heroes;
  }
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      heroes.push(...findHeroSections(value));
    }
  }
  return heroes;
}

function isUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
}

export const heroImageTagsValidator: Validator = {
  name: "hero-image-tags",
  issueCodes: HERO_IMAGE_TAGS_ISSUE_CODES,
  description: "Checks that images used in hero sections have the 'hero' tag in the registry",
  apiExposed: true,
  estimatedDuration: "medium",
  category: "content",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    let registry: Registry;
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

    const srcToId: Record<string, string> = {};
    for (const [id, entry] of Object.entries(registry.images)) {
      srcToId[entry.src] = id;
    }

    const allYamlFiles: string[] = [];
    for (const dir of CONTENT_DIRS) {
      allYamlFiles.push(...getAllYamlFiles(dir));
    }

    const heroImageRefs: HeroImageRef[] = [];
    let heroSectionCount = 0;
    let parseErrors = 0;

    for (const file of allYamlFiles) {
      try {
        const rawContent = fs.readFileSync(file, "utf-8");
        const { escaped } = escapeTemplateVars(rawContent);
        const parsed = yaml.load(escaped);
        const heroes = findHeroSections(parsed);
        heroSectionCount += heroes.length;
        for (const hero of heroes) {
          const refs = extractHeroImageSrcs(hero, path.relative(MARKETING_CONTENT_DIR, file));
          heroImageRefs.push(...refs);
        }
      } catch {
        parseErrors++;
      }
    }

    const uniqueSrcs = new Map<string, HeroImageRef>();
    for (const ref of heroImageRefs) {
      if (!uniqueSrcs.has(ref.src)) {
        uniqueSrcs.set(ref.src, ref);
      }
    }

    let missingFromRegistry = 0;
    let missingHeroTag = 0;
    let missingHeroPreset = 0;
    let correctCount = 0;

    for (const [src, ref] of Array.from(uniqueSrcs.entries())) {
      let registryId: string | undefined;
      if (!isUrl(src) && registry.images[src]) {
        registryId = src;
      } else if (srcToId[src]) {
        registryId = srcToId[src];
      }

      if (!registryId) {
        missingFromRegistry++;
        warnings.push({
          type: "warning",
          code: "HERO_IMAGE_NOT_IN_REGISTRY",
          message: `Hero image not found in registry: "${src}"`,
          file: ref.file,
          suggestion: "Add this image to the registry or fix the reference",
        });
        continue;
      }

      const entry = registry.images[registryId];
      const tags = entry.tags || [];
      const hasHeroTag = tags.includes("hero");
      const presets = entry.preset || [];
      const hasHeroPreset = presets.includes("hero-wide");

      if (!hasHeroTag) {
        missingHeroTag++;
        warnings.push({
          type: "warning",
          code: "HERO_IMAGE_MISSING_TAG",
          message: `Registry entry "${registryId}" is used in a hero section but missing the "hero" tag`,
          file: ref.file,
          suggestion: 'Use the Diagnostics UI one-click fix, or call POST /api/validation/fix/hero-image-tags to auto-add the "hero" tag',
          fix: {
            type: "api",
            label: 'Add "hero" tag to all affected entries',
            fixerName: "hero-image-tags",
          },
        });
      } else if (!hasHeroPreset) {
        missingHeroPreset++;
        warnings.push({
          type: "warning",
          code: "HERO_IMAGE_MISSING_PRESET",
          message: `Registry entry "${registryId}" has "hero" tag but missing "hero-wide" preset`,
          file: ref.file,
          suggestion: "Run the backfill script to generate hero-wide variants",
          fix: {
            type: "api",
            label: "Optimize hero images (generate hero-wide variants)",
            fixerName: "image-optimization",
          },
        });
      } else {
        correctCount++;
      }
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
        yamlFilesScanned: allYamlFiles.length,
        heroSectionsFound: heroSectionCount,
        uniqueHeroImages: uniqueSrcs.size,
        correct: correctCount,
        missingFromRegistry,
        missingHeroTag,
        missingHeroPreset,
        parseErrors,
      },
    };
  },
};
