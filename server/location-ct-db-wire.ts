/**
 * Wire location content type to the locations database, seed a minimal shared
 * template for future attached campuses, and mark every existing campus detached
 * (keeps bespoke page shells). Strips geo fact keys from _common.yml so the DB
 * is the source of truth for those fields.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { dumpContentYaml } from "./content-yaml";

const GEO_KEYS = new Set([
  "slug",
  "name",
  "city",
  "country",
  "country_code",
  "latitude",
  "longitude",
  "region",
  "default_language",
  "timezone",
  "phone",
  "address",
  "visibility",
]);

const MINIMAL_TEMPLATE = {
  meta: {
    page_title: "{{ entry.name }}",
    description: "{{ entry.city }}, {{ entry.country }}",
  },
  sections: [
    {
      type: "text_block",
      variant: "default",
      version: "1.0",
      section_id: "location-template-intro",
      heading: "{{ entry.name }}",
      body: "<p>{{ entry.address }}</p>",
      alignment: "left",
      max_width: "default",
      background: "white",
      paddingY: { desktop: "md" },
    },
  ],
};

function loadYaml(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return (yaml.load(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>) || {};
  } catch {
    return null;
  }
}

function writeYaml(filePath: string, data: unknown): void {
  const body = dumpContentYaml(data, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body.endsWith("\n") ? body : `${body}\n`, "utf8");
}

export function wireLocationContentTypeToDatabase(contentRoot: string): {
  files: string[];
  detached: string[];
} {
  const files: string[] = [];
  const detached: string[] = [];
  const abs = path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot);

  const ctPath = path.join(abs, "content-types.yml");
  const ct = loadYaml(ctPath);
  if (!ct || typeof ct.location !== "object" || !ct.location) {
    throw new Error(`${contentRoot}: no location content type`);
  }
  const loc = ct.location as Record<string, unknown>;
  loc.database = { slug: "locations" };
  loc.single_template = true;
  writeYaml(ctPath, ct);
  files.push(path.join(contentRoot, "content-types.yml").split(path.sep).join("/"));

  const locDir = path.join(abs, "locations");
  for (const locale of ["en", "es"]) {
    const templatePath = path.join(locDir, `template.${locale}.yml`);
    if (!fs.existsSync(templatePath)) {
      writeYaml(templatePath, MINIMAL_TEMPLATE);
      files.push(
        path.join(contentRoot, "locations", `template.${locale}.yml`).split(path.sep).join("/"),
      );
    }
  }

  if (!fs.existsSync(locDir)) return { files, detached };

  for (const entry of fs.readdirSync(locDir)) {
    if (entry.startsWith("_") || entry.startsWith(".")) continue;
    const entryDir = path.join(locDir, entry);
    if (!fs.statSync(entryDir).isDirectory()) continue;
    const commonPath = path.join(entryDir, "_common.yml");
    const common = loadYaml(commonPath) || {};
    const next: Record<string, unknown> = { detached: true };
    for (const [k, v] of Object.entries(common)) {
      if (GEO_KEYS.has(k)) continue;
      if (k === "detached") continue;
      next[k] = v;
    }
    writeYaml(commonPath, next);
    files.push(
      path.join(contentRoot, "locations", entry, "_common.yml").split(path.sep).join("/"),
    );
    detached.push(entry);
  }

  return { files: [...new Set(files)], detached };
}
