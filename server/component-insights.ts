import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getDefaultContentFolder, getDefaultContentRoot } from "./site-config";
import { getAllConfigs, getFolder } from "./content-types";
import { contentIndex } from "./content-index";
import { databaseManager } from "./database";
import {
  isEntryDetached,
  isSharedLayoutType,
} from "./shared-layout-entry";
import type {
  ComponentInsightsData,
  ComponentPairing,
  ComponentSequence,
  ComponentUsageStat,
  ContentTypeUsageStat,
  InsightPageRecord,
  InsightSection,
  IntentCluster,
  PageIntent,
  VariantUsageStat,
} from "@shared/schema";
import { CACHE_DIR } from "./db-cache";
import { child } from "./logger";

const log = child({ module: "component-insights" });

const DEBOUNCE_MS = 45_000;
const INSIGHTS_FILENAME = "component-insights.json";

function settingsPath(): string {
  return path.join(process.cwd(), getDefaultContentFolder(), "settings.yml");
}

/** Regenerable cache — outside content folders so GitHub sync never tracks it. */
function outputPath(): string {
  return path.join(CACHE_DIR, getDefaultContentFolder(), INSIGHTS_FILENAME);
}

/** Pre-move location under the site content root (synced by mistake). */
function legacyOutputPath(): string {
  return path.join(process.cwd(), getDefaultContentFolder(), INSIGHTS_FILENAME);
}

function removeLegacyInsightsFile(): void {
  const legacy = legacyOutputPath();
  try {
    if (fs.existsSync(legacy)) {
      fs.unlinkSync(legacy);
      log.info(`[ComponentInsights] Removed legacy ${legacy}`);
    }
  } catch (err) {
    log.warn({ err }, `[ComponentInsights] Failed to remove legacy ${legacy}`);
  }
}

/** One-time: copy content-folder cache into .cache/ then delete the old file. */
function migrateLegacyInsightsFile(): boolean {
  const dest = outputPath();
  if (fs.existsSync(dest)) {
    removeLegacyInsightsFile();
    return false;
  }
  const legacy = legacyOutputPath();
  if (!fs.existsSync(legacy)) return false;
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(legacy, dest);
    fs.unlinkSync(legacy);
    log.info(`[ComponentInsights] Migrated ${legacy} → ${dest}`);
    return true;
  } catch (err) {
    log.warn({ err }, `[ComponentInsights] Failed to migrate ${legacy}`);
    return false;
  }
}

const DEFAULT_INTENT = "brand_corporate";
const FALLBACK_CLUSTER_MIN = 3;
const PMI_EPSILON = 0.01;

/** Internal scan row — same as persisted InsightPageRecord. */
type PageRecord = InsightPageRecord;

// ─── Rebuild status / debounce ─────────────────────────────────────────────

type RebuildStatus = "idle" | "scheduled" | "running";

let dirty = false;
let dirtySince: number | null = null;
let nextRebuildAt: number | null = null;
let status: RebuildStatus = "idle";
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let rebuildInFlight: Promise<ComponentInsightsData> | null = null;
let queuedAfterCurrent = false;
let bootRebuildDone = false;

export interface InsightsStatus {
  generatedAt: string | null;
  dirty: boolean;
  dirtySince: string | null;
  nextRebuildAt: string | null;
  status: RebuildStatus;
  debounceMs: number;
}

export function getInsightsStatus(): InsightsStatus {
  const data = readInsightsFile();
  // Stale/missing cache: kick a one-shot rebuild so gallery counts can appear.
  if (!data && status === "idle" && !rebuildInFlight) {
    void scheduleRebuild("lazy-missing").catch(() => {});
  }
  const effectiveStatus: RebuildStatus =
    !data && (status === "running" || rebuildInFlight) ? "running" : status;
  return {
    generatedAt: data?.generatedAt ?? null,
    dirty,
    dirtySince: dirtySince ? new Date(dirtySince).toISOString() : null,
    nextRebuildAt: nextRebuildAt ? new Date(nextRebuildAt).toISOString() : null,
    status: effectiveStatus,
    debounceMs: DEBOUNCE_MS,
  };
}

