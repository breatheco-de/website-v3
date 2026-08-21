import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentFolderFromRegistryPath,
  isComponentRegistryContentPath,
  mirrorComponentRegistryToPersistent,
  resolvePersistentRoot,
} from "./component-registry-persistent";

describe("component-registry-persistent", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it("detects registry paths and site folders", () => {
    expect(
      isComponentRegistryContentPath(
        "site_4geeks-com/component-registry/hero/v1.0/schema.ts",
      ),
    ).toBe(true);
    expect(isComponentRegistryContentPath("site_4geeks-com/pages/home/en.yml")).toBe(
      false,
    );
    expect(
      contentFolderFromRegistryPath(
        "site_4geeks-com/component-registry/hero/v1.0/schema.ts",
      ),
    ).toBe("site_4geeks-com");
  });

  it("no-ops when persistent/ is missing (local dev)", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "reg-mirror-nop-"));
    cleanups.push(() => fs.rmSync(cwd, { recursive: true, force: true }));
    expect(resolvePersistentRoot(cwd)).toBeNull();
    expect(mirrorComponentRegistryToPersistent("site_4geeks-com", cwd)).toEqual({
      mirrored: false,
      reason: "no persistent/ sibling of cwd",
    });
  });

  it("mirrors release registry tree into persistent/", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "reg-mirror-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const release = path.join(root, "releases", "abc");
    const persistent = path.join(root, "persistent");
    fs.mkdirSync(release, { recursive: true });
    fs.mkdirSync(persistent, { recursive: true });

    const releaseReg = path.join(
      release,
      "site_4geeks-com",
      "component-registry",
      "hero",
    );
    fs.mkdirSync(releaseReg, { recursive: true });
    fs.writeFileSync(path.join(releaseReg, "schema.ts"), "export const x = 1;\n");

    // Stale file only in persistent — should disappear after mirror
    const stale = path.join(
      persistent,
      "site_4geeks-com",
      "component-registry",
      "old",
      "gone.yml",
    );
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, "stale\n");

    const result = mirrorComponentRegistryToPersistent("site_4geeks-com", release);
    expect(result.mirrored).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          persistent,
          "site_4geeks-com",
          "component-registry",
          "hero",
          "schema.ts",
        ),
      ),
    ).toBe(true);
    expect(fs.existsSync(stale)).toBe(false);
  });
});
