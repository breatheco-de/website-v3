import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.ts");

describe("shared/schema.ts site coupling", () => {
  it("does not import site_4geeks-com directly (use site-component-schemas bridge)", () => {
    const source = readFileSync(schemaPath, "utf8");
    expect(source).not.toMatch(/site_4geeks-com/);
  });
});
