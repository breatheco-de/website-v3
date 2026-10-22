/**
 * Issue-code catalog for draft-integrity (proposals 1.0: drafts, versioning.yml, field scope).
 */

import type { IssueCodeDefinition } from "../shared/types";

export const DRAFT_INTEGRITY_VALIDATOR_NAME = "draft-integrity" as const;

export const DRAFT_INTEGRITY_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  ATTACHED_DRAFT_STRUCTURE: {
    title: "Attached Draft Changes Page Structure",
    suggestion:
      "Drafts of posts that use the shared template may only change fields. Remove sections/layout from the draft (or detach the post), and set traffic back to 0% — attached variants cannot run as experiments.",
  },
  ORPHAN_ENTRY_VERSIONING: {
    title: "Versioning File Without Variants",
    suggestion:
      "versioning.yml is empty or only lists variant files that no longer exist. Run the orphan-entry-versioning fixer to delete it (published content does not change).",
  },
  UNREGISTERED_VARIANT_FILE: {
    title: "Version Missing From Traffic List",
    suggestion:
      "A version file exists but versioning.yml does not list it, so it gets no traffic and the Versions panel cannot manage it. Run the register-unlisted-variants fixer (or use Add to versions in the panel) to list it at 0% traffic; live content does not change.",
  },
  DRAFT_META_IN_PUBLISHED: {
    title: "Draft Bookkeeping In Published File",
    suggestion:
      "A published file carries the internal _draft block (left over from a promote). Run the draft-meta-in-published fixer to strip it; what visitors see does not change.",
  },
  STALE_DRAFT: {
    title: "Draft Behind Published Page",
    suggestion:
      "The published page changed after this draft was created more than 30 days ago, and no proposal owns the draft. Review it in the versions panel: rebuild, republish, or delete it by hand. Never deleted automatically.",
  },
  TRANSLATION_SOURCE_CHANGED: {
    title: "Translation Source Changed",
    suggestion:
      "The language this draft was translated from changed after the translation. Re-translate the changed fields before publishing.",
  },
  DRAFT_LINK_UNVERIFIED: {
    title: "Draft Proposal Link Not Verified",
    suggestion:
      "The daily link check could not ask production whether this draft's proposal is still open (token or network). Nothing was cleaned up; check PRODUCTION_ADMIN credentials.",
  },
  FIELD_SCOPE_MISMATCH: {
    title: "Field In The Wrong File",
    suggestion:
      "Per-language fields (title, description, robots, priority, change frequency…) belong in each language file; page-wide fields (funnel, authors, publish date) belong in _common.yml. Run the field-scope-mismatch fixer; it only moves values when what each language shows stays the same. A warning until migration 006_reconcile_field_scope has run on this site, an error after.",
  },
  FIELD_SCOPE_NULL_OUTSIDE_DRAFT: {
    title: "Null Field In Published File",
    suggestion:
      "null is only meaningful inside a draft (it removes the field on publish). In a published or _common.yml file it is ambiguous — delete the key or set a value by hand.",
  },
};
