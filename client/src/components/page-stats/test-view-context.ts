import { createContext, useContext } from "react";

/** Inside a test version view there is no previous period: "before" values and deltas are hidden. */
export const TestViewContext = createContext(false);

export function useTestView(): boolean {
  return useContext(TestViewContext);
}

export const TEST_VIEW_QUERY_KEY = "/api/analytics/page-stats/test";
