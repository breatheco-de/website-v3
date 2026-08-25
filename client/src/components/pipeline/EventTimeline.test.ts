import { describe, expect, it } from "vitest";
import { layoutStaffItems, type EventTimelineEvent } from "./EventTimeline";

function ev(id: number, created_at: number): EventTimelineEvent {
  return { id, type: "content_saved", created_at, attribution: [] };
}

describe("layoutStaffItems", () => {
  it("sorts by id and round-robins two lanes", () => {
    const items = layoutStaffItems(
      [ev(3, 1000), ev(1, 1000), ev(2, 1000)],
      () => "Saved",
      "dark",
    );
    expect(items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(items.map((i) => i.group)).toEqual([0, 1, 0]);
  });

  it("keeps realStart and nudges display start on the same lane for bursts", () => {
    const t0 = 1_000_000;
    const items = layoutStaffItems(
      [ev(10, t0), ev(11, t0), ev(12, t0)],
      () => "Saved",
      "light",
    );
    expect(items.every((i) => i.realStart === t0)).toBe(true);
    // Third event shares lane 0 with the first — must sit after the first slot.
    const first = items.find((i) => i.id === 10)!;
    const third = items.find((i) => i.id === 12)!;
    expect(third.group).toBe(0);
    expect(+third.start).toBeGreaterThan(+first.start);
  });
});
