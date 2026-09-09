import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

function exportNames(source: string): { values: string[]; types: string[] } {
  const values = [...source.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);
  const types = [...source.matchAll(/^export type (\w+)/gm)].map((m) => m[1]);
  // re-export blocks from the real bridge
  const reExports: string[] = [];
  for (const m of source.matchAll(/export \{([^}]+)\}/gs)) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      reExports.push(t.replace(/^type\s+/, "").trim());
    }
  }
  return {
    values: values.length ? values : reExports.filter((n) => n.endsWith("Schema") || !/^[A-Z]/.test(n)),
    types: types.length
      ? types
      : reExports.filter((n) => !n.endsWith("Schema") && /^[A-Z]/.test(n)),
  };
}

describe("site-component-schemas stub parity", () => {
  it("exports the same names as the real bridge", () => {
    const real = readFileSync(join(dir, "site-component-schemas.ts"), "utf8");
    const stub = readFileSync(join(dir, "site-component-schemas.stub.ts"), "utf8");
    const realNames = exportNames(real);
    const stubNames = exportNames(stub);
    const realAll = [...realNames.values, ...realNames.types].sort();
    const stubAll = [...stubNames.values, ...stubNames.types].sort();
    const missing = realAll.filter((n) => !stubAll.includes(n));
    expect(missing).toEqual([]);
  });
});
