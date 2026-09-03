/**
 * Title-only issue-code catalog for images.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const IMAGES_VALIDATOR_NAME = "images" as const;

export const IMAGES_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  AI_UNUSED_REGISTRY_ENTRY: {
    title: "Ai Unused Registry Entry",
  },
  IMAGE_ALT_MISSING: {
    title: "Image Alt Missing",
  },
  IMAGE_ALT_PLACEHOLDER: {
    title: "Image Alt Placeholder",
  },
  IMAGE_REFERENCE_NOT_IN_REGISTRY: {
    title: "Image Reference Not In Registry",
  },
  IMAGE_SRC_FILE_MISSING: {
    title: "Image Src File Missing",
  },
  ORPHANED_REGISTRY_ENTRY: {
    title: "Orphaned registry entry",
  },
  REGISTRY_LOAD_ERROR: {
    title: "Registry load error",
  },
};
