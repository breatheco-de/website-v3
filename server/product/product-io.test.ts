import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  readEntryProduct,
  writeEntryProduct,
  listProductRows,
} from "./product-io";
import { scanProductContent } from "./product-index";

describe("product-io", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "product-io-"));
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
    fs.writeFileSync(
      path.join(tmp, "content-types.yml"),
      [
        "program:",
        "  directory: programs",
        "  url_pattern:",
        "    en: /us/:slug",
        "  products:",
        "    allow_sellable_entries: true",
        "",
      ].join("\n"),
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
    expect(snap!.purchasable).toBe(true);
  });

  it("list rows include urls map", () => {
    const rows = listProductRows({ contentRoot: tmp });
    expect(rows).toHaveLength(1);
    expect(rows[0].urls).toEqual(expect.any(Object));
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

  it("soft-removes with purchasable false and keeps audience", () => {
    const result = writeEntryProduct(
      "program",
      "full-stack",
      { purchasable: false },
      tmp,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.purchasable).toBe(false);
    expect(result.product.offer?.one_liner).toBe("Learn to code");
    expect(listProductRows({ contentRoot: tmp })).toHaveLength(0);
    expect(listProductRows({ contentRoot: tmp, includeRemoved: true })).toHaveLength(1);
  });

  it("re-enables removed product", () => {
    writeEntryProduct("program", "full-stack", { purchasable: false }, tmp);
    const result = writeEntryProduct("program", "full-stack", { purchasable: true }, tmp);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.purchasable).toBe(true);
  });

  it("allows audience patch while removed", () => {
    writeEntryProduct("program", "full-stack", { purchasable: false }, tmp);
    const result = writeEntryProduct(
      "program",
      "full-stack",
      { offer: { who_its_not_for: "Kids" } },
      tmp,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.purchasable).toBe(false);
    expect(result.product.offer?.who_its_not_for).toBe("Kids");
  });

  it("creates sellable product for empty entry", () => {
    const dir = path.join(tmp, "programs", "data-science");
    fs.mkdirSync(dir, { recursive: true });
    const result = writeEntryProduct(
      "program",
      "data-science",
      { purchasable: true },
      tmp,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.purchasable).toBe(true);
    expect(result.product.product_id).toBe("program-data-science");
    expect(result.product.audience_status).toBe("missing");
    expect(result.warnings.map((w) => w.code)).toContain("thin_create");
  });

  it("creates sellable product with offer and personas in the same call", () => {
    const dir = path.join(tmp, "programs", "esol");
    fs.mkdirSync(dir, { recursive: true });
    const result = writeEntryProduct(
      "program",
      "esol",
      {
        purchasable: true,
        actively_selling: false,
        offer: { one_liner: "English for work", who_its_for: "New arrivals" },
        personas: [
          {
            id: "new-arrival-job-seeker",
            role: "Job seeker",
            avatar: {
              fears: ["Interviews"],
              internal_dialogue: "Will they understand me?",
              objections: ["No time"],
            },
          },
          { id: "citizenship-candidate", role: "Citizenship applicant" },
        ],
      },
      tmp,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.purchasable).toBe(true);
    expect(result.product.actively_selling).toBe(false);
    expect(result.product.offer?.one_liner).toBe("English for work");
    expect(result.product.personas?.map((p) => p.id)).toEqual([
      "new-arrival-job-seeker",
      "citizenship-candidate",
    ]);
    expect(result.product.audience_status).not.toBe("missing");
    expect(result.warnings.map((w) => w.code)).not.toContain("thin_create");
  });

  it("rejects create with invalid audience and writes nothing", () => {
    const dir = path.join(tmp, "programs", "esol");
    fs.mkdirSync(dir, { recursive: true });
    const result = writeEntryProduct(
      "program",
      "esol",
      {
        purchasable: true,
        offer: { one_liner: "English for work", who_its_for: "New arrivals" },
        personas: [{ id: "  ", role: "Job seeker" }],
      },
      tmp,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_persona");
    expect(fs.existsSync(path.join(dir, "_product.yml"))).toBe(false);
  });

  it("fails create when product_id collides", () => {
    const dir = path.join(tmp, "programs", "other");
    fs.mkdirSync(dir, { recursive: true });
    const result = writeEntryProduct(
      "program",
      "other",
      { purchasable: true, product_id: "program-full-stack" },
      tmp,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("product_id_collision");
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
    expect(result.product.personas?.[0]?.avatar.fears).toEqual(["Failing", "Debt"]);
  });
});
