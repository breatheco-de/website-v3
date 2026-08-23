/**
 * Validation Framework Types
 * 
 * Core interfaces for the modular validation system.
 * Used by both CLI and API.
 */

import type { ValidationScope, ValidatorRunClass } from "./runClass";
import type { ContentIndex } from "../../../server/content-index";

export type { ValidationScope, ValidatorRunClass } from "./runClass";

export interface FixHint {
  type: "api" | "script" | "llm" | "manual";
  label: string;
  fixerName?: string;
  command?: string;
  promptTemplate?: string;
  url?: string;
}

export interface ValidationIssue {
  type: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
  fix?: FixHint;
  category?: ValidatorMetadata["category"];
  /** Validator name that produced this issue (for partial cache merges). */
  validator?: string;
  /** When the validation cache / run that produced this issue was built (ISO). */
  validationCacheBuiltAt?: string;
}

export interface ValidatorResult {
  name: string;
  description: string;
  status: "passed" | "failed" | "warning";
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  duration: number;
  category?: ValidatorMetadata["category"];
  artifacts?: Record<string, unknown>;
}

export interface ValidatorMetadata {
  name: string;
  description: string;
  apiExposed: boolean;
  estimatedDuration: "fast" | "medium" | "slow";
  category: "content" | "seo" | "integrity" | "components" | "performance" | "forms" | "bindings";
  /** Execution / clear-scope class. Defaults via runClass.ts map when omitted. */
  runClass?: ValidatorRunClass;
}

export interface Validator extends ValidatorMetadata {
  run(context: ValidationContext): Promise<ValidatorResult>;
}

export type IssueTarget =
  | {
      type: "entry";
      entryKey: string;
      url?: string;
      file?: string;
      slug?: string;
      contentType?: string;
    }
  | { type: "redirect"; from: string }
  | { type: "media"; imageId: string }
  | { type: "database"; dbSlug: string }
  | { type: "file"; path: string };

export interface StoredValidationIssue {
  id: string;
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  suggestion?: string;
  validator: string;
  scopes: ValidationScope[];
  targets: IssueTarget[];
  file?: string;
  line?: number;
  category?: ValidatorMetadata["category"];
  lastSeenAt: string;
  lastRunAt: string;
}

/** Soft-complete overlay — keyed by StoredValidationIssue.id; not part of the issue row. */
export interface ValidationIssueActor {
  type: "ui" | "mcp";
  /** MCP OAuth client name (e.g. Cursor) — server-derived only. */
  client?: string;
  /** Best-effort model name when reported by MCP agent. */
  model?: string;
}

export interface ValidationIssueCompletion {
  completedBy: string;
  completedAt: string;
  actor?: ValidationIssueActor;
}

/** In-progress claim overlay — keyed by StoredValidationIssue.id; TTL-based. */
export interface ValidationIssueClaim {
  claimedBy: string;
  claimedAt: string;
  expiresAt: string;
  actor?: ValidationIssueActor;
}

export interface EntryRunMeta {
  lastRunAt: string;
  byValidator: Record<string, string>;
  dirty?: boolean;
}

export interface ScopeRunMeta {
  lastRunAt: string;
  byValidator: Record<string, string>;
  dirty?: boolean;
}

export interface ValidationCacheIndexes {
  byEntry: Record<string, string[]>;
  byScope: Partial<Record<ValidationScope, string[]>>;
  byMedia: Record<string, string[]>;
  byDatabase: Record<string, string[]>;
  byRedirect: Record<string, string[]>;
  /** Secondary: public URL → entryKey */
  byUrl: Record<string, string>;
}

