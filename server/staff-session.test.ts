import { describe, expect, it, beforeEach } from "vitest";
import {
  _resetStaffSessionsForTests,
  createStaffSession,
  createSessionExchangeCode,
  consumeSessionExchangeCode,
  getStaffSession,
  revokeAllStaffSessions,
  revokeStaffSession,
} from "./staff-session";

describe("staff-session", () => {
  beforeEach(() => {
    _resetStaffSessionsForTests();
  });

  it("creates and retrieves a session", async () => {
    const session = await createStaffSession("alice");
    const got = await getStaffSession(session.token);
    expect(got?.username).toBe("alice");
  });

  it("revokes one session", async () => {
    const session = await createStaffSession("alice");
    expect(await revokeStaffSession(session.token)).toBe(true);
    expect(await getStaffSession(session.token)).toBeNull();
  });

  it("revokes all sessions for a user", async () => {
    const a = await createStaffSession("alice");
    const b = await createStaffSession("alice");
    const c = await createStaffSession("bob");
    expect(await revokeAllStaffSessions("alice")).toBe(2);
    expect(await getStaffSession(a.token)).toBeNull();
    expect(await getStaffSession(b.token)).toBeNull();
    expect(await getStaffSession(c.token)).not.toBeNull();
  });

  it("exchanges a one-time code once", async () => {
    const session = await createStaffSession("alice");
    const code = createSessionExchangeCode(session.token);
    expect(consumeSessionExchangeCode(code)).toBe(session.token);
    expect(consumeSessionExchangeCode(code)).toBeNull();
  });
});
