#!/usr/bin/env tsx
/**
 * Translate English photo-backed testimonials into the Spanish flat bank.
 *
 * Selects EN rows with student_thumb + named student, resolves quotable text
 * (including sibling rows for Peter Schwarck / João Henrique Xavier), translates
 * via OpenRouter, and upserts into the site testimonials/es.yml flat bank by name+thumb.
 *
 * Usage:
 *   npx tsx scripts/translate-testimonials-en-to-es.ts              # dry run
 *   npx tsx scripts/translate-testimonials-en-to-es.ts --write      # apply
 *   npx tsx scripts/translate-testimonials-en-to-es.ts --write --limit=5
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ quiet: true });

import fs from "fs";
import path from "path";
import OpenAI from "openai";
import yaml from "js-yaml";
import { getDefaultContentRoot } from "../server/site-config";
import { markFileAsModified } from "../server/sync-state";

const WRITE = process.argv.includes("--write");
const rootArg = process.argv.find((a) => a.startsWith("--content-root="));
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;

const CONTENT_ROOT = rootArg ? rootArg.split("=")[1] : getDefaultContentRoot();
const EN_PATH = path.join(CONTENT_ROOT, "testimonials", "en.yml");
const ES_PATH = path.join(CONTENT_ROOT, "testimonials", "es.yml");
const LLM_YML_PATH = path.join(CONTENT_ROOT, "llm.yml");
const PREVIEW_PATH = path.join(process.cwd(), ".cache", "translate-testimonials-es-preview.json");

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const CONCURRENCY = 3;
const MAX_RETRIES = 3;

const TEXT_FIELDS = ["excerpt", "content", "full_text"] as const;
const COPY_FIELDS = [
  "student_name",
  "student_thumb",
  "priority",
  "linkedin_url",
  "related_features",
  "role",
  "company",
  "rating",
  "testimonial_date",
  "source",
] as const;

type Row = Record<string, unknown>;
type TextField = (typeof TEXT_FIELDS)[number];

const ANONYMOUS = new Set(["anonymous", "anonimous", "anónimo", "anonimo", "anon"]);

function loadLlmConfig(): { apiKey: string; baseURL: string; model: string } {
  let apiKeyEnv = "OPENROUTER_API_KEY";
  let baseUrlEnv = "OPENROUTER_BASE_URL";
  let model = process.env.LLM_MODEL || DEFAULT_MODEL;

  try {
    if (fs.existsSync(LLM_YML_PATH)) {
      const cfg = yaml.load(fs.readFileSync(LLM_YML_PATH, "utf-8")) as {
        provider?: { api_key_env?: string; base_url_env?: string };
        model?: string | { default?: string };
      };
      if (cfg?.provider?.api_key_env) apiKeyEnv = cfg.provider.api_key_env;
      if (cfg?.provider?.base_url_env) baseUrlEnv = cfg.provider.base_url_env;
      if (!process.env.LLM_MODEL) {
        if (typeof cfg?.model === "string") model = cfg.model;
        else if (cfg?.model?.default) model = cfg.model.default;
      }
    }
  } catch {
    /* defaults */
  }

  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`LLM not configured. Set ${apiKeyEnv} in environment.`);
  }

  const baseURL =
    process.env[baseUrlEnv] ||
    (baseUrlEnv === "OPENROUTER_BASE_URL" ? OPENROUTER_DEFAULT_BASE_URL : undefined) ||
    OPENROUTER_DEFAULT_BASE_URL;

  return { apiKey, baseURL, model };
}

function normalizeName(name: unknown): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isAnonymous(name: unknown): boolean {
  const n = String(name ?? "").trim().toLowerCase();
  return !n || ANONYMOUS.has(n);
}

function rowText(row: Row, field: TextField): string {
  const v = row[field];
  return typeof v === "string" ? v.trim() : "";
}

function presentTextFields(row: Row): TextField[] {
  return TEXT_FIELDS.filter((f) => rowText(row, f).length > 0);
}

function mergeTextFields(target: Row, source: Row): void {
  for (const f of TEXT_FIELDS) {
    if (!rowText(target, f) && rowText(source, f)) {
      target[f] = source[f];
    }
  }
}

function identityKey(row: Row): string {
  return `${normalizeName(row.student_name)}::${String(row.student_thumb ?? "").trim()}`;
}

function selectPhotoRows(rows: Row[]): Row[] {
  return rows.filter(
    (r) =>
      r.student_thumb &&
      String(r.student_thumb).trim() &&
      !isAnonymous(r.student_name),
  );
}

function resolveSourceText(photoRow: Row, allEn: Row[]): { row: Row; fields: TextField[] } | null {
  const merged: Row = { ...photoRow };
  const fields = presentTextFields(merged);

  if (fields.length === 0) {
    const sibling = allEn.find(
      (r) =>
        normalizeName(r.student_name) === normalizeName(photoRow.student_name) &&
        presentTextFields(r).length > 0,
    );
    if (sibling) mergeTextFields(merged, sibling);
  }

  const resolvedFields = presentTextFields(merged);
  if (resolvedFields.length === 0) return null;
  return { row: merged, fields: resolvedFields };
}

