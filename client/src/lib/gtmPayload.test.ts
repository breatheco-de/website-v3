import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageTrackingContext } from "@shared/tracking-context";
import type { TrackingKeyIndex } from "@shared/tracking-keys";

const state = vi.hoisted(() => ({
  ctx: {} as Record<string, unknown>,
  hasCtx: true,
  staff: false,
  visit: null as null | { experiment_id: string; variant: string },
  skip: [] as string[] | null,
}));

vi.mock("@/lib/tracking", () => ({
  getPageTrackingContext: () => state.ctx,
  hasPageTrackingContext: () => state.hasCtx,
  isStaffSession: () => state.staff,
  getVisitExperiment: () => state.visit,
  subscribePageContext: () => () => {},
}));

vi.mock("@/lib/ecommerceProductMap", () => ({
  ensureEcommerceProductLookup: () => Promise.resolve(new Map()),
  getCachedGtmPayloadSkipDomains: () => state.skip,
  getCachedTrackingKeys: () => null,
}));

import {
  applyPageContextToMemory,
  buildGtmPayloadForClick,
  readGtmPayloadMemory,
  setPageExternalRedirects,
  withGtmPayload,
  withRedirectGtmPayload,
} from "./gtmPayload";
import { parseGtmPayload } from "@shared/gtm-payload";

const keys: TrackingKeyIndex = {
  products: [
    {
      slug: "ai-flex",
      content_type: "program",
      product_id: "program-ai-flex",
      name: "AI Flex",
      key: "afx",
      active: true,
      personas: [{ id: "the-explorer", name: "The Explorer", key: "exp" }],
      retired: [],
    },
  ],
};

function stubBrowser(pathname = "/en/career-programs/ai-flex", search = "") {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { host: "4geeks.com", pathname, search },
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
  });
}

const AFX: PageTrackingContext = {
  product: "afx",
  persona: "exp",
  product_persona: "afx:exp",
  funnel_stage: "decision",
  content_key: "program:ai-flex",
};
const PAYMENT: PageTrackingContext = {
  product: "afx,aie,aif",
  persona: "cc,dev,exp",
  product_persona: "afx:exp,aie:cc,aif:dev",
  funnel_stage: "decision",
  content_key: "page:payment-component",
};
const AIE: PageTrackingContext = {
  product: "aie",
  persona: "cc",
  product_persona: "aie:cc",
  funnel_stage: "decision",
  content_key: "program:ai-engineering",
};

function visit(ctx: PageTrackingContext) {
  state.ctx = ctx as Record<string, unknown>;
  applyPageContextToMemory(ctx, null, keys);
}

function payloadOf(href: string) {
  const raw = new URL(href, "https://4geeks.com").searchParams.get("gtm_payload");
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  stubBrowser();
  state.ctx = {};
  state.hasCtx = true;
  state.staff = false;
  state.visit = null;
  state.skip = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tab memory", () => {
  it("keeps the specific context through a broader decision page (6a)", () => {
    visit(AFX);
    visit(PAYMENT);
    const p = payloadOf(withGtmPayload("https://4geeks.com/x", "https://learn.4geeks.com/checkout?plan=x"));
    expect(p).toMatchObject({ v: 1, product: "afx", persona: "exp", product_persona: "afx:exp" });
  });

  it("replaces it on a decision page about different products", () => {
    visit(AFX);
    visit(AIE);
    expect(readGtmPayloadMemory()?.fields.product).toBe("aie");
  });

  it("clears it on awareness / consideration pages", () => {
    visit(AFX);
    visit({ ...AFX, funnel_stage: "consideration" });
    expect(readGtmPayloadMemory()).toBeNull();
    expect(buildGtmPayloadForClick()).toBeNull();
  });

  it("is used on a page with no stage while fresh, not after 30 minutes", () => {
    visit(AFX);
    visit({ content_key: "page:thanks", product: "none", persona: "none", product_persona: "none" });
    expect(buildGtmPayloadForClick()?.product).toBe("afx");
    expect(buildGtmPayloadForClick(Date.now() + 31 * 60 * 1000)).toBeNull();
  });

  it("remembers an incoming legacy gtm_payload as codes", () => {
    const incoming = parseGtmPayload('[{"product":"ai-flex","persona":"the-explorer"}]');
    state.ctx = { content_key: "page:payment-component" };
    applyPageContextToMemory({ content_key: "page:payment-component" }, incoming, keys);
    expect(readGtmPayloadMemory()?.fields).toMatchObject({ product: "afx", persona: "exp", product_persona: "afx:exp" });
  });

  it("sends nothing while the page has no tracking context (switch off / edit mode)", () => {
    visit(AFX);
    state.hasCtx = false;
    expect(buildGtmPayloadForClick()).toBeNull();
  });
});

