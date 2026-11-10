/**
 * Title-only issue-code catalog for locale-slug-uniqueness.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const LOCALE_SLUG_UNIQUENESS_VALIDATOR_NAME = "locale-slug-uniqueness" as const;

export const LOCALE_SLUG_UNIQUENESS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  SLUG_SHARED_ACROSS_LOCALES: {
    title: "Slug Shared Across Locales",
  },
  SLUG_SHARED_SINGLE_ADDRESS: {
    title: "Two Languages Share One Address",
    summary:
      "This page uses one address for every language (e.g. /landing/:slug) and two languages have the same slug, so only one of them can ever be shown.",
    suggestion: "Give one language its own slug (a word in that language). Deploys stop until this is fixed.",
  },
  COMMON_LOCALE_IGNORED: {
    title: "Language Set In Shared Settings (Ignored)",
    summary:
      "`locale` in _common.yml is ignored legacy and a bad practice: the language comes from the language file (es.yml / en.yml) whose slug matches the address.",
    suggestion: "Remove the `locale:` line from _common.yml.",
  },
};
