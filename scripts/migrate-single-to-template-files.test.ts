import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { migrateShellBasename } from "@shared/sharedLayoutPaths";

/**
 * Mirrors scripts/migrate-single-to-template-files.ts rename+delete logic
 * against a temp type-root directory.
 */
function migrateTypeDir(typeDir: string): { renamed: string[]; deleted: string[] } {
  const renamed: string[] = [];
  const deleted: string[] = [];
  for (const name of fs.readdirSync(typeDir)) {
    const migrated = migrateShellBasename(name);
    if (!migrated) continue;
    const fromAbs = path.join(typeDir, name);
    const toAbs = path.join(typeDir, migrated);
    if (fs.existsSync(toAbs)) {
      fs.unlinkSync(fromAbs);
      deleted.push(name);
    } else {
      fs.renameSync(fromAbs, toAbs);
      renamed.push(`${name}→${migrated}`);
    }
  }
  return { renamed, deleted };
}

describe("migrate-single-to-template-files logic", () => {
  it("renames live, variant, and common shells", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-shell-"));
    fs.writeFileSync(path.join(dir, "_common.single.yml"), "meta: {}\n");
    fs.writeFileSync(path.join(dir, "single.en.yml"), "sections: []\n");
    fs.writeFileSync(path.join(dir, "single.draft.es.yml"), "sections: []\n");
    fs.mkdirSync(path.join(dir, "post"), { recursive: true });
    fs.writeFileSync(path.join(dir, "post", "en.yml"), "title: x\n");

    const { renamed, deleted } = migrateTypeDir(dir);
    expect(deleted).toEqual([]);
    expect(renamed.sort()).toEqual([
      "_common.single.yml→_common.template.yml",
      "single.draft.es.yml→template.draft.es.yml",
      "single.en.yml→template.en.yml",
    ].sort());
    expect(fs.existsSync(path.join(dir, "template.en.yml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "single.en.yml"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "post", "en.yml"))).toBe(true);
  });

  it("keeps template.* and deletes sibling single.*", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-shell-both-"));
    fs.writeFileSync(path.join(dir, "single.en.yml"), "legacy\n");
    fs.writeFileSync(path.join(dir, "template.en.yml"), "prefer\n");
    const { deleted } = migrateTypeDir(dir);
    expect(deleted).toContain("single.en.yml");
    expect(fs.readFileSync(path.join(dir, "template.en.yml"), "utf-8")).toBe("prefer\n");
    expect(fs.existsSync(path.join(dir, "single.en.yml"))).toBe(false);
  });
});
