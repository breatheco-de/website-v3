import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { brandTerms } from "./evidence-match";

export function readBrandName(contentRoot: string): string | null {
  try {
    const file = path.join(contentRoot, "brand-context.yml");
    if (!fs.existsSync(file)) return null;
    const doc = yaml.load(fs.readFileSync(file, "utf-8")) as { brand?: { name?: unknown } } | null;
    return typeof doc?.brand?.name === "string" ? doc.brand.name : null;
  } catch {
    return null;
  }
}

/** Normalized brand terms of one site (brand-context.yml name + domain stem). */
export function siteBrandTerms(contentRoot: string, domain: string | null | undefined): string[] {
  const stem = domain ? domain.split(".").slice(-2, -1)[0] ?? null : null;
  return brandTerms([readBrandName(contentRoot), stem]);
}
