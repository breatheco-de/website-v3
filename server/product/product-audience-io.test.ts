import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  assertAudienceUpdateAllowed,
  getProductPersonaUsageMap,
  writeEntryAudience,
  type ProductAudience,
} from "./product-audience-io";
import { scanProductContent } from "./product-index";

const minimalPersona = (id: string): ProductAudience["personas"][number] => ({
  id,
  role: "Career switcher",
  avatar: {
    fears: ["Failing"],
    internal_dialogue: "Can I do this?",
    objections: ["Time"],
  },
});

const minimalAudience = (personaIds: string[]): ProductAudience => ({
  offer: {
    one_liner: "Learn to code",
    who_its_for: "Career changers",
  },
  personas: personaIds.map(minimalPersona),
});

describe("product-audience persona rename / usage", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "product-audience-"));
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
      ["program:", "  directory: programs", "  url_pattern:", "    en: /us/:slug", ""].join("\n"),
    );
    scanProductContent(tmp);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("allows renaming a persona id when unbound", () => {
    const next = minimalAudience(["career-switcher"]);
    const allowed = assertAudienceUpdateAllowed("program", "full-stack", next, tmp);
    expect(allowed).toEqual({ ok: true });

    const written = writeEntryAudience("program", "full-stack", next, tmp);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.audience.personas.map((p) => p.id)).toEqual(["career-switcher"]);
  });

  it("blocks rename when a funnel page binds the old id (incl. self)", () => {
    fs.writeFileSync(
      path.join(tmp, "programs", "full-stack", "_common.yml"),
      [
        "funnel:",
        "  stage: decision",
        "  products:",
        "    - product: full-stack",
        "      persona: career-changer",
        "",
      ].join("\n"),
      "utf-8",
    );

    const usage = getProductPersonaUsageMap("full-stack", tmp);
    expect(usage["career-changer"]?.pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ contentType: "program", slug: "full-stack" }),
      ]),
    );

    const next = minimalAudience(["career-switcher"]);
    const allowed = assertAudienceUpdateAllowed("program", "full-stack", next, tmp);
    expect(allowed.ok).toBe(false);
    if (allowed.ok) return;
    expect(allowed.code).toBe("persona_in_use");
  });

  it("blocks rename when another landing binds the persona", () => {
    const landing = path.join(tmp, "programs", "mofu-landing");
    fs.mkdirSync(landing, { recursive: true });
    fs.writeFileSync(
      path.join(landing, "_common.yml"),
      [
        "funnel:",
        "  stage: consideration",
        "  products:",
        "    - product: full-stack",
        "      persona: career-changer",
        "",
      ].join("\n"),
      "utf-8",
    );

    const next = minimalAudience(["career-switcher"]);
    const allowed = assertAudienceUpdateAllowed("program", "full-stack", next, tmp);
    expect(allowed.ok).toBe(false);
    if (allowed.ok) return;
    expect(allowed.code).toBe("persona_in_use");
    expect((allowed.details as { pages: { slug: string }[] }).pages.some((p) => p.slug === "mofu-landing")).toBe(
      true,
    );
  });

  it("rejects duplicate persona ids", () => {
    const next: ProductAudience = {
      offer: { one_liner: "Learn to code", who_its_for: "Career changers" },
      personas: [minimalPersona("career-changer"), minimalPersona("career-changer")],
    };
    const allowed = assertAudienceUpdateAllowed("program", "full-stack", next, tmp);
    expect(allowed.ok).toBe(false);
    if (allowed.ok) return;
    expect(allowed.code).toBe("duplicate_persona_id");
  });
});
