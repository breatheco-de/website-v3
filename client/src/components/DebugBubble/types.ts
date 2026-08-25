
export type MenuView = "main" | "components" | "sitemap" | "versioning" | "menus" | "databases" | "content-types";

export const STORAGE_KEY = "debug-bubble-menu-view";
export const OPEN_STORAGE_KEY = "debug-bubble-open";
export const OPEN_DEBUG_BUBBLE_EVENT = "open-debug-bubble";

export interface SitemapUrl {
  loc: string;
  label: string;
  locale?: string;
  content_type?: string;
  slug?: string;
  /** When false, page exists but is excluded from /sitemap.xml. Missing treated as true. */
  inSitemap?: boolean;
  excludeReason?: string;
  /** Unpublished draft — preview URL only. */
  isDraft?: boolean;
}

export interface RedirectItem {
  from: string;
  to: string;
  type: string;
}

export interface VersioningVariant {
  slug: string;
  allocation: number;
}

export interface VersioningLocale {
  variants: VersioningVariant[];
}

export interface VersioningResponse {
  versioning: Record<string, VersioningLocale> | null;
  hasVersioningFile: boolean;
  filePath: string;
  availableLocales?: string[];
  detached?: boolean;
  isSharedLayout?: boolean;
  versioningSlug?: string;
  /** True when at least one live locale file exists */
  hasLiveDefault?: boolean;
  liveByLocale?: Record<string, boolean>;
  /** True when entry has no live locale (unpublished draft) */
  isDraft?: boolean;
}

export interface ContentInfo {
  type: string | null;
  slug: string | null;
  label: string;
}

export interface VariantInfo {
  filename: string;
  name: string;
  variantSlug: string;
  version: number | null;
  locale: string;
  displayName: string;
  isPromoted: boolean;
}

export interface VariantsResponse {
  variants: VariantInfo[];
  contentType: string;
  slug: string;
  folderPath: string;
}

export interface ComponentItem {
  type: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

export interface TagInputProps {
  tags: string[];
  setTags: (tags: string[]) => void;
  placeholder: string;
  suggestions?: string[];
  testId: string;
  transform?: (value: string) => string;
}

export interface TargetingStepProps {
  targetRegions: string[];
  setTargetRegions: (v: string[]) => void;
  targetDevices: string[];
  setTargetDevices: (v: string[]) => void;
  targetLocations: string[];
  setTargetLocations: (v: string[]) => void;
  targetUtmSources: string[];
  setTargetUtmSources: (v: string[]) => void;
  targetUtmCampaigns: string[];
  setTargetUtmCampaigns: (v: string[]) => void;
  targetUtmMediums: string[];
  setTargetUtmMediums: (v: string[]) => void;
  targetCountries: string[];
  setTargetCountries: (v: string[]) => void;
}

export interface GitHubSyncStatus {
  configured: boolean;
  syncEnabled: boolean;
  autoCommitEnabled?: boolean;
  autoPullEnabled?: boolean;
  localCommit: string | null;
  remoteCommit: string | null;
  status: 'in-sync' | 'behind' | 'ahead' | 'diverged' | 'unknown' | 'not-configured' | 'invalid-credentials' | 'rate-limited';
  behindBy?: number;
  aheadBy?: number;
  repoUrl?: string;
  branch?: string;
  /** Human-readable detail when status is unknown / rate-limited / invalid-credentials. */
  error?: string;
}

export interface PendingChange {
  file: string;
  status: 'modified' | 'added' | 'deleted';
  source: 'local' | 'incoming' | 'conflict';
  contentType: string;
  slug: string;
  author?: string;
  date?: string;
  commitSha?: string;
}

export interface AutoCommitStatus {
  enabled: boolean;
  pendingFiles: number;
  pendingFilesList: string[];
  pendingFilesDetails: Array<{ filePath: string; author: string; timestamp: number }>;
  lastCommitAt: string | null;
  lastCommitSha: string | null;
  lastError: string | null;
  conflictedFiles: string[];
  commitIntervalSeconds: number;
  nextSyncAt: number | null;
  isCommitting: boolean;
  githubConfigured: boolean;
  autoCommitEligibleFiles: string[];
}

export interface MenuFileItem {
  name: string;
  file: string;
}

export interface MenuData {
  navbar?: {
    items?: Array<{
      label: string;
      href: string;
      component: string;
      dropdown?: unknown;
    }>;
  };
  footer?: {
    columns?: Array<{
      title: string;
      items?: Array<{ label: string; href: string }>;
    }>;
  };
}

export interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  href?: string;
  testId: string;
  rightContent?: React.ReactNode;
  indicator?: "chevron" | "arrow" | "none";
  disabled?: boolean;
  className?: string;
  infoTooltip?: string;
}

export interface ExpandableMenuItemProps {
  icon: LucideIcon;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  testId: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export interface CachedValidationEntry {
  lastRunAt: string;
  errors: Array<{ type: "error" | "warning"; code: string; message: string; file?: string; line?: number; suggestion?: string }>;
  warnings: Array<{ type: "error" | "warning"; code: string; message: string; file?: string; line?: number; suggestion?: string }>;
}

export interface PageDiagnostics {
  url: string;
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
  allocation?: number;
  entryKey?: string;
  filePath: string;
  title: string;
  dirty?: boolean;
  validationSkippedReason?: "unpublished_variant" | string;
  schemaValidation: {
    valid: boolean;
    errors: Array<{ path: string; code: string; message: string; expected?: string; received?: string }>;
  };
  issues: Array<{
    id?: string;
    type: "error" | "warning" | "info";
    code: string;
    message: string;
    category?: string;
    suggestion?: string;
    validator?: string;
    file?: string;
    details?: { path?: string; expected?: string; received?: string };
    validationCacheBuiltAt?: string;
    completed?: { by: string; at: string; actor?: { type: "ui" | "mcp"; client?: string; model?: string } } | null;
    claimed?: {
      by: string;
      at: string;
      expiresAt: string;
      actor?: { type: "ui" | "mcp"; client?: string; model?: string };
    } | null;
  }>;
  /** @deprecated Removed — use issue counts from the shared store. */
  score?: { total: number; seo: number; schema: number; content: number };
  cached?: CachedValidationEntry | null;
  education?: {
    summary: string;
    details?: string;
    advanced_paths?: string[];
  };
}

export interface SeoData {
  meta: Record<string, unknown>;
  faqSchema: Record<string, unknown> | null;
  schemaOrg: Record<string, unknown>[];
  title: string;
}

export interface SeoMeta {
  page_title: string;
  description: string;
  og_image: string;
  canonical_url: string;
  robots: string;
  priority: string;
  change_frequency: string;
  redirects: string[];
}

export interface SeoLocation {
  slug: string;
  name: string;
  city: string;
  country: string;
}

export type SlugCheckStatus = 'idle' | 'checking' | 'available' | 'taken';
export type ContentTypeValue = string;
import { LucideIcon } from "lucide-react";
