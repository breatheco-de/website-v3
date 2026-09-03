/**
 * Title-only issue-code catalog for image-optimization.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const IMAGE_OPTIMIZATION_VALIDATOR_NAME = "image-optimization" as const;

export const IMAGE_OPTIMIZATION_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  IMAGE_NOT_OPTIMIZED: {
    title: "Image Not Optimized",
  },
  IMAGE_WIDTHS_OUTDATED: {
    title: "Image Widths Outdated",
  },
  REGISTRY_LOAD_ERROR: {
    title: "Registry load error",
  },
};
