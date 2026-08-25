/**
 * Ensures content-type keys and database slugs never share the same string
 * (relation / query-options `source` namespace).
 */
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { findSourceNameCollisions } from "../../../server/query-options";
import { databaseManager } from "../../../server/database";

export const sourceNameCollisionsValidator: Validator = {
  name: "source-name-collisions",
  description:
    "Detects content-type keys that collide with private database slugs (ambiguous relation source names)",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "integrity",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const contentRoot = context.contentRoot;

    const collisions = findSourceNameCollisions(contentRoot, databaseManager);
    for (const name of collisions) {
      errors.push({
        type: "error",
        code: "SOURCE_NAME_COLLISION",
        message: `Content type key "${name}" collides with database slug "${name}". Rename one so relation/query-options source names stay unambiguous.`,
        file: contentRoot
          ? `${contentRoot}/content-types.yml`
          : "content-types.yml",
        suggestion: `Rename the database folder/slug (preferred when the content type owns public URLs), then update content-types.yml database.slug.`,
      });
    }

    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : "passed",
      errors,
      warnings: [],
      duration: Date.now() - startTime,
      artifacts: { collisionCount: collisions.length, collisions },
    };
  },
};
