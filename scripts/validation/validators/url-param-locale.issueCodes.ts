/**
 * Title-only issue-code catalog for url-param-locale.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const URL_PARAM_LOCALE_VALIDATOR_NAME = "url-param-locale" as const;

export const URL_PARAM_LOCALE_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  URL_PARAM_LOCALE_PEER_MISMATCH: {
    title: "Url Param Locale Peer Mismatch",
  },
  URL_PARAM_ON_COMMON: {
    title: "Url Param On Common",
  },
};
