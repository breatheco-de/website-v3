import type Database from "better-sqlite3";
import type { PipelineMigration } from "./types";
import { indexExists, tableExists, tableHasColumn } from "./types";
import {
  SYSTEM_JOB_FOLLOW_UP_TYPES,
  systemJobAttribution,
  systemJobSourceForType,
  type SystemJobFollowUpType,
} from "../events/types";
import { sameAgentIdentity, type AgentActorLike } from "../../shared/agent-identity";

export const PIPELINE_SCHEMA_VERSION = 39;

export const PIPELINE_MIGRATIONS: PipelineMigration[] = [
  {
    version: 1,
    name: "events_core",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          site TEXT NOT NULL,
          resource_json TEXT NOT NULL DEFAULT '{}',
          cause TEXT,
          payload_json TEXT NOT NULL DEFAULT '{}',
          published INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: "events_attribution",
    up(db) {
      if (!tableExists(db, "events")) return;
      if (tableHasColumn(db, "events", "attribution_json")) return;

      if (tableHasColumn(db, "events", "author")) {
        db.exec("BEGIN");
        try {
          db.exec(`
            CREATE TABLE events_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              type TEXT NOT NULL,
              site TEXT NOT NULL,
              resource_json TEXT NOT NULL DEFAULT '{}',
              cause TEXT,
              payload_json TEXT NOT NULL DEFAULT '{}',
              triggered_by_event_id INTEGER,
              triggered_by_event_ids_json TEXT,
              attribution_json TEXT NOT NULL DEFAULT '[]',
              published INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL
            );
            INSERT INTO events_new (id, type, site, resource_json, cause, payload_json, attribution_json, published, created_at)
            SELECT id, type, site, resource_json, cause, payload_json,
              CASE WHEN author IS NOT NULL AND author != '' THEN json_array(json_object('author', author)) ELSE '[]' END,
              published, created_at
            FROM events;
            DROP TABLE events;
            ALTER TABLE events_new RENAME TO events;
          `);
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      } else {
        db.exec(
          "ALTER TABLE events ADD COLUMN attribution_json TEXT NOT NULL DEFAULT '[]'",
        );
      }
    },
  },
  {
    version: 3,
    name: "events_triggers",
    up(db) {
      if (!tableExists(db, "events")) return;
      if (!tableHasColumn(db, "events", "triggered_by_event_id")) {
        db.exec("ALTER TABLE events ADD COLUMN triggered_by_event_id INTEGER");
      }
      if (!tableHasColumn(db, "events", "triggered_by_event_ids_json")) {
        db.exec("ALTER TABLE events ADD COLUMN triggered_by_event_ids_json TEXT");
      }
    },
  },
  {
    version: 4,
    name: "events_indexes",
    up(db) {
      if (!tableExists(db, "events")) return;
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_events_unpublished ON events(published, created_at);
        CREATE INDEX IF NOT EXISTS idx_events_site_type ON events(site, type, created_at);
        CREATE INDEX IF NOT EXISTS idx_events_triggered_by ON events(triggered_by_event_id);
      `);
    },
  },
  {
    version: 5,
    name: "pipeline_state",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pipeline_state (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 6,
    name: "leases",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS leases (
          resource TEXT PRIMARY KEY,
          holder TEXT NOT NULL,
          token INTEGER NOT NULL DEFAULT 1,
          expires_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 7,
    name: "events_agent_session",
    up(db) {
      if (!tableExists(db, "events")) return;
      if (!tableHasColumn(db, "events", "agent_session_id")) {
        db.exec("ALTER TABLE events ADD COLUMN agent_session_id TEXT");
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_events_agent_session
        ON events(site, agent_session_id, created_at);
      `);
    },
  },
  {
    version: 8,
    name: "content_proposals",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS content_proposals (
          id TEXT PRIMARY KEY,
          site TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          status TEXT NOT NULL,
          kind TEXT NOT NULL,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          rationale TEXT,
          documentation_json TEXT NOT NULL DEFAULT '{}',
          related_issue_ids_json TEXT NOT NULL DEFAULT '[]',
          proposer_username TEXT NOT NULL,
          proposer_actor_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          claim_json TEXT,
          tags_json TEXT NOT NULL DEFAULT '[]',
          search_text TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS content_proposal_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          proposal_id TEXT NOT NULL,
          entry_key TEXT NOT NULL,
          locale TEXT NOT NULL,
          variant TEXT,
          status TEXT NOT NULL,
          ops_json TEXT NOT NULL DEFAULT '[]',
          baseline_context_json TEXT NOT NULL DEFAULT '{}',
          last_error TEXT,
          applied_at INTEGER,
          applied_by TEXT,
          FOREIGN KEY (proposal_id) REFERENCES content_proposals(id)
        );
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_content_proposals_site_status
          ON content_proposals(site, status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_content_proposals_fingerprint
          ON content_proposals(site, fingerprint, status);
        CREATE INDEX IF NOT EXISTS idx_content_proposal_entries_proposal
          ON content_proposal_entries(proposal_id);
      `);
    },
  },
  {
    version: 9,
    name: "system_job_follow_up_attribution",
    up(db) {
      if (!tableExists(db, "events")) return;
      if (!tableHasColumn(db, "events", "attribution_json")) return;

      const update = db.prepare(
        `UPDATE events
         SET attribution_json = ?
         WHERE type = ?
           AND (
             attribution_json IS NULL
             OR attribution_json = ''
             OR attribution_json = '[]'
             OR json_extract(attribution_json, '$[0].actor.type') IS NULL
             OR json_extract(attribution_json, '$[0].actor.type') = ''
             OR json_extract(attribution_json, '$[0].actor.type') IN ('ui', 'mcp')
           )`,
      );

      for (const type of SYSTEM_JOB_FOLLOW_UP_TYPES) {
        const source = systemJobSourceForType(type as SystemJobFollowUpType);
        const json = JSON.stringify(systemJobAttribution(source));
        update.run(json, type);
      }
    },
  },
  {
    version: 10,
    name: "content_proposals_variant_collab",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "created_agent_session_id")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN created_agent_session_id TEXT");
      }
      if (!tableHasColumn(db, "content_proposals", "promote_on_apply")) {
        db.exec(
          "ALTER TABLE content_proposals ADD COLUMN promote_on_apply INTEGER NOT NULL DEFAULT 0",
        );
      }
      if (
        tableExists(db, "content_proposal_entries") &&
        !tableHasColumn(db, "content_proposal_entries", "variant_fingerprint")
      ) {
        db.exec("ALTER TABLE content_proposal_entries ADD COLUMN variant_fingerprint TEXT");
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS content_proposal_blockers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          proposal_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'blocker',
          body TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          author TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER,
          resolved_by TEXT,
          resolve_note TEXT,
          agent_session_id TEXT,
          FOREIGN KEY (proposal_id) REFERENCES content_proposals(id)
        );
        CREATE INDEX IF NOT EXISTS idx_content_proposal_blockers_proposal
          ON content_proposal_blockers(proposal_id, status);
      `);
    },
  },
  {
    version: 11,
    name: "content_proposals_close_no_auto_retry",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "close_reason")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN close_reason TEXT");
      }
      if (!tableHasColumn(db, "content_proposals", "close_note")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN close_note TEXT");
      }
      if (!tableHasColumn(db, "content_proposals", "closed_by")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN closed_by TEXT");
      }
      if (!tableHasColumn(db, "content_proposals", "closed_at")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN closed_at INTEGER");
      }
      if (!tableHasColumn(db, "content_proposals", "no_auto_retry")) {
        db.exec(
          "ALTER TABLE content_proposals ADD COLUMN no_auto_retry INTEGER NOT NULL DEFAULT 0",
        );
      }
      if (tableHasColumn(db, "content_proposals", "kind")) {
        db.exec(`
          UPDATE content_proposals
          SET no_auto_retry = 1
          WHERE kind = 'notes' AND status IN ('open', 'partial')
        `);
      }
    },
  },
  {
    version: 12,
    name: "content_proposals_related_entries",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "related_entries_json")) {
        db.exec(
          "ALTER TABLE content_proposals ADD COLUMN related_entries_json TEXT NOT NULL DEFAULT '[]'",
        );
      }
    },
  },
  {
    version: 13,
    name: "content_proposals_review_context_snapshot",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "review_context_snapshot_json")) {
        db.exec(
          "ALTER TABLE content_proposals ADD COLUMN review_context_snapshot_json TEXT",
        );
      }
    },
  },
  {
    version: 14,
    name: "content_proposals_successor_links",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "supersedes_proposal_id")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN supersedes_proposal_id TEXT");
      }
      if (!tableHasColumn(db, "content_proposals", "replaced_by_proposal_id")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN replaced_by_proposal_id TEXT");
      }
    },
  },
  {
    version: 15,
    name: "content_proposals_escalated",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "escalated")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN escalated INTEGER NOT NULL DEFAULT 0");
      }
      if (!tableHasColumn(db, "content_proposals", "escalated_at")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN escalated_at INTEGER");
      }
      if (!tableHasColumn(db, "content_proposals", "escalated_by")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN escalated_by TEXT");
      }
      if (!tableHasColumn(db, "content_proposals", "escalated_note")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN escalated_note TEXT");
      }
    },
  },
  {
    version: 16,
    name: "content_proposals_decision_debug",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "decision_debug_json")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN decision_debug_json TEXT");
      }
    },
  },
  {
    version: 17,
    name: "content_proposals_review_situations",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "review_situations_json")) {
        db.exec(
          "ALTER TABLE content_proposals ADD COLUMN review_situations_json TEXT NOT NULL DEFAULT '[]'",
        );
      }
    },
  },
  {
    version: 18,
    name: "event_webhook_deliveries",
    up(db) {
      if (tableExists(db, "event_webhook_deliveries")) return;
      db.exec(`
        CREATE TABLE event_webhook_deliveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          site TEXT NOT NULL,
          event_type TEXT NOT NULL,
          hook_id TEXT NOT NULL,
          event_ids_json TEXT NOT NULL DEFAULT '[]',
          url_host TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          http_status INTEGER,
          error TEXT,
          duration_ms INTEGER,
          batch_size INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'live',
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_event_webhook_deliveries_site_created
          ON event_webhook_deliveries (site, created_at DESC);
        CREATE INDEX idx_event_webhook_deliveries_site_type_hook
          ON event_webhook_deliveries (site, event_type, hook_id, created_at DESC);
      `);
    },
  },
  {
    version: 19,
    name: "proposal_kpi_daily",
    up(db) {
      if (tableExists(db, "proposal_kpi_daily")) return;
      db.exec(`
        CREATE TABLE proposal_kpi_daily (
          site TEXT NOT NULL,
          day TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (site, day, kind, status)
        );
        CREATE INDEX idx_proposal_kpi_daily_site_day
          ON proposal_kpi_daily(site, day);
      `);
    },
  },
  {
    version: 20,
    name: "content_proposals_idea_followthrough",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "accepted_entry_json")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN accepted_entry_json TEXT");
      }
      if (!tableHasColumn(db, "content_proposals", "implements_proposal_id")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN implements_proposal_id TEXT");
      }
      if (!indexExists(db, "idx_content_proposals_implements")) {
        db.exec(
          `CREATE INDEX idx_content_proposals_implements
           ON content_proposals(site, implements_proposal_id)`,
        );
      }
    },
  },
  {
    version: 21,
    name: "content_proposal_blockers_actor",
    up(db) {
      if (!tableExists(db, "content_proposal_blockers")) return;
      if (!tableHasColumn(db, "content_proposal_blockers", "author_actor_json")) {
        db.exec("ALTER TABLE content_proposal_blockers ADD COLUMN author_actor_json TEXT");
      }
      if (!tableHasColumn(db, "content_proposal_blockers", "resolved_by_actor_json")) {
        db.exec("ALTER TABLE content_proposal_blockers ADD COLUMN resolved_by_actor_json TEXT");
      }
    },
  },
  {
    version: 22,
    name: "content_proposals_attention_stamps",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "author_content_at")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN author_content_at INTEGER");
      }
      if (!tableHasColumn(db, "content_proposals", "reviewer_action_at")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN reviewer_action_at INTEGER");
      }
    },
  },
  {
    version: 23,
    name: "content_proposals_idea_funnel",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "idea_funnel_json")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN idea_funnel_json TEXT");
      }
    },
  },
  {
    version: 24,
    name: "content_proposals_outcome_review",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      const columns: Array<[string, string]> = [
        ["outcome_review", "TEXT"],
        ["outcome_review_note", "TEXT"],
        ["outcome_review_expected", "TEXT"],
        ["outcome_review_at", "INTEGER"],
        ["outcome_review_by", "TEXT"],
        ["outcome_review_history_json", "TEXT NOT NULL DEFAULT '[]'"],
        ["outcome_lesson_captured_at", "INTEGER"],
        ["outcome_lesson_captured_by", "TEXT"],
        ["outcome_lesson_note", "TEXT"],
      ];
      for (const [name, type] of columns) {
        if (!tableHasColumn(db, "content_proposals", name)) {
          db.exec(`ALTER TABLE content_proposals ADD COLUMN ${name} ${type}`);
        }
      }
    },
  },
  {
    version: 25,
    name: "content_proposals_reviewer_action_by",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "reviewer_action_by")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN reviewer_action_by TEXT");
      }
      if (!tableHasColumn(db, "content_proposals", "reviewer_action_by_actor_json")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN reviewer_action_by_actor_json TEXT");
      }
      backfillReviewerActionBy(db);
    },
  },
  {
    version: 26,
    name: "content_proposals_draft_first_v1",
    up(db) {
      if (tableExists(db, "content_proposals")) {
        const proposalColumns: Array<[string, string]> = [
          ["system_version", "TEXT"],
          ["co_authors_json", "TEXT NOT NULL DEFAULT '[]'"],
          ["stale_since", "TEXT"],
          ["stale_flagged_at", "TEXT"],
          ["all_or_nothing", "INTEGER NOT NULL DEFAULT 0"],
          ["reverts_proposal_id", "TEXT"],
        ];
        for (const [name, type] of proposalColumns) {
          if (!tableHasColumn(db, "content_proposals", name)) {
            db.exec(`ALTER TABLE content_proposals ADD COLUMN ${name} ${type}`);
          }
        }
      }
      if (tableExists(db, "content_proposal_entries")) {
        const entryColumns: Array<[string, string]> = [
          ["created_draft", "INTEGER NOT NULL DEFAULT 0"],
          ["derived_ops_json", "TEXT"],
          ["derived_for_key", "TEXT"],
          ["published_diff_json", "TEXT"],
          ["pre_apply_snapshot_json", "TEXT"],
        ];
        for (const [name, type] of entryColumns) {
          if (!tableHasColumn(db, "content_proposal_entries", name)) {
            db.exec(`ALTER TABLE content_proposal_entries ADD COLUMN ${name} ${type}`);
          }
        }
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS draft_bases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content_type TEXT NOT NULL,
          slug TEXT NOT NULL,
          locale TEXT NOT NULL,
          variant TEXT NOT NULL,
          locale_hash TEXT,
          common_hash TEXT,
          snapshot_json TEXT,
          source_snapshot_json TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_bases_draft
          ON draft_bases (content_type, slug, locale, variant);
      `);
    },
  },
  {
    version: 27,
    name: "content_proposals_idea_seo_target",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      for (const name of ["idea_seo_target_json", "seo_target_override_json"]) {
        if (!tableHasColumn(db, "content_proposals", name)) {
          db.exec(`ALTER TABLE content_proposals ADD COLUMN ${name} TEXT`);
        }
      }
    },
  },
  {
    version: 28,
    name: "lead_submissions_and_consent_daily",
    up(db) {
      // No name / email / phone columns: personal data only goes to the CRM webhook.
      db.exec(`
        CREATE TABLE IF NOT EXISTS lead_submissions (
          submission_id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          form TEXT,
          browser_hash TEXT,
          host TEXT,
          locale TEXT,
          utm_source TEXT,
          utm_medium TEXT,
          utm_campaign TEXT,
          utm_content TEXT,
          utm_term TEXT,
          platform TEXT,
          campaign_id TEXT,
          adset_id TEXT,
          ad_id TEXT,
          click_id_type TEXT,
          landing_path TEXT,
          conversion_path TEXT,
          first_paid_host TEXT,
          first_paid_path TEXT,
          first_paid_at INTEGER,
          last_paid_host TEXT,
          last_paid_path TEXT,
          last_paid_at INTEGER,
          experiment_id TEXT,
          variant TEXT,
          is_test INTEGER NOT NULL DEFAULT 0,
          test_reason TEXT,
          is_repeat INTEGER NOT NULL DEFAULT 0,
          repeat_of TEXT,
          consent_state TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_lead_submissions_created ON lead_submissions (created_at);
        CREATE INDEX IF NOT EXISTS idx_lead_submissions_repeat
          ON lead_submissions (browser_hash, form, created_at);
        CREATE TABLE IF NOT EXISTS consent_daily (
          date TEXT NOT NULL,
          country TEXT NOT NULL,
          mode TEXT NOT NULL,
          shown INTEGER NOT NULL DEFAULT 0,
          granted_explicit INTEGER NOT NULL DEFAULT 0,
          granted_implied INTEGER NOT NULL DEFAULT 0,
          denied INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (date, country, mode)
        );
      `);
    },
  },
  {
    version: 29,
    name: "content_proposals_site_facts_check",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "site_facts_check_json")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN site_facts_check_json TEXT");
      }
    },
  },
  {
    version: 30,
    name: "lead_submissions_paid_landing_platform",
    up(db) {
      if (!tableExists(db, "lead_submissions")) return;
      for (const prefix of ["first_paid", "last_paid"]) {
        for (const field of ["platform", "campaign_id", "adset_id", "ad_id"]) {
          const name = `${prefix}_${field}`;
          if (!tableHasColumn(db, "lead_submissions", name)) {
            db.exec(`ALTER TABLE lead_submissions ADD COLUMN ${name} TEXT`);
          }
        }
      }
    },
  },
  {
    version: 31,
    name: "content_proposals_blocked_flagged_at",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "blocked_flagged_at")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN blocked_flagged_at TEXT");
      }
    },
  },
  {
    version: 32,
    name: "data_migration_runs",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS data_migration_runs (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          actor TEXT,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          exit_code INTEGER,
          output TEXT,
          note TEXT,
          file_sha TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_data_migration_runs_file
          ON data_migration_runs (filename, started_at);
      `);
    },
  },
  {
    version: 33,
    name: "lead_submissions_traffic_channel",
    up(db) {
      if (!tableExists(db, "lead_submissions")) return;
      for (const name of [
        "channel",
        "first_channel",
        "last_organic_channel",
        "channel_landing_path",
        "referrer_host",
        "country",
        "traffic_status",
      ]) {
        if (!tableHasColumn(db, "lead_submissions", name)) {
          db.exec(`ALTER TABLE lead_submissions ADD COLUMN ${name} TEXT`);
        }
      }
    },
  },
  {
    version: 34,
    name: "lead_submissions_channel_landing_index",
    up(db) {
      if (!tableHasColumn(db, "lead_submissions", "channel_landing_path")) return;
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_lead_submissions_channel_landing ON lead_submissions (channel_landing_path, created_at)",
      );
    },
  },
  {
    version: 35,
    name: "lead_submissions_product",
    up(db) {
      if (!tableExists(db, "lead_submissions")) return;
      for (const name of ["product_id", "product_slug"]) {
        if (!tableHasColumn(db, "lead_submissions", name)) {
          db.exec(`ALTER TABLE lead_submissions ADD COLUMN ${name} TEXT`);
        }
      }
    },
  },
  {
    version: 36,
    name: "lead_submissions_product_indexes",
    up(db) {
      if (!tableHasColumn(db, "lead_submissions", "product_id")) return;
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_lead_submissions_product_id ON lead_submissions (product_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_lead_submissions_product_slug ON lead_submissions (product_slug, created_at);
      `);
    },
  },
  {
    version: 37,
    name: "content_proposals_applies_after",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      for (const name of ["applies_after_proposal_id", "dependent_overdue_flagged_at"]) {
        if (!tableHasColumn(db, "content_proposals", name)) {
          db.exec(`ALTER TABLE content_proposals ADD COLUMN ${name} TEXT`);
        }
      }
    },
  },
  {
    version: 38,
    name: "content_proposals_applies_after_index",
    up(db) {
      if (!tableHasColumn(db, "content_proposals", "applies_after_proposal_id")) return;
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_content_proposals_applies_after ON content_proposals (applies_after_proposal_id)",
      );
    },
  },
  {
    version: 39,
    name: "content_proposals_url_slug_override",
    up(db) {
      if (!tableExists(db, "content_proposals")) return;
      if (!tableHasColumn(db, "content_proposals", "url_slug_override_json")) {
        db.exec("ALTER TABLE content_proposals ADD COLUMN url_slug_override_json TEXT");
      }
    },
  },
];

function parseActorJson(raw: string | null | undefined): AgentActorLike | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const type = (parsed as { type?: unknown }).type;
    if (type !== "ui" && type !== "mcp" && type !== "system") return null;
    return parsed as AgentActorLike;
  } catch {
    return null;
  }
}

/** Latest non-proposer blocker add/resolve per reviewed proposal (reopens were never attributed). */
function backfillReviewerActionBy(db: Database.Database): void {
  if (!tableExists(db, "content_proposal_blockers")) return;
  if (!tableHasColumn(db, "content_proposals", "reviewer_action_at")) return;
  if (!tableHasColumn(db, "content_proposals", "proposer_username")) return;
  const hasProposerActor = tableHasColumn(db, "content_proposals", "proposer_actor_json");
  const hasAuthorActor = tableHasColumn(db, "content_proposal_blockers", "author_actor_json");
  const hasResolvedActor = tableHasColumn(db, "content_proposal_blockers", "resolved_by_actor_json");

  const proposals = db
    .prepare(
      `SELECT id, proposer_username${hasProposerActor ? ", proposer_actor_json" : ""}
       FROM content_proposals
       WHERE reviewer_action_at IS NOT NULL AND reviewer_action_by IS NULL`,
    )
    .all() as Array<{ id: string; proposer_username: string; proposer_actor_json?: string | null }>;
  if (proposals.length === 0) return;

  const blockersStmt = db.prepare(
    `SELECT author, created_at, resolved_by, resolved_at
       ${hasAuthorActor ? ", author_actor_json" : ""}
       ${hasResolvedActor ? ", resolved_by_actor_json" : ""}
     FROM content_proposal_blockers
     WHERE proposal_id = ?`,
  );
  const update = db.prepare(
    `UPDATE content_proposals SET reviewer_action_by = ?, reviewer_action_by_actor_json = ? WHERE id = ?`,
  );

  const run = db.transaction(() => {
    for (const p of proposals) {
      const proposerActor = parseActorJson(p.proposer_actor_json);
      const rows = blockersStmt.all(p.id) as Array<{
        author: string;
        created_at: number;
        resolved_by: string | null;
        resolved_at: number | null;
        author_actor_json?: string | null;
        resolved_by_actor_json?: string | null;
      }>;
      let best: { at: number; username: string; actorJson: string | null } | null = null;
      const consider = (username: string | null, at: number | null, actorJson: string | null) => {
        if (!username?.trim() || at == null || !Number.isFinite(at)) return;
        if (sameAgentIdentity(p.proposer_username, proposerActor, username, parseActorJson(actorJson))) {
          return;
        }
        if (!best || at > best.at) best = { at, username, actorJson };
      };
      for (const b of rows) {
        consider(b.author, b.created_at, b.author_actor_json ?? null);
        consider(b.resolved_by, b.resolved_at, b.resolved_by_actor_json ?? null);
      }
      const picked = best as { at: number; username: string; actorJson: string | null } | null;
      if (picked) update.run(picked.username, picked.actorJson ?? "{}", p.id);
    }
  });
  run();
}

/** Conservative legacy baseline when pipeline_schema_version is missing. */
export function detectLegacyBaseline(db: Database.Database): number {
  if (!tableExists(db, "events")) return 0;

  const hasAttribution = tableHasColumn(db, "events", "attribution_json");
  const hasAuthor = tableHasColumn(db, "events", "author");
  const hasTriggers = tableHasColumn(db, "events", "triggered_by_event_id");
  const hasPipelineState = tableExists(db, "pipeline_state");
  const hasLeases = tableExists(db, "leases");
  const hasTriggerIndex = indexExists(db, "idx_events_triggered_by");
  const hasAgentSession = tableHasColumn(db, "events", "agent_session_id");
  const hasAgentSessionIndex = indexExists(db, "idx_events_agent_session");

  if (
    hasAgentSession &&
    hasAgentSessionIndex &&
    hasLeases &&
    hasPipelineState &&
    hasTriggers &&
    hasAttribution &&
    hasTriggerIndex
  ) {
    return 7;
  }
  if (hasLeases && hasPipelineState && hasTriggers && hasAttribution && hasTriggerIndex) {
    return 6;
  }
  if (hasPipelineState && hasTriggers && hasAttribution && hasTriggerIndex) return 5;
  if (hasTriggers && hasAttribution && hasTriggerIndex) return 4;
  if (hasTriggers && hasAttribution) return 3;
  if (hasAttribution || hasAuthor) return 1;
  return 1;
}
