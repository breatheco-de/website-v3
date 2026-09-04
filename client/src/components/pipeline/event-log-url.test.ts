import { describe, expect, it } from "vitest";
import { AGENT_FILTER_OTHER } from "@shared/event-log-filters";
import {
  EVENT_LOG_SESSION_UNSCOPED,
  EVENT_LOG_VIEW_DEFAULTS,
  eventLogActiveFilterCount,
  eventLogHasActiveFilters,
  eventLogSessionToApi,
  parseEventLogSearch,
  serializeEventLogSearch,
} from "./event-log-url";

describe("event-log-url", () => {
  it("round-trips filters and omits defaults", () => {
    const view = {
      session: "abc-123",
      kinds: ["writes", "completes"] as const,
      actors: ["agents"] as const,
      agent: "claude" as const,
      type: "",
    };
    const qs = serializeEventLogSearch({ ...view, kinds: [...view.kinds], actors: [...view.actors] });
    expect(qs).toContain("session=abc-123");
    expect(qs).toContain("kind=writes%2Ccompletes");
    expect(qs).toContain("actor=agents");
    expect(qs).toContain("agent=claude");
    expect(qs).not.toContain("type=");

    const parsed = parseEventLogSearch(`?${qs}`);
    expect(parsed.session).toBe("abc-123");
    expect(parsed.kinds).toEqual(["writes", "completes"]);
    expect(parsed.actors).toEqual(["agents"]);
    expect(parsed.agent).toBe("claude");
    expect(parsed.type).toBe("");
  });

  it("maps other agent sentinel and unscoped session", () => {
    const qs = serializeEventLogSearch({
      ...EVENT_LOG_VIEW_DEFAULTS,
      session: EVENT_LOG_SESSION_UNSCOPED,
      agent: AGENT_FILTER_OTHER,
    });
    expect(qs).toContain("session=unscoped");
    expect(qs).toContain("agent=other");
    const parsed = parseEventLogSearch(qs);
    expect(parsed.session).toBe(EVENT_LOG_SESSION_UNSCOPED);
    expect(parsed.agent).toBe(AGENT_FILTER_OTHER);
    expect(eventLogSessionToApi(parsed.session)).toEqual({ unscoped: true });
  });

  it("preserves unknown query keys", () => {
    const qs = serializeEventLogSearch(
      { ...EVENT_LOG_VIEW_DEFAULTS, kinds: ["completes"] },
      "tab=log&site=x",
    );
    expect(qs).toContain("tab=log");
    expect(qs).toContain("site=x");
    expect(qs).toContain("kind=completes");
  });

  it("ignores invalid kind/actor/agent tokens", () => {
    const parsed = parseEventLogSearch("?kind=writes,nope&actor=people,xyz&agent=not-real");
    expect(parsed.kinds).toEqual(["writes"]);
    expect(parsed.actors).toEqual(["people"]);
    expect(parsed.agent).toBe("");
  });

  it("counts active filters", () => {
    expect(eventLogHasActiveFilters(EVENT_LOG_VIEW_DEFAULTS)).toBe(false);
    expect(eventLogActiveFilterCount(EVENT_LOG_VIEW_DEFAULTS)).toBe(0);
    expect(
      eventLogActiveFilterCount({
        session: "s",
        kinds: ["writes", "deletes"],
        actors: ["people"],
        agent: "claude",
        type: "job_failed",
      }),
    ).toBe(6);
  });
});
