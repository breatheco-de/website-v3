import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Minimal document.cookie jar: remembers values and the last Max-Age per name. */
function fakeDocument() {
  const jar = new Map<string, string>();
  const maxAge = new Map<string, number>();
  return {
    jar,
    maxAge,
    getElementById: (_id: string): unknown => null,
    get cookie() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(line: string) {
      const [pair, ...attrs] = line.split(";").map((s) => s.trim());
      const eq = pair.indexOf("=");
      jar.set(pair.slice(0, eq), pair.slice(eq + 1));
      const age = attrs.find((a) => a.toLowerCase().startsWith("max-age="));
      if (age) maxAge.set(pair.slice(0, eq), Number(age.split("=")[1]));
    },
  };
}

type Push = Record<string, unknown>;

/** Loads a fresh module whose current page has published "no funnel context", so track() never waits. */
async function load() {
  vi.resetModules();
  const mod = await import("./tracking");
  mod.setPageTrackingContext(null);
  return mod;
}

/** track() pushes after an await; let it land. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("visit experiment (first test seen this visit)", () => {
  let doc: ReturnType<typeof fakeDocument>;

  beforeEach(() => {
    doc = fakeDocument();
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", { dataLayer: [] as Push[], location: { pathname: "/en/landing/promo" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const pushes = () => (window as unknown as { dataLayer: Push[] }).dataLayer;

  it("pushes experiment_exposure for Default too, once per page and version", async () => {
    const t = await load();
    t.trackPageVersion({ experiment_id: "landing:promo:en@2026-10-01", variant: "default" });
    t.trackPageVersion({ experiment_id: "landing:promo:en@2026-10-01", variant: "default" });
    await flush();
    const exposures = pushes().filter((p) => p.event === "experiment_exposure");
    expect(exposures).toHaveLength(1);
    expect(exposures[0]).toMatchObject({ experiment_id: "landing:promo:en@2026-10-01", variant: "default" });
  });

  it("remembers the first test of the visit across pages and keeps it", async () => {
    const t = await load();
    t.trackPageVersion({ experiment_id: "landing:promo:en@2026-10-01", variant: "b" });
    (window as unknown as { location: { pathname: string } }).location.pathname = "/en/landing/other";
    t.setPageTrackingContext(null);
    t.trackPageVersion({ experiment_id: "landing:other:en@2026-10-05", variant: "default" });
    t.trackPageVersion(null);
    expect(t.getVisitExperiment()).toEqual({ experiment_id: "landing:promo:en@2026-10-01", variant: "b" });
    expect(doc.maxAge.get("4g_visit_exp")).toBe(1800);
  });

  it("is shared across tabs (read from the cookie, not module memory)", async () => {
    const first = await load();
    first.trackPageVersion({ experiment_id: "landing:promo:en@2026-10-01", variant: "b" });
    const secondTab = await load();
    expect(secondTab.getVisitExperiment()).toEqual({ experiment_id: "landing:promo:en@2026-10-01", variant: "b" });
  });

  it("adds the visit's experiment to conversion pushes", async () => {
    const t = await load();
    t.trackPageVersion({ experiment_id: "landing:promo:en@2026-10-01", variant: "b" });
    await t.trackFormSubmission("request_more_info", { email: "a@b.com" });
    const last = pushes()[pushes().length - 1];
    expect(last).toMatchObject({ event: "request_more_info", experiment_id: "landing:promo:en@2026-10-01", variant: "b" });
  });

  it("refreshes the 30-minute expiry on later events", async () => {
    const t = await load();
    t.trackPageVersion({ experiment_id: "landing:promo:en@2026-10-01", variant: "b" });
    doc.maxAge.set("4g_visit_exp", 0);
    await t.track("cta_click", { label: "Apply" });
    expect(doc.maxAge.get("4g_visit_exp")).toBe(1800);
  });

  it("seeds the first page's context from the SSR payload on load", async () => {
    const payload = { queries: [{ data: { _tracking: { product: "full-stack", content_key: "landing:promo" } } }] };
    doc.getElementById = (id) =>
      id === "__INITIAL_DATA__" ? { textContent: JSON.stringify(payload) } : null;
    vi.resetModules();
    const t = await import("./tracking");
    expect(t.isPageContextSet("/en/landing/promo")).toBe(true);
    expect(t.getPageTrackingContext()).toEqual({ product: "full-stack", content_key: "landing:promo" });
    expect(pushes()).toContainEqual(expect.objectContaining({ product: "full-stack", content_key: "landing:promo" }));
  });

  it("conversions without a test carry no experiment fields", async () => {
    const t = await load();
    await t.trackFormSubmission("request_more_info", { email: "a@b.com" });
    const last = pushes()[pushes().length - 1];
    expect(last.experiment_id).toBeUndefined();
    expect(last.variant).toBeUndefined();
  });
});
