/**
 * Shared organic traffic date-window resolution.
 */

import { describe, expect, it } from "vitest";
import {
  inclusiveDaySpan,
  resolveOrganicWindow,
  ORGANIC_MAX_SPAN_DAYS,
} from "./gsc-organic-window";

describe("resolveOrganicWindow", () => {
  const now = new Date(Date.UTC(2026, 8, 8)); // 2026-09-08 → last complete 2026-09-06

  it("defaults to last 28 complete days", () => {
    const r = resolveOrganicWindow({ now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.end).toBe("2026-09-06");
    expect(r.days_expected).toBe(28);
    expect(inclusiveDaySpan(r.start, r.end)).toBe(28);
  });

  it("requires both start and end", () => {
    const r = resolveOrganicWindow({ start: "2026-08-01", now });
    expect(r.ok).toBe(false);
  });

  it("rejects span over max with OpenRush hint", () => {
    const r = resolveOrganicWindow({
      start: "2026-01-01",
      end: "2026-06-01",
      now,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain(String(ORGANIC_MAX_SPAN_DAYS));
    expect(r.message.toLowerCase()).toContain("openrush");
  });

  it("accepts custom range within max", () => {
    const r = resolveOrganicWindow({
      start: "2026-08-01",
      end: "2026-08-10",
      now,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.start).toBe("2026-08-01");
    expect(r.end).toBe("2026-08-10");
    expect(r.days_expected).toBe(10);
  });

  it("clamps end to latest complete day", () => {
    const r = resolveOrganicWindow({
      start: "2026-09-01",
      end: "2026-09-20",
      now,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.end).toBe("2026-09-06");
  });

  it("hard-fails when range is empty after clamp", () => {
    const r = resolveOrganicWindow({
      start: "2026-09-07",
      end: "2026-09-10",
      now,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("2026-09-06");
    expect(r.message.toLowerCase()).toMatch(/no complete|retry/);
  });
});