/** Strip `#` comments (simple) then test for a sections key. */
export function fileLikelyHasSections(raw: string): boolean {
  const noComments = raw.replace(/(^|\s)#.*$/gm, "\n");
  return /(^|\n)\s*sections\s*:/m.test(noComments);
}

export function markInsightsDirty(filePath?: string): void {
  if (filePath) {
    const normalized = filePath.replace(/\\/g, "/");
    const isOverlays = normalized.endsWith("/overlays.yml") || normalized.endsWith("overlays.yml");
    if (!isOverlays) {
      try {
        const abs = path.isAbsolute(filePath)
          ? filePath
          : path.join(process.cwd(), filePath);
        if (!fs.existsSync(abs)) return;
        const raw = fs.readFileSync(abs, "utf-8");
        if (!fileLikelyHasSections(raw)) return;
      } catch {
        return;
      }
    }
  }

  if (!dirty) dirtySince = Date.now();
  dirty = true;
  nextRebuildAt = Date.now() + DEBOUNCE_MS;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void scheduleRebuild("debounce");
  }, DEBOUNCE_MS);

  status = status === "running" ? "running" : "scheduled";
}

async function scheduleRebuild(reason: string): Promise<ComponentInsightsData | null> {
  if (rebuildInFlight) {
    queuedAfterCurrent = true;
    log.info(`[ComponentInsights] Rebuild queued (reason=${reason}, in-flight)`);
    return rebuildInFlight;
  }

  status = "running";
  nextRebuildAt = null;
  rebuildInFlight = Promise.resolve()
    .then(() => runScan())
    .then((data) => {
      dirty = false;
      dirtySince = null;
      status = "idle";
      return data;
    })
    .catch((err) => {
      log.error({ err }, `[ComponentInsights] Rebuild failed (reason=${reason})`);
      status = dirty ? "scheduled" : "idle";
      throw err;
    })
    .finally(() => {
      rebuildInFlight = null;
      if (queuedAfterCurrent) {
        queuedAfterCurrent = false;
        if (dirty) {
          void scheduleRebuild("queued");
        }
      }
    });

  return rebuildInFlight;
}

/** Startup: one rebuild; coalesce with debounce. */
export async function runStartupInsightsRebuild(): Promise<void> {
  if (bootRebuildDone) return;
  bootRebuildDone = true;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  dirty = false;
  dirtySince = null;
  nextRebuildAt = null;
  try {
    await scheduleRebuild("startup");
  } catch {
    /* logged */
  }
}

export async function requestInsightsRebuild(): Promise<ComponentInsightsData> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  nextRebuildAt = null;
  const result = await scheduleRebuild("manual");
  if (!result) throw new Error("Rebuild failed");
  return result;
}

// ─── YAML helpers ──────────────────────────────────────────────────────────

function loadPageIntents(): PageIntent[] {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed?.page_intents || !Array.isArray(parsed.page_intents)) return [];
    return (parsed.page_intents as Array<{ id: string; what_for: string }>)
      .filter((e) => typeof e.id === "string" && typeof e.what_for === "string");
  } catch {
    return [];
  }
}

function extractSections(data: unknown): InsightSection[] {
  if (!data || typeof data !== "object") return [];
  const sections = (data as Record<string, unknown>).sections;
  if (!Array.isArray(sections)) return [];
  return sections
    .filter((s) => s && typeof s === "object" && typeof (s as Record<string, unknown>).type === "string")
    .map((s) => {
      const rec = s as Record<string, unknown>;
      const variant =
        typeof rec.variant === "string" && rec.variant.trim()
          ? rec.variant.trim()
          : "default";
      return { type: String(rec.type), variant };
    });
}

function safeYamlLoad(raw: string): Record<string, unknown> | null {
  try {
    return contentIndex.safeYamlLoad(raw);
  } catch {
    return null;
  }
}

function readInsightsFieldsFromYaml(data: Record<string, unknown>): {
  intent: string | undefined;
  weight: number | undefined;
} {
  let intent: string | undefined;
  let weight: number | undefined;

  if (typeof data.insights_intent === "string") {
    intent = data.insights_intent;
  }
  if (data.insights_weight !== undefined) {
    const raw = data.insights_weight;
    if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
      weight = raw;
    } else {
      log.warn(
        `[ComponentInsights] insights_weight "${raw}" is not a positive integer — ignoring, using default 1.`,
      );
    }
  }
  return { intent, weight };
}

