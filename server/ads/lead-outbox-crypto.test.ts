import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptLeadOutbox,
  encryptLeadOutbox,
  LEAD_OUTBOX_KEY_ENV,
  LEAD_OUTBOX_PREVIOUS_KEY_ENV,
  LeadOutboxDecryptError,
  leadOutboxKeyStatus,
} from "./lead-outbox-crypto";

const KEY_A = crypto.randomBytes(32).toString("hex");
const KEY_B = crypto.randomBytes(32).toString("hex");

describe("lead outbox crypto", () => {
  const saved = { current: process.env[LEAD_OUTBOX_KEY_ENV], previous: process.env[LEAD_OUTBOX_PREVIOUS_KEY_ENV] };
  beforeEach(() => {
    process.env[LEAD_OUTBOX_KEY_ENV] = KEY_A;
    delete process.env[LEAD_OUTBOX_PREVIOUS_KEY_ENV];
  });
  afterEach(() => {
    if (saved.current === undefined) delete process.env[LEAD_OUTBOX_KEY_ENV];
    else process.env[LEAD_OUTBOX_KEY_ENV] = saved.current;
    if (saved.previous === undefined) delete process.env[LEAD_OUTBOX_PREVIOUS_KEY_ENV];
    else process.env[LEAD_OUTBOX_PREVIOUS_KEY_ENV] = saved.previous;
  });

  it("round-trips with the current key and never stores plaintext", () => {
    const enc = encryptLeadOutbox('{"email":"a@b.com"}');
    expect(enc).toMatch(/^enc:v1:/);
    expect(enc).not.toContain("a@b.com");
    expect(decryptLeadOutbox(enc!)).toBe('{"email":"a@b.com"}');
  });

  it("returns null and reports missing when the key is not set", () => {
    delete process.env[LEAD_OUTBOX_KEY_ENV];
    expect(leadOutboxKeyStatus()).toBe("missing");
    expect(encryptLeadOutbox("x")).toBeNull();
  });

  it("treats a malformed key as missing", () => {
    process.env[LEAD_OUTBOX_KEY_ENV] = "not-hex";
    expect(leadOutboxKeyStatus()).toBe("missing");
  });

  it("reads rows saved before a rotation with the previous key", () => {
    const enc = encryptLeadOutbox("old lead")!;
    process.env[LEAD_OUTBOX_KEY_ENV] = KEY_B;
    process.env[LEAD_OUTBOX_PREVIOUS_KEY_ENV] = KEY_A;
    expect(decryptLeadOutbox(enc)).toBe("old lead");
    const fresh = encryptLeadOutbox("new lead")!;
    delete process.env[LEAD_OUTBOX_PREVIOUS_KEY_ENV];
    expect(decryptLeadOutbox(fresh)).toBe("new lead");
  });

  it("throws LeadOutboxDecryptError when neither key can read the copy", () => {
    const enc = encryptLeadOutbox("lost")!;
    process.env[LEAD_OUTBOX_KEY_ENV] = KEY_B;
    expect(() => decryptLeadOutbox(enc)).toThrow(LeadOutboxDecryptError);
    expect(() => decryptLeadOutbox("plain")).toThrow(LeadOutboxDecryptError);
  });
});
