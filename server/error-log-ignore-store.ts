/**
 * Global staff ignore rules for the process Error Log.
 * Separate from SQLite error_log so pruning the log cannot wipe rules.
 *
 * Production: hydrate from GCS (multisite-global/error-log-ignore.json) before
 * treating empty local as authoritative; debounced upload on write.
 * Non-production: local disk only — never upload to the production GCS key.
 */

import * as fs from "fs";
import * as path from "path";
import {
  platformErrorLogIgnoreGcsKey,
  platformErrorLogIgnoreLocalPath,
} from "@shared/gcsKeys";
import {
  emptyErrorLogIgnoreState,
  errorLogIgnoreRuleIdentity,
  errorLogIgnoreStateSchema,
  errorLogMatchesAnyIgnoreRule,
  hydrateErrorLogIgnoreRule,
  validateErrorLogIgnoreRuleInput,
  type ErrorLogIgnoreCandidate,
  type ErrorLogIgnoreRule,
  type ErrorLogIgnoreRuleInput,
  type ErrorLogIgnoreState,
} from "@shared/error-log-ignore";
import { getProjectRoot } from "@shared/paths";
import { gcs } from "./gcs";
import { child } from "./logger";

const log = child({ module: "error-log-ignore" });
const DEBOUNCE_MS = 5_000;

let productionOverrideForTests: boolean | undefined;
let localPathOverrideForTests: string | undefined;

type Bucket = {
  state: ErrorLogIgnoreState;
  hydrated: boolean;
};

let bucket: Bucket | null = null;
let pendingUploadTimer: ReturnType<typeof setTimeout> | null = null;

export function _setErrorLogIgnoreProductionForTests(value: boolean | undefined): void {
  productionOverrideForTests = value;
}

export function _setErrorLogIgnoreLocalPathForTests(value: string | undefined): void {
  localPathOverrideForTests = value;
}

function isProduction(): boolean {
  return productionOverrideForTests ?? process.env.NODE_ENV === "production";
}

function localPath(): string {
  if (localPathOverrideForTests) return localPathOverrideForTests;
  return path.join(getProjectRoot(), platformErrorLogIgnoreLocalPath());
}

function gcsKey(): string {
  return platformErrorLogIgnoreGcsKey();
}

function ensureBucket(): Bucket {
  if (!bucket) {
    bucket = { state: emptyErrorLogIgnoreState(), hydrated: false };
  }
  return bucket;
}

function saveLocal(): void {
  const b = bucket;
  if (!b) return;
  try {
    const file = localPath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(b.state, null, 2), "utf-8");
  } catch (err) {
    log.error({ err }, "failed to save local error-log-ignore");
  }
}

function saveToBucket(): void {
  // Non-production must never overwrite the production cloud file.
  if (!isProduction() || !gcs.available) return;
  const b = bucket;
  if (!b?.hydrated) return;

  if (pendingUploadTimer) clearTimeout(pendingUploadTimer);

  pendingUploadTimer = setTimeout(() => {
    pendingUploadTimer = null;
    const latest = bucket;
    if (!latest?.hydrated) return;
    const key = gcsKey();
    const payload = Buffer.from(JSON.stringify(latest.state, null, 2), "utf-8");
    void gcs.upload(key, payload, "application/json").catch((err) => {
      log.error({ err }, "error-log-ignore GCS upload failed");
    });
  }, DEBOUNCE_MS);
}

function save(): void {
  const b = bucket;
  if (!b) return;
  b.state.updatedAt = Date.now();
  saveLocal();
  saveToBucket();
}

function loadLocalInto(): ErrorLogIgnoreState {
  try {
    const file = localPath();
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
      const parsed = errorLogIgnoreStateSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    }
  } catch (err) {
    log.error({ err }, "failed to load local error-log-ignore");
  }
  return emptyErrorLogIgnoreState();
}