function validateIntent(
  resolved: string,
  validIntentIds: Set<string>,
  pageIntent: string | undefined,
  label: string,
): string {
  if (validIntentIds.has(resolved)) return resolved;
  if (pageIntent) {
    log.warn(
      `[ComponentInsights] Unknown intent "${pageIntent}" on ${label}, falling back to "${DEFAULT_INTENT}"`,
    );
  }
  return DEFAULT_INTENT;
}

function loadTemplateSections(contentType: string, contentRoot: string): {
  sections: InsightSection[];
  intent?: string;
  weight?: number;
} {
  const folder = getFolder(contentType, contentRoot);
  const dir = path.join(contentRoot, folder);
  const candidates = [
    "template.en.yml",
    "template.es.yml",
    "single.en.yml",
    "single.es.yml",
    "_common.template.yml",
    "_common.single.yml",
  ];
  for (const name of candidates) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) continue;
    try {
      const data = safeYamlLoad(fs.readFileSync(p, "utf-8"));
      if (!data) continue;
      const sections = extractSections(data);
      if (sections.length === 0 && name !== "_common.single.yml" && name !== "_common.template.yml") continue;
      const fields = readInsightsFieldsFromYaml(data);
      if (sections.length > 0) {
        return { sections, intent: fields.intent, weight: fields.weight };
      }
    } catch {
      /* try next */
    }
  }
  return { sections: [] };
}

function listSlugsForContentType(contentType: string, config: Record<string, unknown>): string[] {
  const dirSlugs = contentIndex.listContentSlugs(
    contentType as Parameters<typeof contentIndex.listContentSlugs>[0],
  );

  const dbSlug = (config.database as { slug?: string } | undefined)?.slug;
  if (!dbSlug) return dirSlugs;

  const items = databaseManager.getMappedItems(dbSlug) ?? [];
  const fromDb = items
    .map((item) => String(item.slug || "").trim())
    .filter(Boolean);
  return Array.from(new Set([...dirSlugs, ...fromDb]));
}

