import { describe, expect, it } from "vitest";
import { injectPageTrackingDataLayer } from "./html-inject";

const html = "<html><head><title>x</title>\n<!-- Google Tag Manager -->\n<script>gtm()</script></head><body></body></html>";
const payload = {
  queries: [
    { queryKey: ["/api/x"], data: { _tracking: { product: "aie", persona: "cc", content_key: "landing:apply", bad: 1 } } },
  ],
};

describe("injectPageTrackingDataLayer", () => {
  it("pushes the page tracking values before the GTM snippet, once", () => {
    const once = injectPageTrackingDataLayer(html, payload);
    expect(once).toContain(
      '<script id="__PAGE_TRACKING__">window.dataLayer=window.dataLayer||[];window.dataLayer.push({"product":"aie","persona":"cc","content_key":"landing:apply"});</script>\n<!-- Google Tag Manager',
    );
    const twice = injectPageTrackingDataLayer(once, payload);
    expect(twice.match(/__PAGE_TRACKING__/g)).toHaveLength(1);
  });

  it("removes a stale copy when the page has no tracking values", () => {
    const once = injectPageTrackingDataLayer(html, payload);
    expect(injectPageTrackingDataLayer(once, { queries: [{ queryKey: ["x"], data: {} }] })).toBe(html);
  });

  it("escapes < so values can't close the script tag", () => {
    const out = injectPageTrackingDataLayer(html, { queries: [{ data: { _tracking: { product: "</script>" } } }] });
    expect(out).toContain("\\u003c/script>");
  });
});
