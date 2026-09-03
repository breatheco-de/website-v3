/**
 * Title-only issue-code catalog for hero-image-tags.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const HERO_IMAGE_TAGS_VALIDATOR_NAME = "hero-image-tags" as const;

export const HERO_IMAGE_TAGS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  HERO_IMAGE_MISSING_PRESET: {
    title: "Hero Image Missing Preset",
  },
  HERO_IMAGE_MISSING_TAG: {
    title: "Hero Image Missing Tag",
  },
  HERO_IMAGE_NOT_IN_REGISTRY: {
    title: "Hero Image Not In Registry",
  },
  REGISTRY_LOAD_ERROR: {
    title: "Registry load error",
  },
};
