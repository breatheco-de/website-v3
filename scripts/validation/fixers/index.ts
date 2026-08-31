/**
 * Fixer Registry
 *
 * Central registry of all named fixers. Each fixer is invoked via
 * POST /api/validation/fix/:fixerName and runs server-side.
 */

import type { Fixer } from "./types";
import { imageOptimizationFixer } from "./image-optimization";
import { heroImageTagsFixer } from "./hero-image-tags";
import { imageRegistrySyncFixer } from "./image-registry-sync";
import { imageAutoTagsFixer } from "./image-auto-tags";
import { invalidImageTagsFixer } from "./invalid-image-tags";
import { orphanedImagesCleanupFixer } from "./orphaned-images-cleanup";
import { aiUnusedImagesCleanupFixer } from "./ai-unused-images-cleanup";
import { dbTemplateRestoreFixer } from "./db-template-restore";
import { bindingCleanupFixer } from "./binding-cleanup";
import { sharedLayoutSinglesFixer } from "./shared-layout-singles";

export type { Fixer, FixerContext, FixerResult, ProgressEvent } from "./types";

const fixers: Fixer[] = [
  imageOptimizationFixer,
  heroImageTagsFixer,
  imageRegistrySyncFixer,
  imageAutoTagsFixer,
  invalidImageTagsFixer,
  orphanedImagesCleanupFixer,
  aiUnusedImagesCleanupFixer,
  dbTemplateRestoreFixer,
  bindingCleanupFixer,
  sharedLayoutSinglesFixer,
];

export const fixerMap = new Map<string, Fixer>(fixers.map((f) => [f.name, f]));

export function getFixer(name: string): Fixer | undefined {
  return fixerMap.get(name);
}

export function listFixers(): { name: string; description: string }[] {
  return fixers.map((f) => ({ name: f.name, description: f.description }));
}
