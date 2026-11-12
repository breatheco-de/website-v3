/**
 * Read-only image audit. Writes nothing under site_* and never calls
 * MediaGallery.getRegistry() (which can rewrite the registry file).
 *
 *   npx tsx temp/image-audit.ts            # static analysis
 *   npx tsx temp/image-audit.ts --http     # also HEAD every referenced file
 *
 * Results: temp/image-audit-results.json
 */
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { createEmptyImageRefs, extractImageRefsFromValue } from "../server/image-registry-subset";
import { MediaGallery } from "../server/media-gallery";
import { escapeTemplateVars, unescapeObjectVars } from "../shared/templateVars";

const ROOT = process.cwd();
const HTTP = process.argv.includes("--http");
const DEFAULT_SITE = "site_4geeks-com";
const SITES = ["site_4geeks-com", "site_4geeks-florida", "site_business-4geeks"];
const SKIP_DIRS = new Set(["component-registry", "db", "ads-history", "images", "node_modules", ".git"]);

type Entry = {
  src?: string;
  srcset?: Array<{ w: number; url: string }>;
  source_url?: string;
  origin?: string;
  protected?: boolean;
  registered_at?: string;
};
type Registry = { images: Record<string, Entry> };

function readRegistry(site: string): Registry {
  const file = path.join(ROOT, site, "image-registry.json");
  if (!fs.existsSync(file)) return { images: {} };
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const images = raw.images && !Array.isArray(raw.images) ? raw.images : {};
  return { images };
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (/\.ya?ml$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function fileKind(rel: string): "live" | "draft" | "common" | "template" | "menu" | "variant" | "other" {
  const parts = rel.split("/");
  const base = parts[parts.length - 1];
  if (parts[1] === "menus") return "menu";
  if (parts.length < 4) return "other";
  if (base.startsWith("draft.")) return "draft";
  if (base === "_common.yml") return "common";
  if (base.startsWith("template.") || base.startsWith("_template")) return "template";
  if (/^[a-z]{2}(-[A-Za-z]{2})?\.ya?ml$/.test(base)) return "live";
  return "variant";
}

type Leaf = { keyPath: string; key: string; value: string; sectionType?: string; sectionVariant?: string };

function collectLeaves(value: unknown, keyPath: string, key: string, out: Leaf[], section?: { type?: string; variant?: string }): void {
  if (typeof value === "string") {
    out.push({ keyPath, key, value: value.trim(), sectionType: section?.type, sectionVariant: section?.variant });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectLeaves(item, `${keyPath}[${i}]`, key, out, section));
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      collectLeaves(v, keyPath ? `${keyPath}.${k}` : k, k, out, section);
    }
  }
}

function collectPageLeaves(doc: unknown): Leaf[] {
  const out: Leaf[] = [];
  if (!doc || typeof doc !== "object") return out;
  const obj = doc as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (k === "sections" && Array.isArray(v)) {
      v.forEach((section, i) => {
        const s = (section ?? {}) as Record<string, unknown>;
        collectLeaves(section, `sections[${i}]`, "sections", out, {
          type: typeof s.type === "string" ? s.type : undefined,
          variant: typeof s.variant === "string" ? s.variant : undefined,
        });
      });
    } else {
      collectLeaves(v, k, k, out);
    }
  }
  return out;
}

const NOISE_KEYS = new Set([
  "slug", "type", "variant", "section_id", "id", "title", "name", "label", "text", "heading", "icon",
  "version", "tag", "tags", "category", "href", "url", "alt", "description", "subtitle", "locale",
]);
const STRICT_ID_KEY = /(?:^|_)image_id$|^imageId$|^imageIdDark$|^[a-z][a-z0-9]*[Ii]mage[Ii]d$/;
const LOOSE_IMAGE_KEY = /^(image|img|avatar|logo|brand_image|tall_image|stacked_images|avatars|background_image|photo|thumbnail)$/;
const looksLikeId = (v: string) => /^[a-z0-9][a-z0-9-]{3,}$/i.test(v) && !v.includes("/") && !v.includes(".") && !v.includes(":");

function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

async function head(url: string): Promise<number> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15000) });
      return res.status;
    } catch {
      /* retry once */
    }
  }
  return 0;
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

