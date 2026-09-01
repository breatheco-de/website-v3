import { DatabaseManager } from "./database";
import {
  resolveDynamicEntries,
  resolveHardcodedEntriesForDynamic,
} from "./dynamic-entries";
import {
  TESTIMONIALS_DATABASE,
  TESTIMONIALS_LIMIT_DEFAULTS,
  type TestimonialBankRow,
  type TestimonialsDynamicEntries,
  type TestimonialsSectionType,
} from "@shared/testimonials-listing";

export interface TestimonialsSectionPreviewInput {
  sectionType: TestimonialsSectionType;
  locale: string;
  dynamicEntries: TestimonialsDynamicEntries;
  singleEntry?: Record<string, unknown>;
  contentRoot?: string;
  db?: DatabaseManager;
}

export interface TestimonialsSectionPreviewResult {
  items: TestimonialBankRow[];
  total: number;
  hardcodedCount: number;
}

/**
 * Resolve a testimonials section the same way as the live page (resolveDynamicEntries).
 */
export async function resolveTestimonialsSectionPreview(
  input: TestimonialsSectionPreviewInput,
): Promise<TestimonialsSectionPreviewResult> {
  const { sectionType, locale, dynamicEntries, singleEntry, contentRoot, db } = input;

  if (!(sectionType in TESTIMONIALS_LIMIT_DEFAULTS)) {
    throw new Error(`Invalid section_type: ${sectionType}`);
  }

  const limit =
    typeof dynamicEntries.limit === "number" && dynamicEntries.limit > 0
      ? dynamicEntries.limit
      : TESTIMONIALS_LIMIT_DEFAULTS[sectionType];

  const de: TestimonialsDynamicEntries = {
    ...dynamicEntries,
    database: dynamicEntries.database ?? TESTIMONIALS_DATABASE,
    limit,
  };

  const hardcodedEntries = resolveHardcodedEntriesForDynamic(
    de.hardcoded_entries,
    singleEntry,
  );
  const hardcodedCount =
    limit > 0
      ? Math.min(hardcodedEntries.length, limit)
      : hardcodedEntries.length;

  const section = {
    type: sectionType,
    dynamic_entries: de,
  };

  const resolved = await resolveDynamicEntries([section], locale, {
    db,
    contentRoot,
    singleEntry,
  });

  const resolvedSection = resolved[0] as { items?: unknown[] } | undefined;
  const items = (resolvedSection?.items ?? []) as TestimonialBankRow[];

  return {
    items,
    total: items.length,
    hardcodedCount,
  };
}
