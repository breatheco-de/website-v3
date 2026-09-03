/**
 * Title-only issue-code catalog for image-tags.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const IMAGE_TAGS_VALIDATOR_NAME = "image-tags" as const;

export const IMAGE_TAGS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  IMAGE_MISSING_PRESET_FOR_TAG: {
    title: "Image Missing Preset For Tag",
  },
  IMAGE_UNTAGGED: {
    title: "Image Untagged",
  },
  REGISTRY_LOAD_ERROR: {
    title: "Registry load error",
  },
  TAG_NOT_IN_DEFINITIONS: {
    title: "Tag Not In Definitions",
  },
};
