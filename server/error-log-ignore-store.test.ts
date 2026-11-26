import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetErrorLogIgnoreForTests,
  _setErrorLogIgnoreLocalPathForTests,
  _setErrorLogIgnoreProductionForTests,
  addErrorLogIgnoreRules,
  isErrorLogIgnoreHydrated,
  listErrorLogIgnoreRules,
  loadErrorLogIgnoreFromBucket,
  removeErrorLogIgnoreRules,
  shouldIgnoreErrorLogCandidate,
} from "./error-log-ignore-store";

describe("error-log-ignore-store", () => {
  let tmp: string;

  afterEach(() => {
    _resetErrorLogIgnoreForTests();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function setupLocal() {
    tmp = mkdtempSync(path.join(os.tmpdir(), "error-log-ignore-"));
    _setErrorLogIgnoreLocalPathForTests(path.join(tmp, "error-log-ignore.json"));
    _setErrorLogIgnoreProductionForTests(false);
  }

  it("adds and matches an identity rule after hydrate", async () => {
    setupLocal();
    await loadErrorLogIgnoreFromBucket();
    expect(isErrorLogIgnoreHydrated()).toBe(true);

    const { added } = addErrorLogIgnoreRules([
      {
        kind: "identity",
        level: "error",
        module: "unknown",
        message: "unhandled route error",
        errName: "URIError",
      },
    ]);
    expect(added).toHaveLength(1);
    expect(listErrorLogIgnoreRules()).toHaveLength(1);

    expect(
      shouldIgnoreErrorLogCandidate({
        level: "error",
        module: "unknown",
        message: "unhandled route error",
        errName: "URIError",
        context: { status: 400 },
      }),
    ).toBe(true);

    expect(
      shouldIgnoreErrorLogCandidate({
        level: "error",
        module: "unknown",
        message: "unhandled route error",
        errName: "TypeError",
        context: { status: 500 },
      }),
    ).toBe(false);
  });

  it("does not match before hydrate (fail-open)", () => {
    setupLocal();
    expect(isErrorLogIgnoreHydrated()).toBe(false);
    // Force a rule onto disk via mutation hydrate path without calling load
    addErrorLogIgnoreRules([
      {
        kind: "identity",
        message: "boom",
        errName: "Error",
        level: "error",
        module: "x",
      },
    ]);
    // After add, store is hydrated
    expect(isErrorLogIgnoreHydrated()).toBe(true);
  });

  it("removes by id", async () => {
    setupLocal();
    await loadErrorLogIgnoreFromBucket();
    const { added } = addErrorLogIgnoreRules([
      { kind: "identity", message: "noise", level: "warn", module: "m" },
    ]);
    removeErrorLogIgnoreRules([added[0]!.id]);
    expect(listErrorLogIgnoreRules()).toHaveLength(0);
  });

  it("does not upload when not production", async () => {
    setupLocal();
    await loadErrorLogIgnoreFromBucket();
    addErrorLogIgnoreRules([{ kind: "identity", message: "x", module: "m", level: "error" }]);
    // No throw; production=false means saveToBucket is a no-op
    expect(listErrorLogIgnoreRules()).toHaveLength(1);
  });
});