async function main() {
  const registries: Record<string, Registry> = {};
  for (const site of SITES) registries[site] = readRegistry(site);

  const report: Record<string, unknown> = { generatedAt: new Date().toISOString(), sites: {} };

  // Which ids does each site's own delete guard consider "in use"?
  const usageBySite: Record<string, Map<string, Set<string>>> = {};
  for (const site of SITES) {
    if (!fs.existsSync(path.join(ROOT, site))) continue;
    usageBySite[site] = new MediaGallery(site).collectImageReferences().byRef;
  }
  const guardSees = (site: string, id: string, entry: Entry | undefined): boolean => {
    const byRef = usageBySite[site];
    if (!byRef) return false;
    if (byRef.has(id)) return true;
    if (entry?.src && byRef.has(entry.src)) return true;
    return (entry?.srcset ?? []).some((s) => byRef.has(s.url));
  };

  const httpTargets = new Map<string, { site: string; id: string; kind: "src" | "srcset" }>();

  // Direct image URLs written in YAML (these bypass the registry at render time).
  const IMAGE_URL = /^https?:\/\/\S+\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?\S*)?$/i;
  const MEDIA_HOST = /^https?:\/\/(?:storage\.googleapis\.com\/4geeks-academy-website\/|breathecode\.herokuapp\.com\/v1\/media\/file\/)/;
  const registeredUrls = new Set<string>();
  for (const s of SITES) {
    for (const entry of Object.values(registries[s].images)) {
      if (entry.src) registeredUrls.add(entry.src);
      for (const v of entry.srcset ?? []) registeredUrls.add(v.url);
    }
  }
  const directUrls = new Map<string, { files: Set<string>; liveFiles: Set<string>; keys: Set<string>; sites: Set<string> }>();

  for (const site of SITES) {
    const siteDir = path.join(ROOT, site);
    if (!fs.existsSync(siteDir)) continue;
    const own = registries[site].images;
    const fallback = site === DEFAULT_SITE ? {} : registries[DEFAULT_SITE].images;
    const merged: Record<string, Entry> = { ...fallback, ...own };

    const files = walk(siteDir);
    let parseFailures = 0;

    const blankByKey: Record<string, number> = {};
    const blankBySection: Record<string, number> = {};
    const blankFiles: Record<string, Array<{ keyPath: string; id: string; section?: string }>> = {};
    const blankLiveFiles = new Set<string>();
    const blankIds = new Set<string>();
    const noiseByKey: Record<string, number> = {};

    const referencedIds = new Map<string, Set<string>>(); // id -> files (any kind)
    const referencedLiveIds = new Set<string>();
    const unknownStrict: Array<{ file: string; keyPath: string; value: string }> = [];
    const unknownLoose: Array<{ file: string; keyPath: string; value: string }> = [];
    const kindCounts: Record<string, number> = {};

    for (const file of files) {
      const rel = path.relative(ROOT, file);
      const kind = fileKind(rel);
      bump(kindCounts, kind);
      let doc: unknown;
      try {
        const { escaped, map } = escapeTemplateVars(fs.readFileSync(file, "utf8"));
        const parsed = yaml.load(escaped);
        doc = parsed ? unescapeObjectVars(parsed, map) : parsed;
      } catch {
        parseFailures++;
        continue;
      }
      if (!doc || typeof doc !== "object") continue;

      const refs = createEmptyImageRefs();
      extractImageRefsFromValue(doc, refs);
      const leaves = collectPageLeaves(doc);

      for (const leaf of leaves) {
        const v = leaf.value;
        if (!v) continue;
        if (IMAGE_URL.test(v) || (MEDIA_HOST.test(v) && !/\.(pdf|docx?|mp4|webm|zip)(\?|$)/i.test(v))) {
          let rec = directUrls.get(v);
          if (!rec) directUrls.set(v, (rec = { files: new Set(), liveFiles: new Set(), keys: new Set(), sites: new Set() }));
          rec.files.add(rel);
          if (kind !== "draft") rec.liveFiles.add(rel);
          rec.keys.add(leaf.key);
          rec.sites.add(site);
          continue;
        }
        const isId = Object.prototype.hasOwnProperty.call(merged, v);
        if (isId) {
          if (NOISE_KEYS.has(leaf.key) && !STRICT_ID_KEY.test(leaf.key)) {
            // `id` inside an image object is a real ref; the subset extractor decides that.
            if (!(leaf.key === "id" && refs.ids.has(v))) {
              bump(noiseByKey, leaf.key);
              if (leaf.key !== "id") continue;
            }
          }
          if (!referencedIds.has(v)) referencedIds.set(v, new Set());
          referencedIds.get(v)!.add(rel);
          if (kind !== "draft") referencedLiveIds.add(v);

          if (!refs.ids.has(v) && kind !== "menu") {
            const section = leaf.sectionType ? `${leaf.sectionType}/${leaf.sectionVariant ?? "default"}` : "(page level)";
            bump(blankByKey, leaf.key);
            bump(blankBySection, section);
            (blankFiles[rel] ??= []).push({ keyPath: leaf.keyPath, id: v, section });
            blankIds.add(v);
            if (kind === "live" || kind === "common" || kind === "variant" || kind === "template") blankLiveFiles.add(rel);
          }
        } else if (looksLikeId(v)) {
          if (STRICT_ID_KEY.test(leaf.key)) unknownStrict.push({ file: rel, keyPath: leaf.keyPath, value: v });
          else if (LOOSE_IMAGE_KEY.test(leaf.key) && /-/.test(v) && v.length >= 8) {
            unknownLoose.push({ file: rel, keyPath: leaf.keyPath, value: v });
          }
        }
      }
    }

    // Delete guard blind spots
    const deletableInUse: Array<{ id: string; ownerSite: string; files: string[]; protected: boolean }> = [];
    for (const [id, usedIn] of referencedIds) {
      const ownerSite = Object.prototype.hasOwnProperty.call(own, id) ? site : DEFAULT_SITE;
      const entry = registries[ownerSite].images[id];
      if (!guardSees(ownerSite, id, entry)) {
        deletableInUse.push({ id, ownerSite, files: [...usedIn].slice(0, 5), protected: !!entry?.protected });
      }
    }

    // Registry health
    const ownIds = Object.keys(own);
    const noSrc = ownIds.filter((id) => !own[id].src);
    const pendingExternal = ownIds.filter((id) => !own[id].src && own[id].source_url);
    const localMissing = ownIds.filter((id) => {
      const src = own[id].src;
      if (!src || /^https?:/.test(src)) return false;
      return !fs.existsSync(path.join(ROOT, src.replace(/^\//, "")));
    });
    const byOrigin: Record<string, number> = {};
    for (const id of ownIds) bump(byOrigin, own[id].origin ?? "(none)");

    for (const id of referencedLiveIds) {
      const entry = merged[id];
      if (entry?.src && /^https?:/.test(entry.src)) httpTargets.set(entry.src, { site, id, kind: "src" });
      for (const s of entry?.srcset ?? []) {
        if (/^https?:/.test(s.url)) httpTargets.set(s.url, { site, id, kind: "srcset" });
      }
    }

    const liveBlank = Object.fromEntries(Object.entries(blankFiles).filter(([f]) => blankLiveFiles.has(f)));
    (report.sites as Record<string, unknown>)[site] = {
      registryImages: ownIds.length,
      yamlFiles: files.length,
      fileKinds: kindCounts,
      parseFailures,
      referencedIds: referencedIds.size,
      referencedLiveIds: referencedLiveIds.size,
      visitorBlank: {
        distinctIds: blankIds.size,
        filesAnyKind: Object.keys(blankFiles).length,
        filesLive: Object.keys(liveBlank).length,
        occurrences: Object.values(blankFiles).reduce((n, list) => n + list.length, 0),
        byKey: Object.fromEntries(Object.entries(blankByKey).sort((a, b) => b[1] - a[1])),
        bySection: Object.fromEntries(Object.entries(blankBySection).sort((a, b) => b[1] - a[1])),
        files: blankFiles,
      },
      noiseSkippedByKey: noiseByKey,
      deleteGuard: {
        inUseButDeletable: deletableInUse.length,
        ofWhichProtected: deletableInUse.filter((d) => d.protected).length,
        ofWhichOwnedByFallbackSite: deletableInUse.filter((d) => d.ownerSite !== site).length,
        items: deletableInUse,
      },
      unknownIds: {
        strictKeys: unknownStrict.length,
        strictDistinct: new Set(unknownStrict.map((u) => u.value)).size,
        looseKeys: unknownLoose.length,
        strict: unknownStrict,
        loose: unknownLoose,
      },
      registryHealth: { noSrc: noSrc.length, pendingExternal: pendingExternal.length, localMissing, byOrigin },
    };
  }

  // Hardcoded registry ids in client code (never present in page YAML → never in the visitor subset)
  const allIds = new Set(SITES.flatMap((s) => Object.keys(registries[s].images)));
  const hardcoded: Record<string, string[]> = {};
  const scanSrc = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scanSrc(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");
        for (const m of text.matchAll(/["'`]([a-z0-9][a-z0-9-]{7,})["'`]/g)) {
          if (allIds.has(m[1]) && m[1].includes("-")) (hardcoded[m[1]] ??= []).push(path.relative(ROOT, full));
        }
      }
    }
  };
  scanSrc(path.join(ROOT, "client", "src"));
  report.hardcodedIdsInClient = Object.fromEntries(
    Object.entries(hardcoded).map(([id, files]) => [id, [...new Set(files)]]),
  );

  const directList = [...directUrls.entries()];
  const hostOf = (u: string) => {
    try {
      return new URL(u).host;
    } catch {
      return "(invalid)";
    }
  };
  const directSummary: Record<string, unknown> = {
    distinctUrls: directList.length,
    usedInFiles: new Set(directList.flatMap(([, r]) => [...r.files])).size,
    inRegistry: directList.filter(([u]) => registeredUrls.has(u)).length,
    notInRegistry: directList.filter(([u]) => !registeredUrls.has(u)).length,
    byHost: directList.reduce<Record<string, number>>((acc, [u]) => (bump(acc, hostOf(u)), acc), {}),
  };
  report.directUrls = directSummary;

  if (HTTP) {
    console.log("direct url targets", directList.length);
    const directStatuses = await pool(directList, 24, async ([url]) => head(url));
    const directBad = directList
      .map(([url, rec], i) => ({
        url,
        status: directStatuses[i],
        inRegistry: registeredUrls.has(url),
        sites: [...rec.sites],
        keys: [...rec.keys],
        fileCount: rec.files.size,
        liveFileCount: rec.liveFiles.size,
        files: [...rec.files].slice(0, 8),
      }))
      .filter((r) => r.status !== 200);
    directSummary.http = {
      checked: directList.length,
      notOk: directBad.length,
      notOkUsedOnLiveFiles: directBad.filter((b) => b.liveFileCount > 0).length,
      liveFilesAffected: new Set(
        directList.filter((_, i) => directStatuses[i] !== 200).flatMap(([, r]) => [...r.liveFiles]),
      ).size,
      byStatus: directBad.reduce<Record<string, number>>((acc, b) => (bump(acc, String(b.status)), acc), {}),
      byHost: directBad.reduce<Record<string, number>>((acc, b) => (bump(acc, hostOf(b.url)), acc), {}),
      items: directBad,
    };

    const targets = [...httpTargets.entries()];
    console.log("http targets", targets.length);
    const statuses = await pool(targets, 24, async ([url]) => head(url));
    const bad = targets
      .map(([url, meta], i) => ({ url, ...meta, status: statuses[i] }))
      .filter((r) => r.status !== 200);
    report.http = {
      checked: targets.length,
      notOk: bad.length,
      notOkSrc: bad.filter((b) => b.kind === "src").length,
      notOkSrcset: bad.filter((b) => b.kind === "srcset").length,
      byStatus: bad.reduce<Record<string, number>>((acc, b) => (bump(acc, String(b.status)), acc), {}),
      items: bad,
    };
  }

  fs.writeFileSync(path.join(ROOT, "temp", "image-audit-results.json"), JSON.stringify(report, null, 2) + "\n");

  for (const [site, data] of Object.entries(report.sites as Record<string, any>)) {
    console.log(`\n=== ${site}`);
    console.log("registryImages", data.registryImages, "yamlFiles", data.yamlFiles, "parseFailures", data.parseFailures);
    console.log("fileKinds", JSON.stringify(data.fileKinds));
    console.log("referencedIds", data.referencedIds, "referencedLiveIds", data.referencedLiveIds);
    console.log("visitorBlank", JSON.stringify({ ...data.visitorBlank, files: undefined }, null, 1));
    console.log("noiseSkippedByKey", JSON.stringify(data.noiseSkippedByKey));
    console.log("deleteGuard", JSON.stringify({ ...data.deleteGuard, items: undefined }));
    console.log("unknownIds", JSON.stringify({ ...data.unknownIds, strict: undefined, loose: undefined }));
    console.log("registryHealth", JSON.stringify(data.registryHealth));
  }
  console.log("\nhardcodedIdsInClient", JSON.stringify(report.hardcodedIdsInClient, null, 1));
  if (report.http) console.log("\nhttp", JSON.stringify({ ...(report.http as any), items: undefined }));
  const direct = report.directUrls as any;
  console.log("\ndirectUrls", JSON.stringify({ ...direct, http: direct.http ? { ...direct.http, items: undefined } : undefined }));
}

main().catch((err) => {
  console.error("audit failed", err);
  process.exit(1);
});
