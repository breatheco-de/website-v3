import { describe, expect, it, vi, afterEach } from "vitest";
import { parseArgs } from "../src/parse-args";

describe("resolveConfig production refuse create", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.NODE_ENV;
    delete process.env.WEBLIFY_MODE;
  });

  it("parseArgs marks production", () => {
    expect(parseArgs(["--production"]).production).toBe(true);
  });
});
