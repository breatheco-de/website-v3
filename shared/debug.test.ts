import { afterEach, describe, expect, it } from "vitest";
import { applyDebugFromArgv, isWeblifyDebug } from "./debug";

describe("isWeblifyDebug", () => {
  afterEach(() => {
    delete process.env.DEBUG;
    delete process.env.WEBLIFY_DEBUG;
  });

  it("is false by default", () => {
    expect(isWeblifyDebug([])).toBe(false);
  });

  it("accepts --debug", () => {
    expect(isWeblifyDebug(["node", "cli", "--debug"])).toBe(true);
  });

  it("accepts DEBUG=true and DEBUG=1 only", () => {
    process.env.DEBUG = "true";
    expect(isWeblifyDebug([])).toBe(true);
    process.env.DEBUG = "1";
    expect(isWeblifyDebug([])).toBe(true);
    process.env.DEBUG = "express:*";
    expect(isWeblifyDebug([])).toBe(false);
  });

  it("accepts WEBLIFY_DEBUG", () => {
    process.env.WEBLIFY_DEBUG = "1";
    expect(isWeblifyDebug([])).toBe(true);
  });

  it("applyDebugFromArgv sets WEBLIFY_DEBUG", () => {
    applyDebugFromArgv(["--debug"]);
    expect(process.env.WEBLIFY_DEBUG).toBe("1");
  });
});
