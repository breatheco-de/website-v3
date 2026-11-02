import { existsSync, readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { decodeFunctionMapping } from "@shared/functionEncoding";
import { funnelProductsQueryValue } from "@shared/tracking-context";
import { resolveFieldValue } from "./transform";

/** Program computed field: same id string as the lead webhook, including this program's slug. */
const PROGRAM_SOURCE = `(value, item) => {
  const includeSelf = true;
  const slug = item && typeof item.slug === "string" ? item.slug.trim() : "";
  const raw = item && item.funnel ? item.funnel.products : undefined;
  const pack = (product, persona, product_persona) =>
    encodeURIComponent(JSON.stringify({ product, persona, product_persona }));
  if (raw === "all") return pack("all", "all", "all");
  const list = [];
  const seen = {};
  const add = (product, persona) => {
    const p = typeof product === "string" ? product.trim() : "";
    if (!p) return;
    const ps = typeof persona === "string" ? persona.trim() : "";
    const key = p + "\\0" + ps;
    if (seen[key]) return;
    seen[key] = 1;
    list.push(ps ? { product: p, persona: ps } : { product: p });
  };
  if (Array.isArray(raw)) {
    for (const b of raw) {
      if (typeof b === "string") add(b);
      else if (b && typeof b === "object") add(b.product, b.persona);
    }
  }
  if (includeSelf && slug && !list.some((b) => b.product === slug)) add(slug);
  if (!list.length) return pack("none", "none", "none");
  const products = [];
  const personas = [];
  const pairs = [];
  for (const b of list) {
    products.push(b.product);
    if (b.persona) personas.push(b.persona);
    pairs.push(b.product + ":" + (b.persona || ""));
  }
  const join = (arr) => Array.from(new Set(arr)).sort().join(",");
  return pack(join(products), personas.length ? join(personas) : "none", join(pairs));
}`;

/** Landing and page: do not add the entry slug. */
const PAGE_SOURCE = PROGRAM_SOURCE.replace(
  "const includeSelf = true;",
  "const includeSelf = false;",
);

function run(source: string, item: Record<string, unknown>) {
  const before = JSON.parse(JSON.stringify(item));
  const value = resolveFieldValue(`function:${Buffer.from(source, "utf8").toString("base64")}`, item);
  expect(item).toEqual(before);
  return value;
}

describe("funnel_products_encoded_ids", () => {
  const products = [
    { product: "ai-flex", persona: "the-explorer" },
    { product: "ai-engineering", persona: "the-career-changer" },
  ];

  it("matches the lead-webhook id string", () => {
    const item = { slug: "apply", funnel: { products } };
    expect(run(PAGE_SOURCE, item)).toBe(funnelProductsQueryValue(item.funnel, "landing", "apply"));
    expect(run(PROGRAM_SOURCE, { slug: "ai-engineering", funnel: { products } })).toBe(
      funnelProductsQueryValue({ products }, "program", "ai-engineering"),
    );
  });

  it("adds the program slug when the YAML omits it, and leaves the page unchanged", () => {
    const program = { slug: "ai-engineering", funnel: {} };
    expect(run(PROGRAM_SOURCE, program)).toBe(funnelProductsQueryValue({}, "program", "ai-engineering"));
    expect(program.funnel).toEqual({});

    const landing = { slug: "apply", funnel: {} };
    expect(run(PAGE_SOURCE, landing)).toBe(funnelProductsQueryValue({}, "landing", "apply"));
    const page = { slug: "program-comparison", funnel: { products: "all" as const } };
    expect(run(PAGE_SOURCE, page)).toBe(funnelProductsQueryValue({ products: "all" }, "page", "program-comparison"));
  });

  it("is the function stored on program, landing, and page", () => {
    const ymlPath = "site_4geeks-com/content-types.yml";
    if (!existsSync(ymlPath)) return;
    const yml = readFileSync(ymlPath, "utf8");
    const fields = [...yml.matchAll(/^    funnel_products_encoded_ids: "?(function:[^"\n]+)"?$/gm)].map((m) =>
      decodeFunctionMapping(m[1]),
    );
    expect(fields).toEqual([PROGRAM_SOURCE, PAGE_SOURCE, PAGE_SOURCE]);
  });
});
