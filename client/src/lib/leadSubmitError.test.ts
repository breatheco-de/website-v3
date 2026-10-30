import { describe, expect, it } from "vitest";
import { leadSubmitErrorMessage } from "./leadSubmitError";

const DEFAULT_EN = "There was a problem submitting your information. Please try again.";
const DEFAULT_ES = "Hubo un problema al enviar tu información. Por favor intenta de nuevo.";

/** Same shape the lead form throws: `${status}: ${body}`. */
function thrown(status: number, body: unknown): string {
  return `${status}: ${JSON.stringify(body)}`;
}

describe("leadSubmitErrorMessage", () => {
  it("shows the CRM's field message on a 400 / 422 rejection so the visitor can fix it", () => {
    const body = { error: "Upstream webhook returned a non-2xx response", details: '{"detail":"Invalid phone number"}' };
    expect(leadSubmitErrorMessage(thrown(502, body), "en")).toBe("Invalid phone number");
    const msg = { error: "Upstream webhook returned a non-2xx response", details: '{"message":"Email already registered"}' };
    expect(leadSubmitErrorMessage(thrown(502, msg), "en")).toBe("Email already registered");
  });

  it("never shows internal webhook labels, HTML or long text", () => {
    expect(leadSubmitErrorMessage(thrown(502, { error: "Failed to deliver webhook", details: "fetch failed" }), "en")).toBe("fetch failed");
    expect(leadSubmitErrorMessage(thrown(502, { error: "Upstream webhook returned a non-2xx response" }), "en")).toBe(DEFAULT_EN);
    expect(leadSubmitErrorMessage(thrown(502, { details: "<!DOCTYPE html><p>oops</p>" }), "en")).toBe(DEFAULT_EN);
    expect(leadSubmitErrorMessage(thrown(502, { details: "x".repeat(300) }), "en")).toBe(DEFAULT_EN);
    expect(leadSubmitErrorMessage("network down", "es")).toBe(DEFAULT_ES);
  });
});
