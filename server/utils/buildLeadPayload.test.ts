import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../settings", () => ({
  getTrackingSettings: () => ({
    conversion_events: [
      {
        name: "event_order",
        tags: ["workshop"],
        automations: "strong",
      },
    ],
    webhook: undefined,
  }),
  getSettingsPathForDiagnostics: () => "settings.yml",
}));

import { buildLeadPayload } from "./buildLeadPayload";

describe("buildLeadPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps program to course and keeps BC renames", () => {
    const out = buildLeadPayload({
      email: "a@b.com",
      program: "full-stack",
      consent_whatsapp: true,
      sms_consent: false,
      language: "es",
    });
    expect(out.course).toBe("full-stack");
    expect(out.program).toBeUndefined();
    expect(out.consent).toBe(true);
    expect(out.consent_whatsapp).toBeUndefined();
    expect(out.language).toBe("es");
    expect(out.utm_language).toBe("es");
    expect(out.action).toBe("submit");
  });

  it("merges scalar extras like event_id without dropping known fields", () => {
    const out = buildLeadPayload({
      email: "a@b.com",
      program: "ai",
      event_id: "99",
      event_slug: "ai-lab",
      conversion_name: "event_order",
    });
    expect(out.course).toBe("ai");
    expect(out.event_id).toBe("99");
    expect(out.event_slug).toBe("ai-lab");
    expect(out.conversion_name).toBeUndefined();
    expect(out.tags).toBe("workshop");
  });

  it("merges numeric event_id from resolveDeep without stringifying away", () => {
    const out = buildLeadPayload({
      email: "a@b.com",
      event_id: 2537,
    });
    expect(out.event_id).toBe(2537);
  });

  it("folds ref into referral and skips empty extras", () => {
    const out = buildLeadPayload({
      email: "a@b.com",
      ref: "partner",
      event_id: "",
    });
    expect(out.referral).toBe("partner");
    expect(out.ref).toBeUndefined();
    expect(out.event_id).toBeUndefined();
  });
});
