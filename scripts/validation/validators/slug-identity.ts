/**
 * Page ID (folder name) vs public slugs: flags IDs that are not standard slugs, a `_common.yml`
 * slug that differs from the ID, and two pages whose addresses normalize to the same key.
 */

import path from "path";
import { isSlug, slugKey } from "@shared/slug";
import { ContentIndex, contentIndex as defaultContentIndex } from "../../../server/content-index";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { SLUG_IDENTITY_ISSUE_CODES, SLUG_IDENTITY_VALIDATOR_NAME } from "./slug-identity.issueCodes";

function entryDirectory(ci: ContentIndex, contentType: string, entryId: string): string {
  return path.join(ci.contentRoot, ci.getFolderName(contentType), entryId);
}

export const slugIdentityValidator: Validator = {
  name: SLUG_IDENTITY_VALIDATOR_NAME,
  issueCodes: SLUG_IDENTITY_ISSUE_CODES,
  description:
    "Flags page IDs that are not standard slugs, shared slugs that differ from the page ID, and pages whose addresses collide",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "seo",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const warnings: ValidationIssue[] = [];
    const ci = context.contentIndex ?? (context.contentRoot ? new ContentIndex(context.contentRoot) : defaultContentIndex);

    const inScope = new Set<string>();
    for (const file of context.contentFiles) {
      if (!file.variant) inScope.add(`${ci.normalizeType(file.type)}/${file.slug}`);
    }

    let entriesChecked = 0;
    for (const key of inScope) {
      const slash = key.indexOf("/");
      const contentType = key.slice(0, slash);
      const entryId = key.slice(slash + 1);
      // Only folder entries are indexed; database pages have no folder ID to check.
      if (ci.findBySlug(entryId, { contentType }).length === 0) continue;
      entriesChecked++;
      const commonFile = path.join(entryDirectory(ci, contentType, entryId), "_common.yml");

      if (!isSlug(entryId)) {
        warnings.push({
          type: "warning",
          code: "ENTRY_ID_NOT_SLUG",
          message:
            `${contentType}/${entryId}: this page's ID is not in standard slug form (capitals or stray hyphens). ` +
            "It still works everywhere; renaming the folder is optional.",
          file: commonFile,
          suggestion:
            "Make sure each language file declares a lowercase slug: so public addresses are standard. " +
            "The folder name (page ID) is matched by slugKey, so lookups ignore its spelling.",
          category: "seo",
          validator: this.name,
        });
      }

      const common = ci.getDeclaredSlugs(contentType, entryId)?.common;
      // A lowercase spelling of a mixed-case ID is the standard address (ENTRY_ID_NOT_SLUG covers the ID).
      if (common && slugKey(common) !== slugKey(entryId)) {
        warnings.push({
          type: "warning",
          code: "COMMON_SLUG_DIFFERS_FROM_ID",
          message:
            `${contentType}/${entryId}: this page's shared address ("${common}" in _common.yml) differs from its ID. ` +
            "Links and tools use the address; languages without their own slug use it.",
          file: commonFile,
          suggestion:
            "Set _common.yml slug to the page's real default address (or remove it) and give each language file its own slug:.",
          category: "seo",
          validator: this.name,
        });
      }
    }

    const collisions = ci
      .getSlugKeyCollisions()
      .filter((c) => c.entryIds.some((id) => inScope.has(`${c.contentType}/${id}`)));
    for (const c of collisions) {
      const shadowed = c.resolvesTo ? c.entryIds.filter((id) => id !== c.resolvesTo) : c.entryIds;
      warnings.push({
        type: "warning",
        code: "SLUG_KEY_COLLISION",
        message:
          `${c.contentType}: pages ${c.entryIds.join(", ")} share the address key "${c.key}". ` +
          (c.resolvesTo
            ? `Lookups resolve to "${c.resolvesTo}" (its page ID); the other page's address is shadowed.`
            : "Tools cannot tell them apart until one is renamed."),
        file: entryDirectory(ci, c.contentType, shadowed[0] ?? c.entryIds[0]!),
        suggestion: "Give one of the pages a different slug (rename_slug / update the language file).",
        category: "seo",
        validator: this.name,
      });
    }

    return {
      name: this.name,
      description: this.description,
      status: warnings.length > 0 ? "warning" : "passed",
      errors: [],
      warnings,
      duration: Date.now() - startTime,
      artifacts: { entriesChecked, collisionsFound: collisions.length },
    };
  },
};