function buildEsRow(enSource: Row, translated: Partial<Record<TextField, string>>): Row {
  const out: Row = {};
  for (const field of COPY_FIELDS) {
    const value = enSource[field];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[field] = value;
  }
  for (const field of TEXT_FIELDS) {
    const t = translated[field];
    if (t?.trim()) out[field] = t.trim();
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function translateRow(
  openai: OpenAI,
  model: string,
  studentName: string,
  fields: TextField[],
  source: Row,
): Promise<Partial<Record<TextField, string>>> {
  const payload: Record<string, string> = {};
  for (const f of fields) payload[f] = rowText(source, f);

  const prompt = `You translate student testimonials for 4Geeks Academy (coding bootcamp marketing).

Translate the following English testimonial fields into natural Spanish (Latin America neutral, professional but warm).
Rules:
- Preserve person names, company names, numbers, and percentages exactly.
- Do not add claims, outcomes, or details not in the source.
- Keep similar length and tone to the source.
- Return ONLY valid JSON with the same keys as the input.

Student: ${studentName}

Input JSON:
${JSON.stringify(payload, null, 2)}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });
      const raw = res.choices[0]?.message?.content?.trim();
      if (!raw) throw new Error("Empty LLM response");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const out: Partial<Record<TextField, string>> = {};
      for (const f of fields) {
        const v = parsed[f];
        if (typeof v === "string" && v.trim()) out[f] = v.trim();
      }
      if (Object.keys(out).length === 0) throw new Error("No translated fields in response");
      return out;
    } catch (err) {
      lastErr = err;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

interface PreviewEntry {
  student_name: string;
  student_thumb: string;
  action: "insert" | "update" | "skip";
  reason?: string;
  en_fields?: TextField[];
  es_excerpt_preview?: string;
}

function upsertIntoEsBank(esRows: Row[], newRow: Row): { rows: Row[]; action: "insert" | "update" } {
  const key = identityKey(newRow);
  const matchIndexes: number[] = [];
  for (let i = 0; i < esRows.length; i++) {
    const r = esRows[i];
    if (r.student_thumb && identityKey(r) === key) matchIndexes.push(i);
  }

  if (matchIndexes.length === 0) {
    return { rows: [...esRows, newRow], action: "insert" };
  }

  const keep = matchIndexes[0];
  const updated = [...esRows];
  updated[keep] = { ...updated[keep], ...newRow };

  // Remove duplicate photo rows for the same person+thumb (e.g. Virginia Martínez x2).
  const remove = new Set(matchIndexes.slice(1));
  const deduped = updated.filter((_, i) => !remove.has(i));
  return { rows: deduped, action: "update" };
}

async function main(): Promise<void> {
  const llm = loadLlmConfig();
  const openai = new OpenAI({ apiKey: llm.apiKey, baseURL: llm.baseURL });

  if (!fs.existsSync(EN_PATH)) throw new Error(`Missing ${EN_PATH}`);
  const enRows = yaml.load(fs.readFileSync(EN_PATH, "utf-8")) as Row[];
  if (!Array.isArray(enRows)) throw new Error("en.yml must be an array");

  let esRows: Row[] = [];
  if (fs.existsSync(ES_PATH)) {
    const parsed = yaml.load(fs.readFileSync(ES_PATH, "utf-8"));
    esRows = Array.isArray(parsed) ? (parsed as Row[]) : [];
  }

  let photoRows = selectPhotoRows(enRows);
  if (LIMIT != null && LIMIT > 0) photoRows = photoRows.slice(0, LIMIT);

  console.log("contentRoot", CONTENT_ROOT);
  console.log("enPhotoRows", photoRows.length);
  console.log("write", WRITE);

  const toTranslate: Array<{
    photoRow: Row;
    source: Row;
    fields: TextField[];
  }> = [];
  const preview: PreviewEntry[] = [];

  for (const photoRow of photoRows) {
    const resolved = resolveSourceText(photoRow, enRows);
    if (!resolved) {
      preview.push({
        student_name: String(photoRow.student_name),
        student_thumb: String(photoRow.student_thumb),
        action: "skip",
        reason: "no English quote to translate",
      });
      continue;
    }
    toTranslate.push({ photoRow, source: resolved.row, fields: resolved.fields });
  }

  console.log("toTranslate", toTranslate.length);
  console.log("skipped", preview.filter((p) => p.action === "skip").length);

  const translatedRows = await mapPool(toTranslate, CONCURRENCY, async (item, i) => {
    const name = String(item.photoRow.student_name);
    process.stdout.write(`Translating ${i + 1}/${toTranslate.length}: ${name}\n`);
    const translated = await translateRow(openai, llm.model, name, item.fields, item.source);
    return buildEsRow(item.photoRow, translated);
  });

  let workingEs = esRows;
  for (let i = 0; i < translatedRows.length; i++) {
    const esRow = translatedRows[i];
    const src = toTranslate[i];
    const { rows, action } = upsertIntoEsBank(workingEs, esRow);
    workingEs = rows;
    preview.push({
      student_name: String(esRow.student_name),
      student_thumb: String(esRow.student_thumb),
      action,
      en_fields: src.fields,
      es_excerpt_preview: rowText(esRow, "excerpt").slice(0, 120),
    });
  }

  fs.mkdirSync(path.dirname(PREVIEW_PATH), { recursive: true });
  fs.writeFileSync(PREVIEW_PATH, JSON.stringify(preview, null, 2), "utf-8");
  console.log("previewWritten", PREVIEW_PATH);
  console.log("summary", {
    insert: preview.filter((p) => p.action === "insert").length,
    update: preview.filter((p) => p.action === "update").length,
    skip: preview.filter((p) => p.action === "skip").length,
    esRowsBefore: esRows.length,
    esRowsAfter: workingEs.length,
  });

  if (!WRITE) {
    console.log("dryRun", true, "(pass --write to apply)");
    return;
  }

  fs.writeFileSync(ES_PATH, yaml.dump(workingEs, { lineWidth: 120, noRefs: true, sortKeys: false }), "utf-8");
  markFileAsModified(path.relative(process.cwd(), ES_PATH), "translate-testimonials-en-to-es", undefined, CONTENT_ROOT);
  console.log("wrote", ES_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