function resolvePageSections(
  contentType: string,
  slug: string,
  contentDir: string,
): { sections: InsightSection[]; intent?: string; weight?: number } {
  let sections: InsightSection[] = [];
  let intent: string | undefined;
  let weight: number | undefined;

  try {
    const commonData = contentIndex.loadCommonData(
      contentType as Parameters<typeof contentIndex.loadCommonData>[0],
      slug,
    );
    if (commonData) {
      const fields = readInsightsFieldsFromYaml(commonData);
      if (fields.intent) intent = fields.intent;
      if (fields.weight !== undefined) weight = fields.weight;
      sections = extractSections(commonData);
    }
  } catch {
    /* continue */
  }

  const slugDir = path.join(contentDir, slug);
  try {
    const files = fs.readdirSync(slugDir).filter((f) => f.endsWith(".yml") && !f.startsWith("_"));
    const ordered = [
      ...files.filter((f) => f === "en.yml"),
      ...files.filter((f) => f !== "en.yml"),
    ];
    for (const file of ordered) {
      try {
        const data = safeYamlLoad(fs.readFileSync(path.join(slugDir, file), "utf-8"));
        if (!data) continue;
        const fields = readInsightsFieldsFromYaml(data);
        if (fields.intent) intent = fields.intent;
        if (fields.weight !== undefined) weight = fields.weight;
        if (sections.length === 0) {
          const found = extractSections(data);
          if (found.length > 0) sections = found;
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no dir */
  }

  return { sections, intent, weight };
}

function scanInventory(
  validIntentIds: Set<string>,
  contentTypeIntentMap: Map<string, string>,
): PageRecord[] {
  const records: PageRecord[] = [];
  const configs = getAllConfigs();
  const contentRoot = getDefaultContentRoot();
  const contentFolder = getDefaultContentFolder();

  // Cohorts: key → accumulating slugs + template sections
  const cohorts = new Map<
    string,
    {
      contentType: string;
      templateId: string;
      intent: string;
      weight: number;
      sections: InsightSection[];
      slugs: string[];
    }
  >();

  for (const [contentType, config] of Object.entries(configs)) {
    const cfg = config as Record<string, unknown>;
    const ctDefault = contentTypeIntentMap.get(contentType) ?? DEFAULT_INTENT;
    const contentDir = path.join(process.cwd(), contentFolder, cfg.directory as string);
    const shared = isSharedLayoutType(contentType, contentRoot);
    const slugs = listSlugsForContentType(contentType, cfg);

    if (shared) {
      const template = loadTemplateSections(contentType, contentRoot);
      if (template.sections.length === 0 && slugs.length === 0) continue;

      for (const slug of slugs) {
        if (slug === "single" || slug === "template") continue;
        const detached = isEntryDetached(contentType, slug, contentRoot);
        if (detached) {
          const resolved = resolvePageSections(contentType, slug, contentDir);
          if (resolved.sections.length === 0) continue;
          const intent = validateIntent(
            resolved.intent ?? ctDefault,
            validIntentIds,
            resolved.intent,
            `${contentType}/${slug}`,
          );
          records.push({
            key: `${contentType}/${slug}`,
            contentType,
            kind: "page",
            slug,
            intent,
            weight: resolved.weight ?? 1,
            instanceCount: 1,
            sections: resolved.sections,
          });
          continue;
        }

        // Attached: use template sections; intent/weight from entry overrides or template
        const entryFields = resolvePageSections(contentType, slug, contentDir);
        const intent = validateIntent(
          entryFields.intent ?? template.intent ?? ctDefault,
          validIntentIds,
          entryFields.intent ?? template.intent,
          `${contentType}/${slug}`,
        );
        const weight = entryFields.weight ?? template.weight ?? 1;
        const sections = template.sections.length > 0 ? template.sections : entryFields.sections;
        if (sections.length === 0) continue;

        const templateId = "template";
        const cohortKey = `${contentType}::${templateId}::${intent}::${weight}`;
        let cohort = cohorts.get(cohortKey);
        if (!cohort) {
          cohort = {
            contentType,
            templateId,
            intent,
            weight,
            sections,
            slugs: [],
          };
          cohorts.set(cohortKey, cohort);
        }
        if (!cohort.slugs.includes(slug)) cohort.slugs.push(slug);
      }

      // Template exists but zero attached slugs — still record once with instanceCount 0? Skip.
      continue;
    }

    // Non-shared layout types
    for (const slug of slugs) {
      const resolved = resolvePageSections(contentType, slug, contentDir);
      if (resolved.sections.length === 0) continue;
      const intent = validateIntent(
        resolved.intent ?? ctDefault,
        validIntentIds,
        resolved.intent,
        `${contentType}/${slug}`,
      );
      records.push({
        key: `${contentType}/${slug}`,
        contentType,
        kind: "page",
        slug,
        intent,
        weight: resolved.weight ?? 1,
        instanceCount: 1,
        sections: resolved.sections,
      });
    }
  }

  for (const [key, cohort] of cohorts) {
    if (cohort.slugs.length === 0) continue;
    records.push({
      key,
      contentType: cohort.contentType,
      kind: "shared_template",
      slugs: cohort.slugs,
      intent: cohort.intent,
      weight: cohort.weight,
      instanceCount: cohort.slugs.length,
      sections: cohort.sections,
    });
  }

  // Overlays
  const overlaysFile = path.join(contentRoot, "overlays.yml");
  if (fs.existsSync(overlaysFile)) {
    try {
      const data = safeYamlLoad(fs.readFileSync(overlaysFile, "utf-8"));
      const list = Array.isArray(data?.overlays) ? data!.overlays : [];
      list.forEach((item, idx) => {
        if (!item || typeof item !== "object") return;
        const rec = item as Record<string, unknown>;
        let sections = extractSections(rec);
        // Some overlays use component: + content instead of sections
        if (sections.length === 0 && typeof rec.component === "string") {
          sections = [{ type: rec.component, variant: "default" }];
        }
        if (sections.length === 0) return;
        const id = typeof rec.id === "string" ? rec.id : `overlay-${idx}`;
        records.push({
          key: `overlays/${id}`,
          contentType: "overlays",
          kind: "overlay",
          slug: id,
          intent: DEFAULT_INTENT,
          weight: 1,
          instanceCount: 1,
          sections,
        });
      });
    } catch (err) {
      log.warn({ err }, "[ComponentInsights] Failed to scan overlays.yml");
    }
  }

  return records;
}

function sectionTypes(record: PageRecord): string[] {
  return record.sections.map((s) => s.type);
}

function effectiveWeight(record: PageRecord): number {
  return record.weight * record.instanceCount;
}

function computePairings(pages: PageRecord[]): ComponentPairing[] {
  const pairMap = new Map<string, { count: number }>();
  const fromMap = new Map<string, number>();
  const toMap = new Map<string, number>();
  let totalTransitions = 0;

  for (const page of pages) {
    const types = sectionTypes(page);
    const w = effectiveWeight(page);
    for (let i = 0; i < types.length - 1; i++) {
      const from = types[i]!;
      const to = types[i + 1]!;
      const key = `${from}|||${to}`;
      const existing = pairMap.get(key);
      if (existing) existing.count += w;
      else pairMap.set(key, { count: w });
      fromMap.set(from, (fromMap.get(from) ?? 0) + w);
      toMap.set(to, (toMap.get(to) ?? 0) + w);
      totalTransitions += w;
    }
  }

  const pairings: ComponentPairing[] = [];
  for (const [key, { count }] of pairMap.entries()) {
    const [from, to] = key.split("|||");
    const frequency = fromMap.get(from!) ? count / (fromMap.get(from!) ?? 1) : 0;
    const pAB = count / (totalTransitions || 1);
    const pA = (fromMap.get(from!) ?? 0) / (totalTransitions || 1);
    const pB = (toMap.get(to!) ?? 0) / (totalTransitions || 1);
    const rawPmi = pA > 0 && pB > 0 ? Math.log(pAB / (pA * pB)) : -Infinity;
    const pmi = isFinite(rawPmi) ? rawPmi : -10;
    const distance = 1 / Math.max(pmi, PMI_EPSILON);
    pairings.push({
      from: from!,
      to: to!,
      count,
      frequency: Math.round(frequency * 1000) / 1000,
      pmi: Math.round(pmi * 1000) / 1000,
      distance: Math.round(distance * 1000) / 1000,
    });
  }
  return pairings.sort((a, b) => b.count - a.count);
}

function computeTopSequences(pages: PageRecord[], maxSeqs = 20): ComponentSequence[] {
  const seqMap = new Map<string, number>();
  for (const page of pages) {
    const types = sectionTypes(page);
    if (types.length < 2) continue;
    const key = types.join(" → ");
    seqMap.set(key, (seqMap.get(key) ?? 0) + effectiveWeight(page));
  }
  return Array.from(seqMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSeqs)
    .map(([key, count]) => ({ sequence: key.split(" → "), count }));
}

function computeUsageByType(pages: PageRecord[]): Record<string, ComponentUsageStat> {
  type Acc = {
    totalUses: number;
    pageKeys: Set<string>;
    variants: Map<string, { count: number; pages: Set<string> }>;
    byCt: Map<string, { count: number; pages: Set<string> }>;
  };
  const byType = new Map<string, Acc>();

  const touch = (type: string): Acc => {
    let a = byType.get(type);
    if (!a) {
      a = {
        totalUses: 0,
        pageKeys: new Set(),
        variants: new Map(),
        byCt: new Map(),
      };
      byType.set(type, a);
    }
    return a;
  };

  for (const page of pages) {
    const n = page.instanceCount;
    const pageKey = page.key;
    const typesSeen = new Set<string>();

    for (const sec of page.sections) {
      const acc = touch(sec.type);
      acc.totalUses += n;
      typesSeen.add(sec.type);

      let v = acc.variants.get(sec.variant);
      if (!v) {
        v = { count: 0, pages: new Set() };
        acc.variants.set(sec.variant, v);
      }
      v.count += n;
      v.pages.add(pageKey);

      let ct = acc.byCt.get(page.contentType);
      if (!ct) {
        ct = { count: 0, pages: new Set() };
        acc.byCt.set(page.contentType, ct);
      }
      ct.count += n;
      ct.pages.add(pageKey);
    }

    for (const t of typesSeen) {
      touch(t).pageKeys.add(pageKey);
      // pageCount should reflect instanceCount for shared templates
      // We store unique record keys then expand: pageCount = sum of instanceCount for records that contain type
    }
  }

  // Recompute pageCount as sum of instanceCount for records containing the type
  const pageCountByType = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set(page.sections.map((s) => s.type));
    for (const t of seen) {
      pageCountByType.set(t, (pageCountByType.get(t) ?? 0) + page.instanceCount);
    }
  }

  const out: Record<string, ComponentUsageStat> = {};
  for (const [type, acc] of byType) {
    const variants: VariantUsageStat[] = Array.from(acc.variants.entries())
      .map(([variant, v]) => ({
        variant,
        count: v.count,
        pageCount: v.pages.size, // record count; expand below
      }))
      .sort((a, b) => b.count - a.count);

    // Expand variant pageCount by instanceCount
    for (const vs of variants) {
      let pc = 0;
      for (const page of pages) {
        if (page.sections.some((s) => s.type === type && s.variant === vs.variant)) {
          pc += page.instanceCount;
        }
      }
      vs.pageCount = pc;
    }

    const byContentType: ContentTypeUsageStat[] = Array.from(acc.byCt.entries())
      .map(([contentType, c]) => {
        let pc = 0;
        for (const page of pages) {
          if (page.contentType !== contentType) continue;
          if (page.sections.some((s) => s.type === type)) pc += page.instanceCount;
        }
        return { contentType, count: c.count, pageCount: pc };
      })
      .sort((a, b) => b.count - a.count);

    out[type] = {
      totalUses: acc.totalUses,
      pageCount: pageCountByType.get(type) ?? 0,
      variants,
      byContentType,
    };
  }
  return out;
}

function buildCluster(pages: PageRecord[]): IntentCluster {
  return {
    pairings: computePairings(pages),
    topSequences: computeTopSequences(pages),
    pageCount: pages.reduce((s, p) => s + p.instanceCount, 0),
    usageByType: computeUsageByType(pages),
  };
}

function isCompatibleInsights(data: unknown): data is ComponentInsightsData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.pages) && d.global != null && typeof d.global === "object";
}

