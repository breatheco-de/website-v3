/**
 * GTM freeze: existing event names/payload keys for ecommerce enrollment clicks
 * and section cta_click must stay stable (no inventing / renaming for Micro).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("GTM freeze — existing emitters", () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as { window?: unknown }).window = {
      dataLayer: [] as Record<string, unknown>[],
      location: { pathname: "/en/ai-flex", origin: "https://4geeks.com" },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cta_click payload still uses event + section fields", async () => {
    const { ctaClickPayload } = await import("./section-tracking");
    const payload = ctaClickPayload(
      {
        closest: (sel: string) => {
          if (sel.includes("a[href]") || sel.includes("button")) {
            return {
              closest: (s: string) =>
                s.includes("section-wrapper")
                  ? {
                      getAttribute: (n: string) =>
                        n === "data-section-type" ? "ai_flex_path" : n === "data-section-index" ? "0" : null,
                      id: "sec-1",
                      textContent: null,
                    }
                  : null,
              getAttribute: (n: string) => (n === "href" ? "/en/quiz" : n === "aria-label" ? "Take quiz" : null),
              textContent: "Take quiz",
            };
          }
          return null;
        },
        getAttribute: () => null,
        textContent: null,
      },
      { pathname: "/en/ai-flex", origin: "https://4geeks.com" },
    );
    expect(payload).toMatchObject({
      section_type: "ai_flex_path",
      label: "Take quiz",
      destination: "/en/quiz",
    });
  });

  it("ENROLLMENT_CLICK_EVENTS unchanged", async () => {
    const t = await import("./tracking");
    expect([...t.ENROLLMENT_CLICK_EVENTS]).toEqual(["add_to_cart", "click_begin_checkout"]);
    expect(t.isEnrollmentClickEvent("cta_click")).toBe(false);
    expect(t.isEnrollmentClickEvent("add_to_cart")).toBe(true);
  });

  it("track() still pushes { event } onto dataLayer (no renamed micro events)", async () => {
    const t = await import("./tracking");
    const dl = (globalThis as { window: { dataLayer: Record<string, unknown>[] } }).window.dataLayer;
    await t.track("cta_click", { label: "quiz", section_type: "ai_flex_path" });
    const hit = dl.find((row) => row.event === "cta_click");
    expect(hit).toMatchObject({
      event: "cta_click",
      label: "quiz",
      section_type: "ai_flex_path",
    });
    expect(dl.some((row) => typeof row.event === "string" && String(row.event).startsWith("micro_"))).toBe(
      false,
    );
  });

  it("file video_start / video_complete names stay frozen", async () => {
    const t = await import("./tracking");
    const dl = (globalThis as { window: { dataLayer: Record<string, unknown>[] } }).window.dataLayer;
    await t.track("video_start", { video_provider: "file" });
    await t.track("video_complete", { video_provider: "file" });
    expect(dl.map((r) => r.event).filter(Boolean)).toEqual(
      expect.arrayContaining(["video_start", "video_complete"]),
    );
  });
});
