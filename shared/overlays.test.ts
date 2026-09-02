import { describe, expect, it } from "vitest";
import {
  mergeOverlayConfig,
  mergeOverlayContent,
  normalizeNewOverlay,
  overlayBlockingSaveError,
  overlayConfigSlice,
  overlayContentSlice,
  validateOverlaysConfig,
} from "./overlays";

describe("overlayBlockingSaveError (enable gate)", () => {
  it("allows disabled blocking overlays without buttons", () => {
    expect(
      overlayBlockingSaveError({
        id: "a",
        enabled: false,
        dismissible: false,
        content: { buttons: [] },
      }),
    ).toBeNull();
  });

  it("rejects enabled blocking overlays without labeled buttons", () => {
    expect(
      overlayBlockingSaveError({
        id: "a",
        enabled: true,
        dismissible: false,
        content: { buttons: [{ label: "  " }] },
      }),
    ).toMatch(/before it can be enabled/i);
  });

  it("allows enabled soft-dismiss overlays without buttons", () => {
    expect(
      overlayBlockingSaveError({
        id: "a",
        enabled: true,
        dismissible: true,
        content: { buttons: [] },
      }),
    ).toBeNull();
  });
});

describe("validateOverlaysConfig", () => {
  it("allows disabled blocking without buttons", () => {
    expect(
      validateOverlaysConfig({
        overlays: [{ id: "x", enabled: false, dismissible: false, content: { buttons: [] } }],
      }),
    ).toBeNull();
  });

  it("rejects enabled blocking without buttons", () => {
    expect(
      validateOverlaysConfig({
        overlays: [{ id: "x", enabled: true, dismissible: false, content: { buttons: [] } }],
      }),
    ).toMatch(/before it can be enabled/i);
  });
});

describe("mergeOverlayContent", () => {
  it("does not clobber config", () => {
    const existing = {
      id: "a",
      enabled: true,
      component: "modal",
      trigger: { event: "exit_intent" },
      targeting: { pages: "all" },
      frequency: "once",
      dismissible: false,
      content: { title: "Old", body: "", buttons: [] },
    };
    const merged = mergeOverlayContent(existing, {
      title: "New",
      body: "Hi",
      buttons: [{ label: "Go", href: "/x" }],
    });
    expect(merged.content?.title).toBe("New");
    expect(merged.enabled).toBe(true);
    expect(merged.component).toBe("modal");
    expect(merged.trigger).toEqual({ event: "exit_intent" });
    expect(merged.dismissible).toBe(false);
  });
});

describe("mergeOverlayConfig", () => {
  it("rejects content key", () => {
    const existing = {
      id: "a",
      enabled: false,
      content: { title: "Keep", body: "", buttons: [] },
    };
    const result = mergeOverlayConfig(existing, {
      enabled: true,
      content: { title: "Nope" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/must not include content/i);
  });

  it("does not clobber content", () => {
    const existing = {
      id: "a",
      enabled: false,
      component: "modal",
      trigger: { event: "page_load" },
      targeting: { pages: "all" },
      frequency: "once",
      content: { title: "Keep", body: "x", buttons: [{ label: "OK" }] },
    };
    const result = mergeOverlayConfig(existing, {
      enabled: true,
      component: "slide_in",
      trigger: { event: "scroll_depth", delay: 50 },
      targeting: { pages: ["/us"] },
      frequency: "session",
      dismissible: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.overlay.content?.title).toBe("Keep");
      expect(result.overlay.component).toBe("slide_in");
      expect(result.overlay.enabled).toBe(true);
    }
  });
});

describe("normalizeNewOverlay", () => {
  it("forces enabled false by default", () => {
    const next = normalizeNewOverlay({
      id: "new-1",
      enabled: true,
      content: { title: "T", body: "", buttons: [] },
    });
    expect(next.enabled).toBe(false);
    expect(next.id).toBe("new-1");
  });
});

describe("slices", () => {
  it("extracts content and config", () => {
    const o = {
      id: "a",
      enabled: true,
      component: "top_banner",
      trigger: { event: "time_delay", delay: 1000 },
      targeting: { pages: ["all"] },
      frequency: "always",
      dismissible: false,
      content: { title: "Hi", body: "B", buttons: [], image_id: "img" },
    };
    expect(overlayContentSlice(o)).toEqual({
      title: "Hi",
      body: "B",
      buttons: [],
      image_id: "img",
    });
    expect(overlayConfigSlice(o).component).toBe("top_banner");
    expect(overlayConfigSlice(o).enabled).toBe(true);
  });
});