export function runScan(): ComponentInsightsData {
  const intents = loadPageIntents();
  const validIntentIds = new Set(intents.map((i) => i.id));
  const configs = getAllConfigs();

  const contentTypeIntentMap = new Map<string, string>();
  for (const [ct, cfg] of Object.entries(configs)) {
    const raw = cfg as Record<string, unknown>;
    if (typeof raw.insights_intent === "string") {
      const ctIntent = raw.insights_intent as string;
      if (!validIntentIds.has(ctIntent)) {
        log.warn(
          `[ComponentInsights] Content type "${ct}" has insights_intent "${ctIntent}" which is not in settings.yml page_intents. Falling back to "${DEFAULT_INTENT}".`,
        );
      } else {
        contentTypeIntentMap.set(ct, ctIntent);
      }
    }
  }

  const pages = scanInventory(validIntentIds, contentTypeIntentMap);

  const byIntentPages = new Map<string, PageRecord[]>();
  for (const page of pages) {
    if (!byIntentPages.has(page.intent)) byIntentPages.set(page.intent, []);
    byIntentPages.get(page.intent)!.push(page);
  }

  const byIntent: Record<string, IntentCluster> = {};
  for (const [intent, iPages] of byIntentPages.entries()) {
    byIntent[intent] = buildCluster(iPages);
  }

  const totalWeight = pages.reduce((s, p) => s + effectiveWeight(p), 0);
  const weightedPagesCount = pages.filter((p) => p.weight > 1).length;

  const data: ComponentInsightsData = {
    generatedAt: new Date().toISOString(),
    meta: {
      totalPagesScanned: pages.reduce((s, p) => s + p.instanceCount, 0),
      totalWeight,
      weightedPagesCount,
      intents: intents.map((i) => i.id),
      pageIntents: intents,
    },
    pages,
    global: buildCluster(pages),
    byIntent,
  };

  const out = outputPath();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 2), "utf-8");
  removeLegacyInsightsFile();
  log.info(
    `[ComponentInsights] Wrote ${out} — ${pages.length} inventory rows, ${data.meta.totalPagesScanned} instances`,
  );
  return data;
}

