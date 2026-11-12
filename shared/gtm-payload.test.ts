import { describe, expect, it } from "vitest";
import {
  GTM_PAYLOAD_MAX_KEYS,
  GTM_PAYLOAD_VALUE_MAX,
  gtmPayloadToCodes,
  hasGtmPayloadPassAlongToken,
  hostMatchesSkipList,
  mergeGtmPayload,
  normalizeSkipDomain,
  normalizeSkipDomains,
  parseGtmPayload,
  productsCover,
  serializeGtmPayload,
} from "./gtm-payload";
import type { TrackingKeyIndex } from "./tracking-keys";

const index: TrackingKeyIndex = {
  products: [
    {
      slug: "ai-engineering",
      content_type: "program",
      product_id: "program-ai-engineering",
      name: "AI Engineering",
      key: "aie",
      active: true,
      personas: [{ id: "the-career-changer", name: "The Career Changer", key: "cc" }],
      retired: [],
    },
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

describe("parseGtmPayload", () => {
  it("reads the {{ funnel.products }} list shape", () => {
    const raw = '[{"product":"ai-flex","persona":"the-explorer"},{"product":"ai-engineering"}]';
    expect(parseGtmPayload(raw)).toEqual({
      kind: "legacy_list",
      bindings: [{ product: "ai-flex", persona: "the-explorer" }, { product: "ai-engineering" }],
    });
    expect(parseGtmPayload("all")).toEqual({ kind: "legacy_list", bindings: "all" });
  });

  it("reads the three-key full-id object, including a still-encoded fallback", () => {
    const json = '{"product":"ai-fluency","persona":"The-Business-Owner","product_persona":"ai-fluency:The-Business-Owner"}';
    expect(parseGtmPayload(json)?.kind).toBe("legacy_ids");
    expect(parseGtmPayload(encodeURIComponent(json))?.kind).toBe("legacy_ids");
  });

  it("tells v1 and custom overrides apart", () => {
    expect(parseGtmPayload('{"v":1,"product":"afx"}')).toEqual({ kind: "v1", fields: { product: "afx" } });
    expect(parseGtmPayload('{"persona":"cc"}')).toEqual({ kind: "custom", fields: { persona: "cc" } });
  });

  it("returns null for empty or unreadable values (incl. an unresolved template)", () => {
    expect(parseGtmPayload("")).toBeNull();
    expect(parseGtmPayload(null)).toBeNull();
    expect(parseGtmPayload("{{ funnel.products }}")).toBeNull();
  });

  it("applies the receiver caps", () => {
    const long = "x".repeat(GTM_PAYLOAD_VALUE_MAX + 20);
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, "1"]));
    const parsed = parseGtmPayload(JSON.stringify({ v: 1, a: long, "Bad-Key": "x", obj: { a: 1 }, ...many }));
    expect(parsed?.kind).toBe("v1");
    const fields = parsed!.kind === "v1" ? parsed!.fields : {};
    expect(fields.a).toHaveLength(GTM_PAYLOAD_VALUE_MAX);
    expect(fields["Bad-Key"]).toBeUndefined();
    expect(fields.obj).toBeUndefined();
    expect(Object.keys(fields).length).toBe(GTM_PAYLOAD_MAX_KEYS);
  });
});

describe("serializeGtmPayload", () => {
  it("puts v first and keeps the legacy key names", () => {
    const json = serializeGtmPayload({ product: "afx", persona: "exp", product_persona: "afx:exp", ts: 1, is_staff: true });
    expect(json.startsWith('{"v":1,')).toBe(true);
    const back = parseGtmPayload(json);
    expect(back?.kind).toBe("v1");
    expect(back && "fields" in back ? Object.keys(back.fields) : []).toEqual(
      expect.arrayContaining(["product", "persona", "product_persona"]),
    );
  });
});

describe("mergeGtmPayload", () => {
  const auto = { product: "afx", persona: "exp", product_persona: "afx:exp" };

  it("replaces pass-along shapes", () => {
    expect(mergeGtmPayload(auto, parseGtmPayload('[{"product":"ai-engineering"}]'))).toEqual(auto);
    expect(
      mergeGtmPayload(auto, parseGtmPayload('{"product":"ai-x","persona":"p","product_persona":"ai-x:p"}')),
    ).toEqual(auto);
    expect(mergeGtmPayload(auto, parseGtmPayload('{"v":1,"product":"aie"}'))).toEqual(auto);
  });

  it("lets custom keys win key by key", () => {
    expect(mergeGtmPayload(auto, parseGtmPayload('{"persona":"cc","campaign":"x"}'))).toEqual({
      ...auto,
      persona: "cc",
      campaign: "x",
    });
  });
});

describe("gtmPayloadToCodes", () => {
  it("translates legacy full ids to codes", () => {
    expect(
      gtmPayloadToCodes(parseGtmPayload('[{"product":"ai-flex","persona":"the-explorer"}]')!, index),
    ).toEqual({ product: "afx", persona: "exp", product_persona: "afx:exp" });
    const ids = '{"product":"ai-engineering,ai-flex","persona":"the-career-changer","product_persona":"ai-engineering:the-career-changer,ai-flex:"}';
    expect(gtmPayloadToCodes(parseGtmPayload(ids)!, index)).toEqual({
      product: "afx,aie",
      persona: "cc",
      product_persona: "afx:,aie:cc",
    });
  });

  it("keeps sentinels and unknown ids", () => {
    expect(gtmPayloadToCodes(parseGtmPayload("all")!, index).product).toBe("all");
    expect(gtmPayloadToCodes(parseGtmPayload("[]")!, index).product).toBe("none");
    expect(gtmPayloadToCodes(parseGtmPayload('[{"product":"mystery"}]')!, index).product).toBe("mystery");
  });
});

describe("productsCover", () => {
  it("keeps the memory when the page covers every remembered product", () => {
    expect(productsCover("all", "afx")).toBe(true);
    expect(productsCover("afx,aie,aif", "afx")).toBe(true);
    expect(productsCover("afx,aie", "afx,aie")).toBe(true);
  });

  it("replaces it for different products or an empty memory", () => {
    expect(productsCover("aie", "afx")).toBe(false);
    expect(productsCover("afx", "afx,aie")).toBe(false);
    expect(productsCover("afx", "all")).toBe(false);
    expect(productsCover("afx", undefined)).toBe(false);
  });
});

describe("skip domains", () => {
  it("normalizes entries", () => {
    expect(normalizeSkipDomain("https://Pay.Stripe.com/x?y")).toBe("pay.stripe.com");
    expect(normalizeSkipDomain("*.paypal.com")).toBe("paypal.com");
    expect(normalizeSkipDomain("not a domain")).toBeNull();
    expect(normalizeSkipDomains(["stripe.com", "STRIPE.com", "", 3])).toEqual(["stripe.com"]);
  });

  it("matches the domain and its subdomains only", () => {
    expect(hostMatchesSkipList("checkout.stripe.com", ["stripe.com"])).toBe(true);
    expect(hostMatchesSkipList("stripe.com", ["stripe.com"])).toBe(true);
    expect(hostMatchesSkipList("notstripe.com", ["stripe.com"])).toBe(false);
  });
});

describe("hasGtmPayloadPassAlongToken", () => {
  it("detects the {qs:} pass-along token", () => {
    expect(hasGtmPayloadPassAlongToken("https://4geeks.com/checkout?plan=x&gtm_payload={qs:gtm_payload|%7B%7D}")).toBe(true);
    expect(hasGtmPayloadPassAlongToken("https://4geeks.com/checkout?gtm_payload=%7B%7D")).toBe(false);
  });
});
