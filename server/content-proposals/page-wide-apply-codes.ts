/** Create / revise / apply: a proposal may not change `detached` (any caller). */
export const DETACHED_NOT_SUPPORTED_CODE = "detached_not_supported";

/** Agent apply refused: the draft changes page-level fields no requested op covers. */
export const AGENT_APPLY_UNREQUESTED_PAGE_FIELDS_CODE = "agent_apply_unrequested_page_fields";

/** Agent apply refused: publishing would drop a live page-level value (`display_values_change`). */
export const AGENT_APPLY_DROPS_LIVE_VALUES_CODE = "agent_apply_drops_live_values";

export function isDetachedFieldPath(fieldPath: string): boolean {
  return fieldPath.trim().split(/[.[]/)[0] === "detached";
}