export function readInsightsFile(): ComponentInsightsData | null {
  migrateLegacyInsightsFile();
  const out = outputPath();
  if (!fs.existsSync(out)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(out, "utf-8"));
    if (!isCompatibleInsights(data)) return null;
    // Ensure usageByType exists on clusters (older partial shapes)
    if (!data.global.usageByType) return null;
    return data;
  } catch {
    return null;
  }
}

export function ensureInsightsData(): ComponentInsightsData {
  const existing = readInsightsFile();
  if (existing) return existing;
  return runScan();
}

/** Gallery / list: precomputed summary for one type (zeros if unused). */
export function getUsageSummary(componentType: string): ComponentUsageStat {
  const data = ensureInsightsData();
  return (
    data.global.usageByType[componentType] ?? {
      totalUses: 0,
      pageCount: 0,
      variants: [],
      byContentType: [],
    }
  );
}

export interface ComponentUsageResult {
  componentType: string;
  scope: Record<string, string>;
  totalUses: number;
  pageCount: number;
  pages: Array<{ contentType: string; slug: string; position: number }>;
  neighbors: {
    before: Array<{ type: string; count: number }>;
    after: Array<{ type: string; count: number }>;
  };
  topSequences: Array<{ sequence: string[]; count: number }>;
  variants: VariantUsageStat[];
  byContentType: ContentTypeUsageStat[];
  generatedAt: string;
}

