import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  readEntryProduct,
  writeEntryProduct,
} from "./product-io";
import { scanProductContent } from "./product-index";

describe("product-io", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "product-io-"));
    // Minimal content layout
    const prog = path.join(tmp, "programs", "full-stack");
    fs.mkdirSync(prog, { recursive: true });
    fs.writeFileSync(
      path.join(prog, "_product.yml"),
      [
        "purchasable: true",
        "product_id: program-full-stack",
        "name: Full Stack",
        "actively_selling: true",
        "offer:",
        '  one_liner: "Learn to code"',
        '  who_its_for: "Career changers"',
        "personas:",
        "  - id: career-changer",
        '    role: "Career switcher"',
        "    avatar:",
        "      fears:",
        '        - "Failing"',
        '      internal_dialogue: "Can I do this?"',
        "      objections:",
        '        - "Time"',
        "",
      ].join("\n"),
      "utf-8",
    );
    // content-types stub — product index walks type dirs from getAllConfigs
    // Use scan with contentRoot pointing at tmp; need content-types.yml
    fs.writeFileSync(
      path.join(tmp, "content-types.yml"),
      ["program:", "  directory: programs", "  url_pattern:", "    en: /us/:slug", ""].join("\n"),
    );
    scanProductContent(tmp);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reads product snapshot with audience status", () => {
    const snap = readEntryProduct("program", "full-stack", tmp);
    expect(snap).not.toBeNull();
    expect(snap!.audience_status).toBe("minimal");
  });

  it("patches actively_selling for staff", () => {
    const result = writeEntryProduct(
      "program",
      "full-stack",
      { actively_selling: false },
      tmp,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.actively_selling).toBe(false);
  });

  it("refuses purchasable false", () => {
    const result = writeEntryProduct(
      "program",
      "full-stack",
      { purchasable: false },
      tmp,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("purchasable_remove_forbidden");
  });

  it("upserts persona and deep-merges offer", () => {
    const result = writeEntryProduct(
      "program",
      "full-stack",
      {
        offer: { who_its_not_for: "Kids" },
        personas: [
          {
            id: "career-changer",
            avatar: { fears: ["Failing", "Debt"] },
          },
        ],
      },
      tmp,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.offer?.who_its_not_for).toBe("Kids");
    expect(result.product.offer?.one_liner).toBe("Learn to code");
    expect(result.product.personas?.[0]?.avatar.fears).toEqual(["Failing", "Debt"]);
    expect(result.product.personas?.[0]?.role).toBe("Career switcher");
  });

  it("refuses clearing the last persona", () => {
    const result = writeEntryProduct(
      "program",
      "full-stack",
      { clear_personas: ["career-changer"] },
      tmp,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("last_persona");
  });
});
