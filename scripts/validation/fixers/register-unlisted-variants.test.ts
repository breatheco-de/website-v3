import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { markFileAsModified } = vi.hoisted(() => ({ markFileAsModified: vi.fn() }));
vi.mock("../../../server/sync-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/sync-state")>()),
  markFileAsModified,
}));

import { resetRegistry } from "../../../server/content-types";
import { registerUnlistedVariantsFixer } from "./draft-integrity";

let tmp: string;
let root: string;

function writeYaml(rel: string, data: unknown) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, yaml.dump(data), "utf-8");
  return p;
}

beforeEach(() => {
  markFileAsModified.mockClear();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "register-unlisted-"));
  root = path.join(tmp, "site_test");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "content-types.yml"), "landing:\n  directory: landings\n", "utf-8");
  resetRegistry(root);
  writeYaml("landings/promo/en.yml", { title: "Live" });
  writeYaml("landings/promo/rewrite.en.yml", { title: "Rewrite" });
  writeYaml("landings/other/en.yml", { title: "Live" });
  writeYaml("landings/other/draft.es.yml", { title: "Borrador" });
  writeYaml("landings/other/versioning.yml", { en: { variants: [{ slug: "test-a", allocation: 50 }] } });
});

afterEach(() => {
  resetRegistry(root);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("register-unlisted-variants fixer", () => {
  it("dry run reports without writing", async () => {
    const res = await registerUnlistedVariantsFixer.run({ contentRoot: root, dryRun: true });
    expect(res.ok).toBe(true);
    expect((res.details as any).variants).toHaveLength(2);
    expect(fs.existsSync(path.join(root, "landings/promo/versioning.yml"))).toBe(false);
    expect(markFileAsModified).not.toHaveBeenCalled();
  });

  it("registers at 0% and keeps existing entries and traffic", async () => {
    await registerUnlistedVariantsFixer.run({ contentRoot: root, dryRun: false });

    const promo = yaml.load(fs.readFileSync(path.join(root, "landings/promo/versioning.yml"), "utf-8"));
    expect(promo).toEqual({ en: { variants: [{ slug: "rewrite", allocation: 0 }] } });
    const other = yaml.load(fs.readFileSync(path.join(root, "landings/other/versioning.yml"), "utf-8"));
    expect(other).toEqual({
      en: { variants: [{ slug: "test-a", allocation: 50 }] },
      es: { variants: [{ slug: "draft", allocation: 0 }] },
    });
    expect(markFileAsModified).toHaveBeenCalledTimes(2);

    const again = await registerUnlistedVariantsFixer.run({ contentRoot: root, dryRun: false });
    expect((again.details as any).variants).toHaveLength(0);
  });
});