export function getComponentUsageData(
  componentType: string,
  filters: { intent?: string; contentType?: string },
): ComponentUsageResult {
  const data = ensureInsightsData();

  let scoped = data.pages;
  if (filters.contentType) {
    scoped = scoped.filter((p) => p.contentType === filters.contentType);
  }
  if (filters.intent) {
    scoped = scoped.filter((p) => p.intent === filters.intent);
  }

  const usagePages: Array<{ contentType: string; slug: string; position: number }> = [];
  let totalUses = 0;

  for (const page of scoped) {
    page.sections.forEach((sec, idx) => {
      if (sec.type !== componentType) return;
      totalUses += page.instanceCount;
      if (page.kind === "shared_template" && page.slugs) {
        for (const slug of page.slugs) {
          usagePages.push({
            contentType: page.contentType,
            slug,
            position: idx + 1,
          });
        }
      } else {
        usagePages.push({
          contentType: page.contentType,
          slug: page.slug || page.key,
          position: idx + 1,
        });
      }
    });
  }

  const beforeMap = new Map<string, number>();
  const afterMap = new Map<string, number>();
  for (const page of scoped) {
    const types = sectionTypes(page);
    const w = effectiveWeight(page);
    for (let i = 0; i < types.length; i++) {
      if (types[i] !== componentType) continue;
      if (i > 0) {
        const prev = types[i - 1]!;
        beforeMap.set(prev, (beforeMap.get(prev) ?? 0) + w);
      }
      if (i < types.length - 1) {
        const next = types[i + 1]!;
        afterMap.set(next, (afterMap.get(next) ?? 0) + w);
      }
    }
  }

  const before = Array.from(beforeMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));
  const after = Array.from(afterMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));

  const topSequences = computeTopSequences(scoped)
    .filter((s) => s.sequence.includes(componentType))
    .slice(0, 5);

  const usage = computeUsageByType(scoped)[componentType] ?? {
    totalUses: 0,
    pageCount: 0,
    variants: [],
    byContentType: [],
  };

  const scope: Record<string, string> = {};
  if (filters.intent) scope.intent = filters.intent;
  if (filters.contentType) scope.contentType = filters.contentType;

  return {
    componentType,
    scope,
    totalUses,
    pageCount: usage.pageCount,
    pages: usagePages,
    neighbors: { before, after },
    topSequences,
    variants: usage.variants,
    byContentType: usage.byContentType,
    generatedAt: data.generatedAt,
  };
}

export function suggestNext(
  after: string,
  intent: string | undefined,
  rankBy: "frequency" | "pmi",
): ComponentPairing[] {
  const data = readInsightsFile();
  if (!data) return [];

  const intentCluster = intent && data.byIntent[intent];
  const cluster: IntentCluster | null =
    intentCluster && intentCluster.pageCount >= FALLBACK_CLUSTER_MIN
      ? intentCluster
      : data.global;

  const matches = cluster.pairings.filter((p) => p.from === after);
  return matches.sort((a, b) =>
    rankBy === "pmi" ? b.pmi - a.pmi : b.frequency - a.frequency,
  );
}
