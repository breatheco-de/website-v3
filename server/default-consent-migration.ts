/**
 * Data migration 006: every site gets a Default consent (`consent.fallback: consent_general`)
 * and Florida gets the `request_downloadable` conversion event copied from 4geeks.com.
 * Edits are text edits (comments and formatting kept); each result is parsed again and
 * compared with the expected settings before anything is written.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { isDeepStrictEqual } from "util";
import { normalizeConsentFallbackKey } from "@shared/consent-settings";

type Log = (...args: unknown[]) => void;

export const DEFAULT_CONSENT_KEY = "consent_general";
export const EVENT_SOURCE_SITE = "site_4geeks-com";
export const EVENT_TARGET_SITE = "site_4geeks-florida";
export const COPIED_EVENT_NAME = "request_downloadable";

type Edit = { ok: true; text: string; changed: boolean; note: string } | { ok: false; reason: string };

function parse(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const value = yaml.load(text);
    return { ok: true, value: (value && typeof value === "object" ? value : {}) as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split("\n")[0]! : String(err) };
  }
}

function indentOf(line: string): number {
  return line.match(/^(\s*)/)![1]!.length;
}

/** Sets `consent.fallback` when the site has no valid Default consent. */
export function setDefaultConsentText(text: string, key: string = DEFAULT_CONSENT_KEY): Edit {
  const before = parse(text);
  if (!before.ok) return { ok: false, reason: `settings.yml can't be read (${before.error})` };
  const consent = before.value.consent;
  const current = consent && typeof consent === "object" ? (consent as Record<string, unknown>).fallback : undefined;
  if (normalizeConsentFallbackKey(current)) {
    return { ok: true, text, changed: false, note: `already has a Default consent (${String(current)})` };
  }

  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^consent:/.test(l));
  let next: string;
  if (start < 0) {
    const body = text.endsWith("\n") || text === "" ? text : `${text}\n`;
    next = `${body}consent:\n  fallback: ${key}\n`;
  } else {
    if (!/^consent:\s*(#.*)?$/.test(lines[start]!)) {
      return { ok: false, reason: "the consent: block in settings.yml isn't a plain block; set the Default consent in Settings" };
    }
    let end = start + 1;
    while (end < lines.length && (lines[end]!.trim() === "" || /^\s/.test(lines[end]!))) end++;
    const children = lines.slice(start + 1, end);
    const firstChild = children.find((l) => l.trim() !== "" && !l.trim().startsWith("#"));
    const childIndent = " ".repeat(firstChild ? indentOf(firstChild) : 2);
    const fallbackIdx = children.findIndex((l) => new RegExp(`^${childIndent}fallback:`).test(l));
    const out = [...lines];
    if (fallbackIdx >= 0) out[start + 1 + fallbackIdx] = `${childIndent}fallback: ${key}`;
    else out.splice(start + 1, 0, `${childIndent}fallback: ${key}`);
    next = out.join("\n");
  }

  const after = parse(next);
  const expected = {
    ...before.value,
    consent: { ...((consent && typeof consent === "object" ? consent : {}) as Record<string, unknown>), fallback: key },
  };
  if (!after.ok || !isDeepStrictEqual(after.value, expected)) {
    return { ok: false, reason: "setting the Default consent would change other settings; set it in Settings instead" };
  }
  return { ok: true, text: next, changed: true, note: `set the Default consent to ${key}` };
}

function conversionEvents(obj: Record<string, unknown>): Array<Record<string, unknown>> | null {
  const tracking = obj.tracking;
  if (!tracking || typeof tracking !== "object") return null;
  const events = (tracking as Record<string, unknown>).conversion_events;
  return Array.isArray(events) ? (events as Array<Record<string, unknown>>) : null;
}

/** Line range [start, end) of the `- name: <name>` list item, or null. */
function findEventItem(lines: string[], name: string): { start: number; end: number; indent: number } | null {
  const re = new RegExp(`^(\\s*)- name:\\s*['"]?${name}['"]?\\s*(#.*)?$`);
  const start = lines.findIndex((l) => re.test(l));
  if (start < 0) return null;
  const indent = indentOf(lines[start]!);
  let end = start + 1;
  while (end < lines.length) {
    const l = lines[end]!;
    if (l.trim() !== "" && indentOf(l) <= indent) break;
    end++;
  }
  while (end > start + 1 && lines[end - 1]!.trim() === "") end--;
  return { start, end, indent };
}

