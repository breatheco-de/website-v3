import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import yaml from "js-yaml";
import { writeEntryProduct } from "./product-io";
import { scanProductContent } from "./product-index";
import { assignMissingShortKeys } from "./tracking-keys-assign";
import { invalidateTrackingKeyIndex } from "./tracking-key-index";

const persona = (id: string, extra: string[] = []) => [
  `  - id: ${id}`,
  ...extra,
  '    role: "Career switcher"',
  "    avatar:",
  "      fears:",
  '        - "Failing"',
  '      internal_dialogue: "Can I do this?"',
  "      objections:",
  '        - "Time"',
];

function writeProduct(root: string, slug: string, lines: string[]): void {
  const dir = path.join(root, "programs", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "_product.yml"), [...lines, ""].join("\n"), "utf-8");
}

function readDoc(root: string, slug: string): Record<string, any> {
  return yaml.load(fs.readFileSync(path.join(root, "programs", slug, "_product.yml"), "utf-8")) as Record<string, any>;
}

describe("tracking short keys on product writes", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tracking-keys-"));
    fs.writeFileSync(
      path.join(tmp, "content-types.yml"),
      ["program:", "  directory: programs", "  url_pattern:", "    en: /us/:slug", "  products:", "    allow_sellable_entries: true", ""].join("\n"),
    );
    writeProduct(tmp, "ai-engineering", [
      "purchasable: true",
      "product_id: program-ai-engineering",
      "name: AI Engineering",
      "offer:",
      '  one_liner: "Learn AI"',
      '  who_its_for: "Career changers"',
      "personas:",
      ...persona("the-career-changer", ['    label: "The Career Changer"']),
    ]);
    writeProduct(tmp, "ai-flex", [
      "purchasable: true",
      "product_id: program-ai-flex",
      "name: AI Flex",
      "short_key: afx",
      "offer:",
      '  one_liner: "Flex"',
      '  who_its_for: "Anyone"',
      "personas:",
      ...persona("the-explorer", ["    short_key: exp"]),
    ]);
    invalidateTrackingKeyIndex();
    scanProductContent(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("fills missing keys on save and reports them", () => {
    const result = writeEntryProduct("program", "ai-engineering", { description: "x" }, tmp);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.short_key).toBe("aie");
    expect(result.product.personas?.[0].short_key).toBe("cc");
    expect(result.warnings.map((w) => w.code)).toContain("short_keys_assigned");
  });

  it("locks a saved key unless rename_short_key is set, then retires the old one", () => {
    const locked = writeEntryProduct("program", "ai-flex", { short_key: "flx" }, tmp);
    expect(locked.ok).toBe(false);
    if (locked.ok) return;
    expect(locked.code).toBe("short_key_locked");

    const renamed = writeEntryProduct("program", "ai-flex", { short_key: "flx", rename_short_key: true }, tmp);
    expect(renamed.ok).toBe(true);
    const doc = readDoc(tmp, "ai-flex");
    expect(doc.short_key).toBe("flx");
    expect(doc.retired_short_keys).toEqual([
      expect.objectContaining({ key: "afx", type: "product", id: "ai-flex" }),
    ]);

    const reuse = writeEntryProduct("program", "ai-flex", { short_key: "afx", rename_short_key: true }, tmp);
    expect(reuse.ok).toBe(false);
  });

  it("rejects a persona key already used by another product", () => {
    const result = writeEntryProduct(
      "program",
      "ai-engineering",
      { personas: [{ id: "the-career-changer", short_key: "exp" }] },
      tmp,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("short_key_conflict");
  });

  it("retires a removed persona's key", () => {
    writeEntryProduct(
      "program",
      "ai-flex",
      { personas: [{ id: "second", role: "Second", avatar: { fears: ["f"], internal_dialogue: "d", objections: ["o"] } }] },
      tmp,
    );
    const result = writeEntryProduct("program", "ai-flex", { clear_personas: ["the-explorer"] }, tmp);
    expect(result.ok).toBe(true);
    const doc = readDoc(tmp, "ai-flex");
    expect(doc.retired_short_keys).toEqual([
      expect.objectContaining({ key: "exp", type: "persona", id: "the-explorer" }),
    ]);
  });

  it("assignMissingShortKeys previews on dry run and writes otherwise", () => {
    const dry = assignMissingShortKeys(tmp, { dryRun: true });
    expect(dry.assigned.map((a) => a.key).sort()).toEqual(["aie", "cc"]);
    expect(dry.files).toEqual([]);
    expect(readDoc(tmp, "ai-engineering").short_key).toBeUndefined();

    const real = assignMissingShortKeys(tmp);
    expect(real.files).toEqual(["programs/ai-engineering/_product.yml"]);
    expect(readDoc(tmp, "ai-engineering").short_key).toBe("aie");
    expect(assignMissingShortKeys(tmp).assigned).toEqual([]);
  });
});