export interface ValidationCacheFileV5 {
  meta: {
    version: 5;
    lastFullRunAt: string | null;
    lastSiteWideRunAt: string | null;
  };
  issues: Record<string, StoredValidationIssue>;
  indexes: ValidationCacheIndexes;
  runMeta: {
    byEntry: Record<string, EntryRunMeta>;
    byScope: Partial<Record<ValidationScope, ScopeRunMeta>>;
  };
  /**
   * Soft-complete map: issue id → who/when. Cleared when the same id is rewritten
   * or removed by a validator cache write. Does not delete the issue row.
   */
  completions?: Record<string, ValidationIssueCompletion>;
  /**
   * In-progress claims: issue id → who/when/expiry. Survives issue-id rewrite;
   * cleared on release, TTL expiry, complete, or when the issue id is removed.
   */
  claims?: Record<string, ValidationIssueClaim>;
  /** @deprecated Compat projection rebuilt from issues; prefer issues + indexes. */
  pages?: Record<string, PageCacheEntry>;
  databases?: Record<string, DatabaseCacheEntry>;
}

export interface ContentMeta {
  page_title?: string;
  description?: string;
  robots?: string;
  og_image?: string;
  canonical_url?: string;
  priority?: number;
  change_frequency?: string;
  redirects?: string[];
}

export interface SchemaRef {
  include?: string[];
  overrides?: Record<string, Record<string, unknown>>;
}

export interface ContentSeo {
  intent?: string;
  pillar?: string;
  pillar_path?: string | null;
  is_pillar?: boolean;
  main_keyword?: string | null;
  focus_features?: string[];
}

export interface ContentFile {
  slug: string;
  title: string;
  /** Entry-level description when present on merged content. */
  description?: string;
  meta?: ContentMeta;
  schema?: SchemaRef;
  seo?: ContentSeo;
  type: string;
  locale: string;
  filePath: string;
  /** Resolved public path including url_pattern params (e.g. :category). */
  url?: string;
  variant?: string;
  /** Unpublished entry (no live locale files). Variant overlays of live pages are not drafts. */
  isDraft?: boolean;
  version?: number;
  /** Merged entry bag for required-field checks (subset of YAML). */
  entryFields?: Record<string, unknown>;
}

export interface RedirectEntry {
  from: string;
  to: string | Record<string, string>;
  source: ContentFile;
}

export interface SitemapEntry {
  loc: string;
  type: string;
  slug?: string;
  locale?: string;
}

export interface ValidationContext {
  /** Site-scoped content index (diagnostics worker / multi-site). */
  contentIndex?: ContentIndex;
  contentFiles: ContentFile[];
  redirectMap: Map<string, RedirectEntry>;
  validUrls: Set<string>;
  availableSchemas: Set<string>;
  sitemapEntries: SitemapEntry[];
  sitemapXml?: string;
  /** Active site's content root (absolute path). Populated by the API route from
   *  res.locals.site when a per-site override is active (dev or multi-site prod).
   *  Validators that read content-folder files (e.g. custom-redirects.yml,
   *  schema-org.yml) must use this instead of hardcoded folder names. */
  contentRoot?: string;
  scope?: { database?: string };
}

export interface ValidationRunOptions {
  validators?: string[];
  mode?: "strict" | "fast";
  output?: "detailed" | "summary";
  includeArtifacts?: boolean;
  includeSlow?: boolean;
  scope?: { database?: string };
}

export interface ValidationRunResult {
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    duration: number;
  };
  validators: ValidatorResult[];
}

export interface PageCacheEntry {
  /** Latest of lastFullRunAt / lastPartialRunAt (backward compatible). */
  lastRunAt: string;
  /** Set only by full-validator page jobs; drives stale-only freshness. */
  lastFullRunAt?: string;
  /** Set by partial (single-validator) merges; does not satisfy full-run freshness. */
  lastPartialRunAt?: string;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface DatabaseCacheEntry {
  lastRunAt: string;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** @deprecated v4 on-disk shape — migrated to ValidationCacheFileV5 on load. */
export interface ValidationCacheFileV4 {
  meta: {
    lastFullRunAt: string | null;
    version: number;
  };
  pages: Record<string, PageCacheEntry>;
  databases?: Record<string, DatabaseCacheEntry>;
}

export type ValidationCacheFile = ValidationCacheFileV5 | ValidationCacheFileV4;