/** Appends the source site's conversion event (copied as text, re-indented) to the target's list. */
export function copyConversionEventText(targetText: string, sourceText: string, name: string = COPIED_EVENT_NAME): Edit {
  const target = parse(targetText);
  if (!target.ok) return { ok: false, reason: `settings.yml can't be read (${target.error})` };
  const source = parse(sourceText);
  if (!source.ok) return { ok: false, reason: `${EVENT_SOURCE_SITE} settings.yml can't be read (${source.error})` };

  const sourceEvent = conversionEvents(source.value)?.find((e) => e?.name === name);
  if (!sourceEvent) return { ok: false, reason: `${EVENT_SOURCE_SITE} has no ${name} conversion event to copy` };
  const targetEvents = conversionEvents(target.value);
  if (!targetEvents) return { ok: false, reason: "this site has no tracking.conversion_events list; add the event in Conversions" };
  if (targetEvents.some((e) => e?.name === name)) {
    return { ok: true, text: targetText, changed: false, note: `already has the ${name} conversion event` };
  }

  const sourceLines = sourceText.split("\n");
  const item = findEventItem(sourceLines, name);
  if (!item) return { ok: false, reason: `couldn't find the ${name} entry as text in ${EVENT_SOURCE_SITE} settings.yml` };

  const lines = targetText.split("\n");
  const trackingIdx = lines.findIndex((l) => /^tracking:\s*(#.*)?$/.test(l));
  const listIdx = trackingIdx < 0 ? -1 : lines.findIndex((l, i) => i > trackingIdx && /^\s+conversion_events:\s*(#.*)?$/.test(l));
  if (listIdx < 0) return { ok: false, reason: "tracking.conversion_events isn't a plain block list; add the event in Conversions" };
  const keyIndent = indentOf(lines[listIdx]!);
  const firstItem = lines.slice(listIdx + 1).find((l) => /^\s*- /.test(l));
  const itemIndent = firstItem ? indentOf(firstItem) : keyIndent + 2;
  let end = listIdx + 1;
  while (end < lines.length && (lines[end]!.trim() === "" || indentOf(lines[end]!) > keyIndent)) end++;
  while (end > listIdx + 1 && lines[end - 1]!.trim() === "") end--;

  const shift = itemIndent - item.indent;
  const copied = sourceLines.slice(item.start, item.end).map((l) => {
    if (l.trim() === "") return "";
    return shift >= 0 ? " ".repeat(shift) + l : l.slice(Math.min(-shift, indentOf(l)));
  });
  const next = [...lines.slice(0, end), ...copied, ...lines.slice(end)].join("\n");

  const after = parse(next);
  const expected = {
    ...target.value,
    tracking: { ...(target.value.tracking as Record<string, unknown>), conversion_events: [...targetEvents, sourceEvent] },
  };
  if (!after.ok || !isDeepStrictEqual(after.value, expected)) {
    return { ok: false, reason: `adding ${name} would change other settings; add it in Conversions instead` };
  }
  return { ok: true, text: next, changed: true, note: `added the ${name} conversion event copied from ${EVENT_SOURCE_SITE}` };
}

export type DefaultConsentPlan =
  | { action: "nothing"; notes: string[] }
  | { action: "recover"; file: string }
  | { action: "write"; settingsText: string; notes: string[] }
  | { action: "blocked"; reason: string };

/** Pure: what the migration does for one site. */
export function planDefaultConsentMigration(input: {
  site: string;
  settingsText: string | null;
  sourceSettingsText: string | null;
  pending: string[];
}): DefaultConsentPlan {
  const settingsFile = `${input.site}/settings.yml`;
  if (input.settingsText == null) return { action: "blocked", reason: "settings.yml not found" };

  const notes: string[] = [];
  const fallback = setDefaultConsentText(input.settingsText);
  if (!fallback.ok) return { action: "blocked", reason: fallback.reason };
  notes.push(fallback.note);
  let text = fallback.text;
  let changed = fallback.changed;

  if (input.site === EVENT_TARGET_SITE) {
    if (input.sourceSettingsText == null) {
      return { action: "blocked", reason: `${EVENT_SOURCE_SITE} settings.yml not found; can't copy ${COPIED_EVENT_NAME}` };
    }
    const event = copyConversionEventText(text, input.sourceSettingsText);
    if (!event.ok) return { action: "blocked", reason: event.reason };
    notes.push(event.note);
    text = event.text;
    changed = changed || event.changed;
  }

  if (changed) return { action: "write", settingsText: text, notes };
  if (input.pending.includes(settingsFile)) return { action: "recover", file: settingsFile };
  return { action: "nothing", notes };
}

export type DefaultConsentMigrationDeps = {
  sites: () => Array<{ name: string; contentRoot: string }>;
  pending: (site: string) => string[];
  markModified: (file: string, contentRoot: string) => void;
  push: (site: string, files: string[], message: string) => Promise<{ success: boolean; commitHash?: string; error?: string }>;
};

async function defaultDeps(): Promise<DefaultConsentMigrationDeps> {
  const { getSiteContextMap } = await import("./site-manager");
  const { detectPendingChanges, markFileAsModified, flushPendingSyncStateWrites } = await import("./sync-state");
  const { commitAndPush } = await import("./github");
  return {
    sites: () => Array.from(getSiteContextMap().values()).map((c) => ({ name: c.contentRootName, contentRoot: c.contentRoot })),
    pending: (site) =>
      detectPendingChanges(site)
        .filter((c) => c.source === "local")
        .map((c) => c.file),
    markModified: (file, contentRoot) => {
      markFileAsModified(file, "migration:006", undefined, contentRoot);
      flushPendingSyncStateWrites(contentRoot);
    },
    push: (site, files, message) => commitAndPush(message, { files, contentRoot: site }),
  };
}

export async function runDefaultConsentMigration(opts: {
  site?: string;
  dryRun: boolean;
  log?: Log;
  error?: Log;
  deps?: DefaultConsentMigrationDeps;
}): Promise<{ failed: boolean }> {
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const deps = opts.deps ?? (await defaultDeps());
  const allSites = deps.sites();
  const rootOf = (contentRoot: string) => (path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot));
  const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, "utf-8") : null);
  const source = allSites.find((s) => s.name === EVENT_SOURCE_SITE);
  const sourceSettingsText = source ? read(path.join(rootOf(source.contentRoot), "settings.yml")) : null;
  let failed = false;
  let matched = false;

  for (const s of allSites) {
    if (opts.site && s.name !== opts.site) continue;
    matched = true;
    log("site", s.name);
    const settingsPath = path.join(rootOf(s.contentRoot), "settings.yml");
    const settingsFile = `${s.name}/settings.yml`;
    const plan = planDefaultConsentMigration({
      site: s.name,
      settingsText: read(settingsPath),
      sourceSettingsText,
      pending: deps.pending(s.name),
    });

    const push = async (message: string): Promise<boolean> => {
      const res = await deps.push(s.name, [settingsFile], message);
      if (!res.success || !res.commitHash) {
        error("push_failed", res.error ?? "no commit SHA returned");
        error("files", [settingsFile]);
        return false;
      }
      log("commitSha", res.commitHash);
      return true;
    };

    switch (plan.action) {
      case "nothing":
        log("nothing_to_do", plan.notes);
        break;
      case "blocked":
        error("blocked", plan.reason);
        failed = true;
        break;
      case "recover":
        log("recovery", "settings.yml was changed by an earlier run but not pushed; pushing it");
        if (!opts.dryRun && !(await push("Default consent: push settings left by an interrupted run"))) failed = true;
        break;
      case "write":
        log("change", plan.notes);
        if (opts.dryRun) break;
        fs.writeFileSync(settingsPath, plan.settingsText, "utf-8");
        deps.markModified("settings.yml", s.contentRoot);
        if (!(await push("Default consent: every form gets a mandatory checkbox (General as site Default)"))) failed = true;
        break;
    }
  }
  if (opts.site && !matched) {
    error("site_not_found", opts.site);
    failed = true;
  }
  return { failed };
}