describe("withGtmPayload", () => {
  beforeEach(() => visit(AFX));

  it("adds staff flag, test version and ts alongside the three keys", () => {
    state.staff = true;
    state.visit = { experiment_id: "program:ai-flex:en", variant: "b" };
    const p = payloadOf(withGtmPayload("x", "https://learn.4geeks.com/checkout"));
    expect(p).toMatchObject({ is_staff: true, experiment_id: "program:ai-flex:en", variant: "b" });
    expect(typeof p.ts).toBe("number");
  });

  it("leaves same-host, mailto, skip-listed and list-not-loaded links alone", () => {
    expect(withGtmPayload("x", "https://4geeks.com/checkout")).toBe("https://4geeks.com/checkout");
    expect(withGtmPayload("x", "mailto:a@b.co")).toBe("mailto:a@b.co");
    state.skip = ["stripe.com"];
    expect(withGtmPayload("x", "https://buy.stripe.com/abc")).toBe("https://buy.stripe.com/abc");
    state.skip = null;
    expect(withGtmPayload("x", "https://learn.4geeks.com/c")).toBe("https://learn.4geeks.com/c");
  });

  it("replaces pass-along values and keeps other params", () => {
    const legacy = 'https://learn.4geeks.com/checkout?plan=a&gtm_payload=[{"product":"ai-engineering"}]&cohort=1';
    const out = withGtmPayload(legacy, legacy);
    expect(payloadOf(out).product).toBe("afx");
    const url = new URL(out);
    expect(url.searchParams.get("plan")).toBe("a");
    expect(url.searchParams.get("cohort")).toBe("1");
    expect(url.searchParams.getAll("gtm_payload")).toHaveLength(1);

    const raw = "https://4geeks.com/checkout?gtm_payload={qs:gtm_payload|%7B%22persona%22%3A%22zz%22%7D}";
    const resolved = 'https://learn.4geeks.com/checkout?gtm_payload={"persona":"zz"}';
    expect(payloadOf(withGtmPayload(raw, resolved)).persona).toBe("exp");
  });

  it("lets explicit staff keys win key by key", () => {
    const href = 'https://learn.4geeks.com/checkout?gtm_payload={"persona":"cc","campaign":"x"}';
    expect(payloadOf(withGtmPayload(href, href))).toMatchObject({ product: "afx", persona: "cc", campaign: "x" });
  });

  it("does nothing on a consideration page", () => {
    state.ctx = { ...AFX, funnel_stage: "consideration" };
    expect(withGtmPayload("x", "https://learn.4geeks.com/c")).toBe("https://learn.4geeks.com/c");
  });
});

describe("internal redirects off-site", () => {
  it("adds gtm_payload to listed internal paths only", () => {
    visit(AFX);
    setPageExternalRedirects({ "/apply": "learn.4geeks.com" }, "/en/career-programs/ai-flex");
    expect(payloadOf(withRedirectGtmPayload("/apply?x=1")).product).toBe("afx");
    expect(withRedirectGtmPayload("/other")).toBe("/other");
  });
});
