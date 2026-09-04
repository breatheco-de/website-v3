import { describe, expect, it } from "vitest";
import { AGENT_FILTER_OTHER } from "@shared/event-log-filters";
import {
  EVENT_LOG_SESSION_UNSCOPED,
  EVENT_LOG_SHOW_AROUND_HALF_MS,
  EVENT_LOG_VIEW_DEFAULTS,
  buildShowAroundHref,
  eventFocusDomId,
  eventLogActiveFilterCount,
  eventLogHasActiveFilters,
  eventLogHasTimeWindow,
  eventLogSessionToApi,
  parseEventFocusHash,
  parseEventLogSearch,
  serializeEventLogSearch,
} from "./event-log-url";

describe("event-log-url", () => {
  it("round-trips filters and omits defaults", () => {
    const view = {
      ...EVENT_LOG_VIEW_DEFAULTS,
      session: "abc-123",
      kinds: ["writes", "completes"] as const,
      actors: ["agents"] as const,
      agent: "claude" as const,
      type: "",
      entries: ["blog/demo-post/en", "page/home/en"] as string[],
    };
    const qs = serializeEventLogSearch({
      ...view,
      kinds: [...view.kinds],
      actors: [...view.actors],
      entries: [...view.entries],
    });
    expect(qs).toContain("session=abc-123");
    expect(qs).toContain("kind=writes%2Ccompletes");
    expect(qs).toContain("actor=agents");
    expect(qs).toContain("agent=claude");
    expect(qs).toContain("entry=blog%2Fdemo-post%2Fen%2Cpage%2Fhome%2Fen");
    expect(qs).not.toContain("type=");
    expect(qs).not.toContain("starting_at");

    const parsed = parseEventLogSearch(`?${qs}`);
    expect(parsed.session).toBe("abc-123");
    expect(parsed.kinds).toEqual(["writes", "completes"]);
    expect(parsed.actors).toEqual(["agents"]);
    expect(parsed.agent).toBe("claude");
    expect(parsed.type).toBe("");
    expect(parsed.entries).toEqual(["blog/demo-post/en", "page/home/en"]);
    expect(parsed.startingAt).toBeNull();
    expect(parsed.endingAt).toBeNull();
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

  it("drops invalid entry tokens and dedupes", () => {
    const parsed = parseEventLogSearch("?entry=blog/demo/en,nope,blog/demo/en,/only-two");
    expect(parsed.entries).toEqual(["blog/demo/en"]);
  });

  it("counts active filters", () => {
    expect(eventLogHasActiveFilters(EVENT_LOG_VIEW_DEFAULTS)).toBe(false);
    expect(eventLogActiveFilterCount(EVENT_LOG_VIEW_DEFAULTS)).toBe(0);
    expect(
      eventLogActiveFilterCount({
        ...EVENT_LOG_VIEW_DEFAULTS,
        session: "s",
        kinds: ["writes", "deletes"],
        actors: ["people"],
        agent: "claude",
        type: "job_failed",
        entries: ["page/home/en", "blog/a/en"],
      }),
    ).toBe(8);
  });

  it("parses starting_at/ending_at and rejects inverted or partial windows", () => {
    const ok = parseEventLogSearch("?starting_at=100&ending_at=200");
    expect(ok.startingAt).toBe(100);
    expect(ok.endingAt).toBe(200);
    expect(eventLogHasTimeWindow(ok)).toBe(true);

    expect(eventLogHasTimeWindow(parseEventLogSearch("?starting_at=200&ending_at=100"))).toBe(
      false,
    );
    expect(eventLogHasTimeWindow(parseEventLogSearch("?starting_at=100"))).toBe(false);
    expect(eventLogHasTimeWindow(parseEventLogSearch("?ending_at=100"))).toBe(false);
    expect(eventLogHasTimeWindow(parseEventLogSearch("?starting_at=nope&ending_at=1"))).toBe(
      false,
    );
  });

  it("serialize with time window drops filter keys", () => {
    const qs = serializeEventLogSearch(
      {
        ...EVENT_LOG_VIEW_DEFAULTS,
        startingAt: 1000,
        endingAt: 2000,
        kinds: ["writes"],
        entries: ["blog/a/en"],
        session: "sess",
      },
      "entry=blog/old/en&kind=writes&tab=log",
    );
    expect(qs).toContain("starting_at=1000");
    expect(qs).toContain("ending_at=2000");
    expect(qs).toContain("tab=log");
    expect(qs).not.toContain("kind=");
    expect(qs).not.toContain("entry=");
    expect(qs).not.toContain("session=");
  });

  it("serialize without window clears window keys", () => {
    const qs = serializeEventLogSearch(
      { ...EVENT_LOG_VIEW_DEFAULTS, kinds: ["writes"] },
      "starting_at=1&ending_at=2",
    );
    expect(qs).toContain("kind=writes");
    expect(qs).not.toContain("starting_at");
    expect(qs).not.toContain("ending_at");
  });

  it("buildShowAroundHref uses ±1h and event hash", () => {
    const createdAt = 1_700_000_000_000;
    const href = buildShowAroundHref(12615, createdAt, "/private/background-pipeline?entry=x");
    expect(href).toBe(
      `/private/background-pipeline?starting_at=${createdAt - EVENT_LOG_SHOW_AROUND_HALF_MS}&ending_at=${createdAt + EVENT_LOG_SHOW_AROUND_HALF_MS}#event-12615`,
    );
  });

  it("parseEventFocusHash accepts event-N only", () => {
    expect(parseEventFocusHash("#event-12615")).toBe(12615);
    expect(parseEventFocusHash("event-9")).toBe(9);
    expect(parseEventFocusHash("#event-12615?x=1")).toBe(12615);
    expect(parseEventFocusHash("#12615")).toBeNull();
    expect(parseEventFocusHash("#event-row-1")).toBeNull();
    expect(parseEventFocusHash("")).toBeNull();
    expect(eventFocusDomId(42)).toBe("event-42");
  });
});
