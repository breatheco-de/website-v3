/**
 * Dev-only fake pipeline events for timeline / event-log UI testing.
 * Always marks rows published so the outbox dispatcher is not woken.
 */

import { getSiteSqlite } from "../db";
import { ensurePipelineDb } from "../pipeline-db/runner";
import type { ContentEvent, EventAttribution, EventType } from "./types";

type SeedSpec = {
  type: EventType;
  /** Negative = past; 0 = now. */
  offsetMs: number;
  attribution: EventAttribution[];
  cause?: string;
  resource?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  /** Index into previously inserted ids in this batch (for causality). */
  triggeredByIndex?: number;
};

const DEMO_CAUSE = "demo-seed";

function mcp(client: string, model: string, author = "demo-agent"): EventAttribution[] {
  return [{ author, actor: { type: "mcp", client, model } }];
}

function staff(author = "staff.dev"): EventAttribution[] {
  return [{ author, actor: { type: "ui" } }];
}

function system(source: string): EventAttribution[] {
  return [{ actor: { type: "system", source } }];
}

/** Historical + one “just now” burst — good for scrubbing the timeline. */
function batchSpecs(): SeedSpec[] {
  return [
    {
      type: "content_file_written",
      offsetMs: -95 * 60_000,
      attribution: mcp("Cursor", "claude-4-sonnet"),
      resource: { contentType: "blog", slug: "demo-post", locale: "en", path: "blog/demo-post/en.yml" },
      payload: { demo: true, title: "Demo blog save" },
    },
    {
      type: "index_snapshot_ready",
      offsetMs: -94 * 60_000,
      attribution: system("index-refresh"),
      payload: { demo: true, entriesIndexed: 434, note: "Index snapshot after demo save" },
      triggeredByIndex: 0,
    },
    {
      type: "validation_results_ready",
      offsetMs: -90 * 60_000,
      attribution: mcp("Cursor", "gpt-4o"),
      resource: { contentType: "blog", slug: "demo-post", locale: "en" },
      payload: { demo: true, issueCount: 2, skipped: false },
      triggeredByIndex: 0,
    },
    {
      type: "validation_issue_completed",
      offsetMs: -88 * 60_000,
      attribution: mcp("Cursor", "claude-4-sonnet"),
      resource: { contentType: "blog", slug: "demo-post", locale: "en", path: "blog/demo-post/en.yml" },
      payload: {
        demo: true,
        entryKey: "blog/demo-post/en",
        code: "meta_description_too_short",
        severity: "warning",
        validator: "seo",
        report:
          "I expanded the meta description to ~155 characters and kept the primary keyword near the front. Re-ran SEO checks — this warning is clear.",
      },
      triggeredByIndex: 2,
    },
    {
      type: "binding_propagation_started",
      offsetMs: -55 * 60_000,
      attribution: mcp("Codex", "codex"),
      resource: { groupId: "demo-footer", locale: "en" },
      payload: { demo: true, memberCount: 3 },
    },
    {
      type: "binding_propagation_done",
      offsetMs: -54 * 60_000,
      attribution: mcp("Codex", "codex"),
      resource: { groupId: "demo-footer", locale: "en" },
      payload: { demo: true, updated: 3 },
      triggeredByIndex: 4,
    },
    {
      type: "content_file_written",
      offsetMs: -28 * 60_000,
      attribution: mcp("Cursor", "gemini-2.5-pro"),
      resource: { contentType: "landing", slug: "demo-landing", locale: "es", path: "landings/demo-landing/es.yml" },
      payload: { demo: true, title: "Landing ES save" },
    },
    {
      type: "redirects_changed",
      offsetMs: -12 * 60_000,
      attribution: staff(),
      payload: { demo: true, added: 1, removed: 0 },
    },
    {
      type: "job_failed",
      offsetMs: -6 * 60_000,
      attribution: system("github-pull"),
      payload: { demo: true, job: "github_pull", error: "Demo failure for UI — safe to ignore" },
    },
    {
      type: "content_file_written",
      offsetMs: -45_000,
      attribution: mcp("Cursor", "claude-4-sonnet"),
      resource: { contentType: "page", slug: "home", locale: "en", path: "pages/home/en.yml" },
      payload: { demo: true, title: "Home tweak" },
    },
    {
      type: "validation_results_ready",
      offsetMs: 0,
      attribution: mcp("Perplexity", "sonar"),
      resource: { contentType: "page", slug: "home", locale: "en" },
      payload: { demo: true, skipped: true, note: "Dedupe skip — tests muted row styling" },
      triggeredByIndex: 9,
    },
  ];
}

/** Single fresh event at “now” — for pop-in / push-down animation tests. */
function liveSpec(tick: number): SeedSpec {
  const agents = [
    mcp("Cursor", "claude-4-sonnet"),
    mcp("Cursor", "gpt-4o"),
    mcp("Grok", "grok-3"),
    mcp("Mistral", "mistral-large"),
    mcp("DeepSeek", "deepseek-chat"),
  ] as const;
  const types: EventType[] = [
    "content_file_written",
    "index_snapshot_ready",
    "validation_results_ready",
    "binding_propagation_done",
    "redirects_changed",
  ];
  const attribution = agents[tick % agents.length]!;
  const type = types[tick % types.length]!;
  return {
    type,
    offsetMs: 0,
    attribution,
    resource: {
      contentType: "blog",
      slug: `live-demo-${tick}`,
      locale: "en",
      path: `blog/live-demo-${tick}/en.yml`,
    },
    payload: {
      demo: true,
      live: true,
      tick,
      note: "Live drip for pop-in animation",
    },
  };
}

function insertSeedEvent(
  site: string,
  spec: SeedSpec,
  priorIds: number[],
): ContentEvent {
  ensurePipelineDb(site);
  const db = getSiteSqlite(site);
  const createdAt = Date.now() + spec.offsetMs;
  const triggeredBy =
    spec.triggeredByIndex != null ? priorIds[spec.triggeredByIndex] : undefined;
  const attribution = spec.attribution;
  const info = db
    .prepare(
      `INSERT INTO events (
        type, site, resource_json, cause, payload_json,
        triggered_by_event_id, triggered_by_event_ids_json, attribution_json,
        published, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(
      spec.type,
      site,
      JSON.stringify(spec.resource ?? {}),
      spec.cause ?? DEMO_CAUSE,
      JSON.stringify({ ...(spec.payload ?? {}), seed: true }),
      triggeredBy ?? null,
      null,
      JSON.stringify(attribution),
      createdAt,
    );
  const id = Number(info.lastInsertRowid);
  return {
    id,
    type: spec.type,
    site,
    resource: (spec.resource ?? {}) as ContentEvent["resource"],
    attribution,
    cause: spec.cause ?? DEMO_CAUSE,
    payload: { ...(spec.payload ?? {}), seed: true },
    triggeredByEventId: triggeredBy,
    published: true,
    created_at: createdAt,
  };
}

export type SeedDemoMode = "batch" | "live";

export function seedDemoPipelineEvents(
  site: string,
  mode: SeedDemoMode = "batch",
  liveTick = 0,
): { events: ContentEvent[]; mode: SeedDemoMode } {
  const specs = mode === "live" ? [liveSpec(liveTick)] : batchSpecs();
  const priorIds: number[] = [];
  const events: ContentEvent[] = [];
  for (const spec of specs) {
    const ev = insertSeedEvent(site, spec, priorIds);
    priorIds.push(ev.id);
    events.push(ev);
  }
  return { events, mode };
}
