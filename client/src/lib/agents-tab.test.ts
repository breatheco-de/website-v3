import { describe, it, expect } from "vitest";
import {
  clampOutcomesPage,
  outcomeProposalHref,
  outcomesBackHref,
  outcomesHref,
  parseOutcomesSearch,
  resolveAgentsTab,
} from "./agents-tab";

describe("agents-tab", () => {
  it("resolveAgentsTab maps each tab path and keeps Outcomes lit on proposals opened from it", () => {
    expect(resolveAgentsTab("/private/agents/orgchart")).toBe("orgchart");
    expect(resolveAgentsTab("/private/agents/rules")).toBe("rules");
    expect(resolveAgentsTab("/private/agents/outcomes")).toBe("outcomes");
    expect(resolveAgentsTab("/private/agents/webhooks")).toBe("webhooks");
    expect(resolveAgentsTab("/private/agents/webhook-logs")).toBe("webhook-logs");
    expect(resolveAgentsTab("/private/agents/proposals")).toBe("proposals");
    expect(resolveAgentsTab("/private/agents/proposals/abc")).toBe("proposals");
    expect(resolveAgentsTab("/private/agents/proposals/abc", "?from=outcomes&outcome=bad")).toBe("outcomes");
    expect(resolveAgentsTab("/private/agents/proposals", "from=outcomes")).toBe("proposals");
    expect(resolveAgentsTab("/private/agents/other")).toBeNull();
  });

  it("parseOutcomesSearch falls back to All / first page on bad input", () => {
    expect(parseOutcomesSearch("")).toEqual({ outcome: "any", page: 0 });
    expect(parseOutcomesSearch("?outcome=bad&page=2")).toEqual({ outcome: "bad", page: 2 });
    expect(parseOutcomesSearch("outcome=bad_open&page=-1")).toEqual({ outcome: "any", page: 0 });
    expect(parseOutcomesSearch("outcome=none&page=1.5")).toEqual({ outcome: "none", page: 0 });
  });

  it("hrefs omit defaults and round-trip filter + page through the proposal page", () => {
    expect(outcomesHref({ outcome: "any", page: 0 })).toBe("/private/agents/outcomes");
    expect(outcomesHref({ outcome: "none", page: 3 })).toBe("/private/agents/outcomes?outcome=none&page=3");

    const detail = outcomeProposalHref("p 1", { outcome: "bad", page: 2 });
    const [path, qs] = detail.split("?");
    expect(path).toBe("/private/agents/proposals/p%201");
    const params = new URLSearchParams(qs);
    expect(params.get("from")).toBe("outcomes");
    expect(outcomesBackHref(qs)).toBe("/private/agents/outcomes?outcome=bad&page=2");
    expect(outcomesBackHref(`?${qs}`)).toBe("/private/agents/outcomes?outcome=bad&page=2");

    expect(outcomeProposalHref("x", { outcome: "any", page: 0 })).toBe("/private/agents/proposals/x?from=outcomes");
    expect(outcomesBackHref("from=outcomes")).toBe("/private/agents/outcomes");
    expect(outcomesBackHref("status=open")).toBeNull();
    expect(outcomesBackHref("")).toBeNull();
  });

  it("clampOutcomesPage jumps to the last page only when the current one came back empty", () => {
    expect(clampOutcomesPage(0, 0, 0)).toBeNull();
    expect(clampOutcomesPage(2, 5, 60)).toBeNull();
    expect(clampOutcomesPage(3, 0, 48)).toBe(1);
    expect(clampOutcomesPage(2, 0, 49)).toBeNull();
    expect(clampOutcomesPage(2, 0, 0)).toBe(0);
    expect(clampOutcomesPage(5, 0, 10, 4)).toBe(2);
  });
});