/**
 * Fail-open for ingest: until hydrated, callers should not apply ignore rules
 * (keep recording). Mutations force-hydrate from local when GCS is pending.
 */
export function isErrorLogIgnoreHydrated(): boolean {
  return Boolean(bucket?.hydrated);
}

function tryHydrateForWrite(): Bucket | null {
  const b = ensureBucket();
  if (b.hydrated) return b;
  if (isProduction() && gcs.available) return null;
  b.state = loadLocalInto();
  b.hydrated = true;
  saveLocal();
  return b;
}

function ensureHydratedForMutation(): Bucket {
  const ready = tryHydrateForWrite();
  if (ready) return ready;
  const b = ensureBucket();
  if (!b.hydrated) {
    b.state = loadLocalInto();
    b.hydrated = true;
    saveLocal();
  }
  return b;
}

export async function loadErrorLogIgnoreFromBucket(): Promise<void> {
  const b = ensureBucket();

  if (!isProduction() || !gcs.available) {
    b.state = loadLocalInto();
    b.hydrated = true;
    saveLocal();
    return;
  }

  try {
    const data = await gcs.download(gcsKey());
    if (data) {
      const parsed = errorLogIgnoreStateSchema.safeParse(JSON.parse(data.toString("utf-8")));
      b.state = parsed.success ? parsed.data : emptyErrorLogIgnoreState();
      saveLocal();
      log.info("loaded error-log-ignore from GCS");
    } else {
      b.state = loadLocalInto();
      log.info("no error-log-ignore in GCS — using local");
    }
  } catch (err) {
    log.error({ err }, "GCS load failed for error-log-ignore");
    b.state = loadLocalInto();
  }
  b.hydrated = true;
  saveLocal();
}

export function listErrorLogIgnoreRules(): ErrorLogIgnoreRule[] {
  const b = ensureBucket();
  if (!b.hydrated && !(isProduction() && gcs.available)) {
    b.state = loadLocalInto();
    b.hydrated = true;
  }
  return [...b.state.rules];
}

/** For ingest: only match after hydrate so boot fail-open keeps recording. */
export function shouldIgnoreErrorLogCandidate(candidate: ErrorLogIgnoreCandidate): boolean {
  const b = bucket;
  if (!b?.hydrated) return false;
  return errorLogMatchesAnyIgnoreRule(candidate, b.state.rules);
}

export function addErrorLogIgnoreRules(
  inputs: ErrorLogIgnoreRuleInput[],
): { ignored: ErrorLogIgnoreRule[]; added: ErrorLogIgnoreRule[] } {
  const b = ensureHydratedForMutation();
  const existingIds = new Set(b.state.rules.map(errorLogIgnoreRuleIdentity));
  const added: ErrorLogIgnoreRule[] = [];

  for (const input of inputs) {
    const rule = validateErrorLogIgnoreRuleInput(input);
    if (!rule) {
      throw new Error("Invalid ignore rule");
    }
    const identity = errorLogIgnoreRuleIdentity(rule);
    if (existingIds.has(identity)) continue;
    existingIds.add(identity);
    const stored = hydrateErrorLogIgnoreRule(input);
    added.push(stored);
  }

  if (added.length) {
    b.state.rules = [...b.state.rules, ...added];
    save();
  }
  return { ignored: b.state.rules, added };
}

export function removeErrorLogIgnoreRules(ids: string[]): { ignored: ErrorLogIgnoreRule[] } {
  const b = ensureHydratedForMutation();
  const idSet = new Set(ids);
  b.state.rules = b.state.rules.filter((r) => !idSet.has(r.id));
  save();
  return { ignored: b.state.rules };
}

/** Test helper */
export function _resetErrorLogIgnoreForTests(): void {
  if (pendingUploadTimer) clearTimeout(pendingUploadTimer);
  pendingUploadTimer = null;
  bucket = null;
  productionOverrideForTests = undefined;
  localPathOverrideForTests = undefined;
}
