import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_SETTINGS, parseSessionSettings } from "./session-settings";

describe("parseSessionSettings", () => {
  it("defaults to None database with fill_from_ip on", () => {
    expect(parseSessionSettings(undefined)).toEqual(DEFAULT_SESSION_SETTINGS);
    expect(parseSessionSettings({})).toEqual({
      location: { database: null, fill_from_ip: true },
    });
  });

  it("reads database slug and fill_from_ip", () => {
    expect(
      parseSessionSettings({
        location: { database: "locations", fill_from_ip: false },
      }),
    ).toEqual({
      location: { database: "locations", fill_from_ip: false },
    });
  });

  it("treats empty database as null", () => {
    expect(parseSessionSettings({ location: { database: "  " } }).location.database).toBeNull();
  });
});
