import { describe, expect, it } from "vitest";
import { layoutStaffItems, type EventTimelineEvent } from "./EventTimeline";

function ev(id: number, created_at: number): EventTimelineEvent {
  return { id, type: "content_saved", created_at, attribution: [] };
}

describe("layoutStaffItems", () => {
  it("sorts by id and round-robins three lanes", () => {
    const items = layoutStaffItems(
      [ev(3, 1000), ev(1, 1000), ev(2, 1000)],
      () => "Saved",
      "dark",
    );
    expect(items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(items.map((i) => i.group)).toEqual([0, 1, 2]);
  });

  it("keeps realStart and nudges display start on the same lane for bursts", () => {
    const t0 = 1_000_000;
    const items = layoutStaffItems(
      [ev(10, t0), ev(11, t0), ev(12, t0), ev(13, t0)],
      () => "Saved",
      "light",
    );
    expect(items.every((i) => i.realStart === t0)).toBe(true);
    // Fourth event shares lane 0 with the first — must sit after the first slot.
    const first = items.find((i) => i.id === 10)!;
    const fourth = items.find((i) => i.id === 13)!;
    expect(fourth.group).toBe(0);
    expect(+fourth.start).toBeGreaterThan(+first.start);
  });
});
