import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Push = Record<string, unknown>;

function fakeDocument() {
  const jar = new Map<string, string>();
  return {
    get cookie() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(line: string) {
      const [pair] = line.split(";").map((s) => s.trim());
      const eq = pair.indexOf("=");
      jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    },
    getElementById: (): HTMLElement | null => null,
  };
}

async function load() {
  vi.resetModules();
  const mod = await import("./tracking");
  mod.setPageTrackingContext(null);
  mod.setEcommerceProductLookup((id) => (id === "ai-flex" ? { product_id: "ai-flex", name: "AI Flex", active: true } : undefined));
  return mod;
}

describe("enrollment clicks (add_to_cart / click_begin_checkout)", () => {
  beforeEach(() => {
    vi.stubGlobal("document", fakeDocument());
    vi.stubGlobal("window", { dataLayer: [] as Push[], location: { pathname: "/en/landing/promo" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const pushes = () => (window as unknown as { dataLayer: Push[] }).dataLayer;

  it("carries the visit's test and tells the site's own counter", async () => {
    const t = await load();
    t.trackPageVersion({ experiment_id: "landing:promo:en@2026-10-01", variant: "b" });
    const seen: string[] = [];
    t.onTrack((name) => seen.push(name));
    await t.trackEcommerce("add_to_cart", { program_id: "ai-flex" });
    const last = pushes()[pushes().length - 1];
    expect(last).toMatchObject({ event: "add_to_cart", item_id: "ai-flex", experiment_id: "landing:promo:en@2026-10-01", variant: "b" });
    expect(last.eventCallback).toBeUndefined();
    expect(seen).toContain("add_to_cart");
  });

  it("skips non-purchasable programs entirely (no push, no count)", async () => {
    const t = await load();
    const seen: string[] = [];
    t.onTrack((name) => seen.push(name));
    await t.trackEcommerce("click_begin_checkout", { program_id: "unknown" });
    expect(pushes().some((p) => p.event === "click_begin_checkout")).toBe(false);
    expect(seen).not.toContain("click_begin_checkout");
  });

  it("with GTM loaded, resolves when GTM reports the event sent, or after the timeout", async () => {
    (window as unknown as { google_tag_manager: object }).google_tag_manager = {};
    const t = await load();
    const sent = t.trackEcommerce("add_to_cart", { program_id: "ai-flex" });
    await new Promise((r) => setTimeout(r, 0));
    const last = pushes()[pushes().length - 1];
    expect(last.eventTimeout).toBe(t.ENROLLMENT_CLICK_SEND_TIMEOUT_MS);
    (last.eventCallback as () => void)();
    await expect(sent).resolves.toBeUndefined();

    vi.useFakeTimers();
    let done = false;
    void t.trackEcommerce("add_to_cart", { program_id: "ai-flex" }).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(t.ENROLLMENT_CLICK_SEND_TIMEOUT_MS + 5);
    expect(done).toBe(true);
  });

  it("other ecommerce events keep their plain push", async () => {
    const t = await load();
    const seen: string[] = [];
    t.onTrack((name) => seen.push(name));
    await t.trackEcommerce("view_item", { program_id: "ai-flex" });
    const last = pushes()[pushes().length - 1];
    expect(last.event).toBe("view_item");
    expect(last.experiment_id).toBeUndefined();
    expect(seen).not.toContain("view_item");
  });
});
