import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, Asterisk, Check, CircleDashed, Clipboard, Clock, Code, Columns3, Copy, Database, Download, ExternalLink, Eye, EyeOff, FileText, Folder, GitBranch, Globe, HelpCircle, History, Image as ImageIcon, Info, LayoutList, Link as LinkIcon, List, Loader2, MoreVertical, Pencil, Plus, RefreshCw, Search, Shuffle, SlidersHorizontal, Table2, Trash2, Wand2, X } from "lucide-react";
import { IconChess, IconChevronDown, IconChevronRight, IconExternalLink } from "@tabler/icons-react";
import { queryClient } from "@/lib/queryClient";
import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import {
  EntryPreviewCard,
  EntryPreviewConfigDialog,
  type ContentTypePreviewConfig,
  type EntryPreviewFailure,
} from "@/components/EntryPreviewAdmin";
import { ContentUpdateTimeline } from "@/components/content/ContentUpdateTimeline";
import { buildContentUpdateTimelineItems } from "@/components/content/buildContentUpdateTimelineItems";
import { Link, useRoute, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import { DeletePageModal } from "@/components/DebugBubble/components/DeletePageModal";
import { CreateContentModal } from "@/components/DebugBubble/components/CreateContentModal";
import type { SitemapUrl } from "@/components/DebugBubble/types";
import { ManagedSeoModal, type ManagedSeoModalTarget } from "@/components/editing/ManagedSeoModal";
import {
  SeoContextPickerDialog,
  resolveSeoContexts,
  type SeoContextChoice,
} from "@/components/editing/SeoContextPickerDialog";
import type { SeoModalTab } from "@/components/DebugBubble/components/SeoModal";
import { SharedLayoutExplainDialog } from "@/components/editing/SharedLayoutExplainDialog";
import {
  SharedLayoutEnableDialog,
  type SharedLayoutEnablePayload,
  SharedLayoutEnableFields,
} from "@/components/editing/SharedLayoutEnableDialog";
import { LinkedDatabaseExplainDialog } from "@/components/editing/LinkedDatabaseExplainDialog";
import { ItemEditModal } from "@/components/databases/ItemEditModal";
import { EditorTypeDialog, type EditorHint } from "@/components/editing/EditorTypeDialog";
import { isValidFillIntent } from "@shared/fillIntent";
import { isValidContentTypeStrategy } from "@shared/contentTypeStrategy";
import { WebhookUrlPopover } from "@/components/WebhookUrlPopover";
import { getMetaIssues } from "@/lib/metaIssues";
import { isUsableOgImageUrl } from "@shared/ogImageUrl";
import { isLocaleIndexField, stripLocaleIndexFields } from "@shared/locale";

const RawFileEditorPanel = lazy(() => import("@/components/editing/RawFileEditorPanel"));

const MANAGE_LIST_PAGE_SIZE = 50;

interface ItemsResponse {
  count: number;
  results: Record<string, any>[];
  facets?: Record<string, string[]>;
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

interface CacheStatus {
  exists: boolean;
  age_hours: number | null;
  post_count: number | null;
}

interface StaticEntry {
  slug: string;
  title: string;
  locales: string[];
  urls: Record<string, string>;
  versionCounts?: Record<string, number>;
  updated_at?: string | null;
  status?: "draft" | "published";
  draftVariant?: string;
  previewPath?: string;
}

interface SeoEntry {
  slug: string | null;
  contentType: string;
  locale: string | null;
  url: string | null;
  title: string | null;
  meta: Record<string, unknown>;
  schema?: Record<string, unknown> | null;
  parse_error?: string;
}

interface SeoEntriesResponse {
  contentType: string;
  source: string;
  count: number;
  entries: SeoEntry[];
  cache_missing?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

interface StaticEntriesResponse {
  count: number;
  results: StaticEntry[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

interface FieldMapping {
  [standardField: string]: string | null;
}

interface DatabaseConfig {
  slug: string;
}

interface ContentTypeConfig {
  name: string;
  label: string;
  directory: string;
  field_mapping?: Record<string, string | { source: string; default: string | null }>;
  editor?: Record<string, {
    type?: string;
    options?: (string | { value: string; label: string })[];
    populate_options?: boolean;
    allow_custom_values?: boolean;
    split_comma_values?: boolean;
    cache_images?: boolean;
    description?: string;
    required?: boolean | "attached";
    fill_intent?: { goal: string; purpose: string; constraints?: string[] };
    schema?: Record<string, unknown>;
  }>;
  indexes?: string[];
  unique_fields?: string[];
  database: DatabaseConfig | null;
  url_pattern: Record<string, string>;
  single_template?: boolean;
  static_entry_count?: number;
  preview?: ContentTypePreviewConfig | null;
  schema_org_requirements?: Array<{ schema_type: string }>;
  seo_monitoring?: { enabled?: boolean; require_cluster?: boolean } | null;
  strategy?: { purpose: string; constraints?: string[] } | null;
}

interface SchemaOrgCoverageRow {
  contentType: string;
  schema_type: string;
  present: number;
  total: number;
  missing_slugs: string[];
  present_slugs: string[];
}

interface SchemaOrgCoverageResponse {
  contentType: string;
  requirements: Array<{ schema_type: string }>;
  coverage: SchemaOrgCoverageRow[];
  message?: string;
}

interface DatabaseListItem {
  name: string;
  label: string;
  description: string | null;
  source_type: string;
}

interface LocaleEntry {
  code: string;
  label: string;
}

interface LocaleSettings {
  default_locale: string;
  supported_locales: LocaleEntry[];
}

function detectPatternMode(urlPattern: Record<string, string>): {
  mode: "non-localized" | "shorthand" | "per-locale";
  nonLocalizedPattern: string;
  shorthandPattern: string;
  localePatterns: { locale: string; path: string }[];
} {
  const keys = Object.keys(urlPattern);

  if (keys.length === 1 && keys[0] === "default") {
    return {
      mode: "non-localized",
      nonLocalizedPattern: urlPattern.default,
      shorthandPattern: "",
      localePatterns: [],
    };
  }

  const localeKeys = keys.filter(k => k !== "default");
  if (localeKeys.length > 0) {
    const suffixes = localeKeys.map(locale => {
      const val = urlPattern[locale];
      const prefix = `/${locale}`;
      return val.startsWith(prefix) ? val.slice(prefix.length) : null;
    });
    const allValid = suffixes.every(s => s !== null);
    const allSame = allValid && suffixes.every(s => s === suffixes[0]);

    if (allSame && suffixes[0] !== null) {
      return {
        mode: "shorthand",
        nonLocalizedPattern: "",
        shorthandPattern: suffixes[0] as string,
        localePatterns: localeKeys.map((locale, i) => ({ locale, path: suffixes[i] as string })),
      };
    }

    return {
      mode: "per-locale",
      nonLocalizedPattern: "",
      shorthandPattern: "",
      localePatterns: localeKeys.map(locale => {
        const val = urlPattern[locale];
        const prefix = `/${locale}`;
        return { locale, path: val.startsWith(prefix) ? val.slice(prefix.length) : val };
      }),
    };
  }

  return { mode: "shorthand", nonLocalizedPattern: "", shorthandPattern: "", localePatterns: [] };
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

type UpdatedSortDir = "asc" | "desc" | null;

function updatedAtSortMs(value: unknown): number {
  if (value == null || value === "") return Number.NaN;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? Number.NaN : ms;
}

function sortByUpdatedAt<T>(
  list: T[],
  dir: UpdatedSortDir,
  getValue: (item: T) => unknown,
): T[] {
  if (!dir) return list;
  const factor = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const am = updatedAtSortMs(getValue(a));
    const bm = updatedAtSortMs(getValue(b));
    const aMissing = Number.isNaN(am);
    const bMissing = Number.isNaN(bm);
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    return (am - bm) * factor;
  });
}

function UpdatedAtSortHeader({
  dir,
  onToggle,
  className,
}: {
  dir: UpdatedSortDir;
  onToggle: () => void;
  className?: string;
}) {
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <th className={className ?? "text-left px-4 py-3 font-medium text-muted-foreground"}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-sm"
        onClick={onToggle}
        data-testid="button-sort-updated-at"
        title="Sort by Updated"
      >
        Updated
        <Icon className="h-3.5 w-3.5" />
      </button>
    </th>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label =
    formatFieldValue(status) || (typeof status === "string" ? status : "");
  const normalized = label.toLowerCase() || "unknown";
  if (normalized === "published") {
    return <Badge variant="default" data-testid="badge-status-published"><Check className="h-3 w-3 mr-1" />Published</Badge>;
  }
  if (normalized === "draft") {
    return <Badge variant="secondary" data-testid="badge-status-draft"><Clock className="h-3 w-3 mr-1" />Draft</Badge>;
  }
  return <Badge variant="outline" data-testid={`badge-status-${normalized}`}>{label || "Unknown"}</Badge>;
}

function VisibilityIcon({ visibility }: { visibility: string }) {
  if (visibility?.toLowerCase() === "public") {
    return <Eye className="h-4 w-4 text-muted-foreground" />;
  }
  return <EyeOff className="h-4 w-4 text-muted-foreground" />;
}

function SearchableFieldSelect({
  value,
  onValueChange,
  dbFields,
  rawFields,
  placeholder,
  testId,
}: {
  value: string;
  onValueChange: (v: string) => void;
  dbFields: string[];
  rawFields: string[];
  placeholder?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const q = searchQuery.toLowerCase();
  const filteredDb = q ? dbFields.filter((f) => f.toLowerCase().includes(q)) : dbFields;
  const filteredRaw = q ? rawFields.filter((f) => f.toLowerCase().includes(q)) : rawFields;

  const displayValue = value === "__none__" || !value ? (placeholder || "(not mapped)") : value;

  return (
    <div className="relative flex-1" ref={containerRef}>
      <button
        type="button"
        className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-xs font-mono ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        onClick={() => { setOpen(!open); setSearchQuery(""); }}
        data-testid={testId}
      >
        <span className={!value || value === "__none__" ? "text-muted-foreground" : ""}>
          {displayValue}
        </span>
        <Search className="h-3 w-3 text-muted-foreground ml-1 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute z-[10002] top-full left-0 mt-1 w-full min-w-[240px] max-h-64 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="p-1.5 border-b">
            <Input
              ref={inputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search fields..."
              className="h-7 text-xs"
              data-testid={testId ? `${testId}-search` : undefined}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
          <div className="overflow-y-auto max-h-48">
            <div
              className="px-2 py-1.5 text-xs cursor-pointer hover:bg-muted rounded-sm mx-1 my-0.5 text-muted-foreground"
              onClick={() => { onValueChange("__none__"); setOpen(false); }}
            >
              (not mapped)
            </div>
            {filteredDb.length > 0 && (
              <>
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Database Fields
                </div>
                {filteredDb.map((f) => (
                  <div
                    key={`db-${f}`}
                    className={`px-2 py-1.5 text-xs font-mono cursor-pointer hover:bg-muted rounded-sm mx-1 my-0.5 flex items-center gap-1.5 ${value === f || value === `db.${f}` ? "bg-muted font-medium" : ""}`}
                    onClick={() => { onValueChange(f); setOpen(false); }}
                  >
                    {(value === f || value === `db.${f}`) && <Check className="h-3 w-3 flex-shrink-0" />}
                    {f}
                  </div>
                ))}
              </>
            )}
            {filteredRaw.length > 0 && (
              <>
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-1 border-t pt-1.5">
                  Raw API Fields
                </div>
                {filteredRaw.map((f) => (
                  <div
                    key={`raw-${f}`}
                    className={`px-2 py-1.5 text-xs font-mono cursor-pointer hover:bg-muted rounded-sm mx-1 my-0.5 flex items-center gap-1.5 ${value === `raw.${f}` ? "bg-muted font-medium" : ""}`}
                    onClick={() => { onValueChange(`raw.${f}`); setOpen(false); }}
                  >
                    {value === `raw.${f}` && <Check className="h-3 w-3 flex-shrink-0" />}
                    <span className="text-muted-foreground">raw.</span>{f}
                  </div>
                ))}
              </>
            )}
            {filteredDb.length === 0 && filteredRaw.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                No fields match "{searchQuery}"
              </div>
            )}
            <div className="border-t mx-1 mt-1 pt-0.5 mb-0.5">
              <div
                className="px-2 py-1.5 text-xs cursor-pointer hover:bg-muted rounded-sm text-muted-foreground"
                onClick={() => { onValueChange("__custom__"); setOpen(false); }}
              >
                Custom path...
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const WIZARD_STEPS = [
  { id: "database", label: "Database", icon: Database },
  { id: "preview", label: "Inspect", icon: Eye },
  { id: "identity", label: "Identity", icon: LinkIcon },
  { id: "mapping", label: "Mapping", icon: LayoutList },
  { id: "indexes", label: "Indexes", icon: FileText },
] as const;

type WizardStep = typeof WIZARD_STEPS[number]["id"];


function StepIndicator({ steps, currentStep, completedSteps }: {
  steps: typeof WIZARD_STEPS;
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;
}) {
  const currentIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <div className="flex items-center gap-1 px-1" data-testid="wizard-step-indicator">
      {steps.map((step, i) => {
        const isActive = step.id === currentStep;
        const isCompleted = completedSteps.has(step.id);
        const isPast = i < currentIndex;
        const StepIcon = step.icon;

        return (
          <div key={step.id} className="flex items-center gap-1 flex-1">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <div
                className={`flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isCompleted || isPast
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                }`}
                data-testid={`step-indicator-${step.id}`}
              >
                {isCompleted || isPast ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <StepIcon className="h-3.5 w-3.5" />
                )}
              </div>
              <span
                className={`text-xs truncate ${
                  isActive ? "text-foreground font-medium" : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`h-px flex-shrink-0 w-4 ${
                  isPast || isCompleted ? "bg-primary/40" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SampleDataDialog({
  open,
  onOpenChange,
  sampleItems,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleItems: Record<string, unknown>[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Sample Data ({sampleItems.length} item{sampleItems.length !== 1 ? "s" : ""})</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto rounded-md bg-muted p-3">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all" data-testid="text-sample-json">
            {JSON.stringify(sampleItems, null, 2)}
          </pre>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-sample">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClearCacheConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  contentTypeLabel,
  clearing,
  cacheAgeHours,
  postCount,
  databaseSlug,
  hasDatabase,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  contentTypeLabel: string;
  clearing: boolean;
  cacheAgeHours: number | null;
  postCount: number | null;
  databaseSlug: string | null;
  hasDatabase: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]" data-testid="dialog-clear-cache-confirm">
        <DialogHeader>
          <DialogTitle>Clear {contentTypeLabel} cache</DialogTitle>
          <DialogDescription>
            {hasDatabase
              ? "Force-refresh the linked database snapshot and clear cached markdown bodies."
              : "This content type is static-only — there is no database cache to clear."}
          </DialogDescription>
        </DialogHeader>
        {hasDatabase ? (
          <div className="space-y-4 text-sm text-muted-foreground">
            <p>
              This does not delete content, YAML folders, or database configuration. It only
              refreshes locally cached data so the next loads use fresh source data.
            </p>
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
              <p className="font-medium text-foreground">What will be cleared</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  The local database item cache
                  {databaseSlug ? (
                    <>
                      {" "}for <code className="text-[11px]">{databaseSlug}</code>
                    </>
                  ) : null}
                  {postCount != null ? ` (${postCount} cached entries)` : ""}
                  {cacheAgeHours != null ? ` — currently ~${cacheAgeHours}h old` : ""}
                </li>
                <li>
                  In-memory markdown/readme cache used when rendering database-backed article bodies
                </li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">What happens next</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Entries are re-fetched from the database source (API / remote / local)</li>
                <li>The admin list and live pages will use the new snapshot</li>
                <li>The first few page loads may be slightly slower while caches rebuild</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm text-muted-foreground">
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
              <p className="font-medium text-foreground">Nothing to clear</p>
              <p>
                Static content types read YAML from disk. Clear Cache only applies when a
                database is attached — that is what builds the local item cache and markdown
                body cache this action refreshes.
              </p>
            </div>
            <p>
              To use Clear Cache here, connect a database first via{" "}
              <span className="text-foreground">Add Connection</span>.
            </p>
          </div>
        )}
        <DialogFooter>
          {hasDatabase ? (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={clearing}
                data-testid="button-cancel-clear-cache"
              >
                Cancel
              </Button>
              <Button
                onClick={onConfirm}
                disabled={clearing}
                data-testid="button-confirm-clear-cache"
              >
                {clearing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Clearing…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Clear cache
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button
              onClick={() => onOpenChange(false)}
              data-testid="button-close-clear-cache"
            >
              Got it
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const REQUIRED_FIELD_SKIP_CONFIRM_KEY = "ct-required-field-skip-confirm";

type RequiredMode = false | true | "attached";

function readSkipRequiredConfirm(): boolean {
  try {
    return localStorage.getItem(REQUIRED_FIELD_SKIP_CONFIRM_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSkipRequiredConfirm(skip: boolean) {
  try {
    if (skip) localStorage.setItem(REQUIRED_FIELD_SKIP_CONFIRM_KEY, "1");
    else localStorage.removeItem(REQUIRED_FIELD_SKIP_CONFIRM_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

function normalizeRequiredMode(value: EditorHint["required"]): RequiredMode {
  if (value === true || value === "attached") return value;
  return false;
}

function nextRequiredMode(current: RequiredMode, allowAttachedMode: boolean): RequiredMode {
  if (allowAttachedMode) {
    if (current === false) return "attached";
    if (current === "attached") return true;
    return false;
  }
  return current === false ? true : false;
}

function RequiredFieldConfirmDialog({
  open,
  onOpenChange,
  onSelect,
  fieldName,
  currentRequired,
  allowAttachedMode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (next: RequiredMode, neverAskAgain: boolean) => void;
  fieldName: string | null;
  currentRequired: RequiredMode;
  /** Show "Required when attached" only for shared-layout content types. */
  allowAttachedMode: boolean;
}) {
  const [neverAskAgain, setNeverAskAgain] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!open) {
      setNeverAskAgain(false);
      setShowAdvanced(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]" data-testid="dialog-required-field-confirm">
        <DialogHeader>
          <DialogTitle>Required for publish</DialogTitle>
          <DialogDescription>
            {fieldName ? (
              <>
                Field{" "}
                <code className="font-mono text-foreground text-xs">{fieldName}</code>
                {currentRequired === true
                  ? allowAttachedMode
                    ? " — currently required always (even detached)"
                    : " — currently required always"
                  : currentRequired === "attached"
                    ? " — currently required only on template (attached)"
                    : " — currently never required"}
              </>
            ) : (
              "Choose how this field is required"
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-xs text-muted-foreground" data-testid="fields-required-education">
          <p>
            This sets whether the field must be filled before an entry can go live. Drafts can stay empty
            either way; once live, a required field cannot be cleared until you turn the requirement off.
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
            data-testid="button-toggle-required-field-education"
          >
            {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
            <IconChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
          </button>
          {showAdvanced ? (
            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
              <p>
                Turning a field required also needs a type Strategy (purpose) and{" "}
                <code className="font-mono text-[10px]">fill_intent</code> on the field — you will be asked
                if those are missing. Live SEO still separately needs{" "}
                <code className="font-mono bg-muted px-1 rounded">meta.page_title</code> and{" "}
                <code className="font-mono bg-muted px-1 rounded">meta.description</code>.
              </p>
              <p className="text-muted-foreground">
                Paths:{" "}
                <code className="font-mono text-[10px]">shared/fillIntent.ts</code>,{" "}
                <code className="font-mono text-[10px]">shared/contentTypeStrategy.ts</code>,{" "}
                <code className="font-mono text-[10px]">shared/validateRequiredFields.ts</code>,{" "}
                <code className="font-mono text-[10px]">server/live-entry-seo-gate.ts</code>
              </p>
            </div>
          ) : null}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <div
            className="flex w-full rounded-md border overflow-hidden"
            role="group"
            aria-label="Required mode"
            data-testid="required-mode-toggle"
          >
            <button
              type="button"
              onClick={() => onSelect(false, neverAskAgain)}
              data-testid="button-required-mode-none"
              aria-pressed={currentRequired === false}
              className={`flex-1 min-w-0 flex flex-col items-start gap-1 px-2.5 py-2.5 text-left transition-colors ${
                currentRequired === false
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground hover-elevate"
              }`}
            >
              <span className="inline-flex items-center gap-1.5 text-xs">
                <span className="inline-flex shrink-0 opacity-50" aria-hidden>
                  <Asterisk className="h-3.5 w-3.5" />
                </span>
                Never required
              </span>
              <span
                className={`text-[10px] font-normal leading-snug ${
                  currentRequired === false ? "text-primary/70" : "text-muted-foreground/80"
                }`}
              >
                Drafts and live may leave this empty.
              </span>
            </button>
            {allowAttachedMode ? (
              <button
                type="button"
                onClick={() => onSelect("attached", neverAskAgain)}
                data-testid="button-required-mode-attached"
                aria-pressed={currentRequired === "attached"}
                className={`flex-1 min-w-0 flex flex-col items-start gap-1 border-l px-2.5 py-2.5 text-left transition-colors ${
                  currentRequired === "attached"
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted-foreground hover-elevate"
                }`}
              >
                <span className="inline-flex items-center gap-1.5 text-xs">
                  <span className="inline-flex shrink-0" aria-hidden>
                    <Asterisk className="h-3.5 w-3.5" />
                  </span>
                  Required only on template (attached)
                </span>
                <span
                  className={`text-[10px] font-normal leading-snug ${
                    currentRequired === "attached" ? "text-primary/70" : "text-muted-foreground/80"
                  }`}
                >
                  Needed to publish on the shared template; skipped when detached.
                </span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onSelect(true, neverAskAgain)}
              data-testid="button-required-mode-always"
              aria-pressed={currentRequired === true}
              className={`flex-1 min-w-0 flex flex-col items-start gap-1 border-l px-2.5 py-2.5 text-left transition-colors ${
                currentRequired === true
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground hover-elevate"
              }`}
            >
              <span className="inline-flex items-center gap-1.5 text-xs">
                <span className="inline-flex shrink-0 items-center" aria-hidden>
                  <Asterisk className="h-3.5 w-3.5" />
                  <Asterisk className="h-3.5 w-3.5 -ml-2" />
                </span>
                {allowAttachedMode ? "Required always (even detached)" : "Required always"}
              </span>
              <span
                className={`text-[10px] font-normal leading-snug ${
                  currentRequired === true ? "text-primary/70" : "text-muted-foreground/80"
                }`}
              >
                {allowAttachedMode
                  ? "Needed to publish whether attached or detached (drafts may still be empty)."
                  : "Needed to publish (drafts may still be empty)."}
              </span>
            </button>
          </div>
          <label
            className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none pt-1"
            data-testid="label-never-ask-required-confirm"
          >
            <Checkbox
              checked={neverAskAgain}
              onCheckedChange={(checked) => setNeverAskAgain(checked === true)}
              data-testid="checkbox-never-ask-required-confirm"
            />
            Never ask this again — click the asterisk to cycle modes
          </label>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectDatabaseConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  contentType,
  contentTypeLabel,
  staticCount,
  alreadyConnected,
  needsTemplateChoice,
  usableTemplate,
  divergences,
  bindings,
  templatePayload,
  onTemplatePayloadChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  contentType: string;
  contentTypeLabel: string;
  staticCount: number;
  alreadyConnected: boolean;
  needsTemplateChoice: boolean;
  usableTemplate: boolean;
  divergences: Array<{
    locale: string;
    sectionCount: number;
    sectionIds: string[];
    basename?: string;
    naming?: "template" | "single";
  }>;
  bindings: Array<{
    id: string;
    name?: string;
    component: string;
    locale: string;
    memberCount: number;
    members: Array<{ contentType: string; slug: string; sectionId: string }>;
  }>;
  templatePayload: SharedLayoutEnablePayload;
  onTemplatePayloadChange: (p: SharedLayoutEnablePayload) => void;
}) {
  const [sourceEligible, setSourceEligible] = useState(!needsTemplateChoice || usableTemplate);

  useEffect(() => {
    if (open) {
      setSourceEligible(!needsTemplateChoice || usableTemplate);
    }
  }, [open, needsTemplateChoice, usableTemplate]);

  const canContinue =
    !needsTemplateChoice ||
    templatePayload.template_mode === "keep_existing" ||
    (!!templatePayload.template_entry_source_slug &&
      sourceEligible &&
      (!usableTemplate || !!templatePayload.confirm));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] flex flex-col overflow-hidden" data-testid="dialog-connect-database-confirm">
        <DialogHeader>
          <DialogTitle>
            {alreadyConnected ? "Manage database connection" : "Connect a database"}
          </DialogTitle>
          <DialogDescription>
            {alreadyConnected
              ? `Update how ${contentTypeLabel} pulls entries from a database.`
              : `Link a database so ${contentTypeLabel} can serve entries dynamically.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 text-sm text-muted-foreground pr-1">
          <p>
            Connecting a database does not delete or migrate your existing static YAML folders.
            It only attaches a live data source and field mapping to this content type.
          </p>
          {staticCount > 0 && (
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3">
              <p className="font-medium text-foreground">
                You currently have {staticCount} static {contentTypeLabel.toLowerCase()} entr{staticCount === 1 ? "y" : "ies"}.
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  Matching slugs become <span className="text-foreground">partial overrides</span> —
                  the static folder customizes layout/sections on top of the database page.
                </li>
                <li>
                  The article body and core fields still come from the database when a row exists
                  for that slug.
                </li>
                <li>
                  Static-only entries (no matching database row) may stop resolving as live pages
                  once this type is database-backed — public URLs are driven by the database index.
                </li>
              </ul>
            </div>
          )}
          {needsTemplateChoice && (
            <div className="space-y-2">
              <p className="font-medium text-foreground">Shared template</p>
              <p className="text-xs">
                Linking a database turns shared layout on. Choose whether to keep an existing{" "}
                <code className="text-[11px]">template.*.yml</code> shell or seed one from an entry.
              </p>
              <SharedLayoutEnableFields
                contentType={contentType}
                usableTemplate={usableTemplate}
                divergences={divergences}
                bindings={bindings}
                value={templatePayload}
                onChange={onTemplatePayloadChange}
                onSourceEligibleChange={setSourceEligible}
              />
              {usableTemplate && templatePayload.template_mode === "from_entry" && (
                <label className="flex items-start gap-2 text-xs text-foreground rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!!templatePayload.confirm}
                    onChange={(e) =>
                      onTemplatePayloadChange({
                        ...templatePayload,
                        confirm: e.target.checked,
                      })
                    }
                    data-testid="checkbox-confirm-template-replace"
                  />
                  <span>
                    I understand this overwrites the existing shared template for every attached
                    entry of this type.
                  </span>
                </label>
              )}
            </div>
          )}
          <div>
            <p className="font-medium text-foreground mb-1">What happens next</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Pick a database and map identity fields (slug, locale)</li>
              <li>Map content fields and optional indexes for filtering</li>
              <li>
                Shared <code className="text-[11px]">template.*.yml</code> templates are used to render
                DB entries
              </li>
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-connect-database"
          >
            Cancel
          </Button>
          <Button
            disabled={!canContinue}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
            data-testid="button-confirm-connect-database"
          >
            <Database className="h-4 w-4 mr-2" />
            {alreadyConnected ? "Continue" : "Continue to connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PartialOverrideDialog({
  open,
  onOpenChange,
  contentTypeLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentTypeLabel: string;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!open) setShowAdvanced(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] flex flex-col overflow-hidden" data-testid="dialog-partial-override">
        <DialogHeader>
          <DialogTitle>Partial Override</DialogTitle>
          <DialogDescription>
            This page appears in both the database and as a static folder for {contentTypeLabel}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 text-sm text-muted-foreground pr-1">
          <p>
            The static folder does not replace the database entry. It adds customizations on top — like
            layout or presentation tweaks for this one page.
          </p>
          <div>
            <p className="font-medium text-foreground mb-1">What you can customize here</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Page title and SEO description</li>
              <li>Which sections appear and how they are arranged</li>
              <li>One-off layout changes for this entry only</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-foreground mb-1">What still comes from the database</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>The main article content (body text, author, dates, etc.)</li>
              <li>The page must still exist in the database — deleting it there breaks the live page</li>
            </ul>
          </div>
          <p>
            Use this when you want one database entry to look different without changing the shared
            template for every entry.
          </p>

          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
            data-testid="button-toggle-partial-override-advanced"
          >
            {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
            <IconChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
          </button>

          {showAdvanced && (
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3 text-xs">
              <div>
                <p className="font-medium text-foreground mb-1">How it works under the hood</p>
                <p>
                  At render time, the YAML folder merges on top of the shared{" "}
                  <code className="text-[11px]">single.&lt;locale&gt;.yml</code> template via{" "}
                  <code className="text-[11px]">mergeSingleTemplate</code>. The database row is still
                  fetched and attached as <code className="text-[11px]">singleEntry</code>.
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">YAML merge rules</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Sections are patched by <code className="text-[11px]">id</code></li>
                  <li>Sections can be removed with <code className="text-[11px]">_remove: true</code></li>
                  <li>Per-entry files: <code className="text-[11px]">_common.yml</code> and locale files (e.g. <code className="text-[11px]">en.yml</code>)</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">Database dependencies</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Template fields using <code className="text-[11px]">{`{{ entry.* }}`}</code> resolve from the DB row at render time</li>
                  <li>Public URLs are resolved from the database index (<code className="text-[11px]">byUrl</code>) when the cache is loaded</li>
                  <li>
                    <code className="text-[11px]">loadDatabaseSinglePage</code> returns null without a
                    matching DB row — static YAML alone cannot serve the page on indexed types
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="border-t pt-4">
          <Button onClick={() => onOpenChange(false)} data-testid="button-close-partial-override">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PartialOverrideVersionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]" data-testid="dialog-partial-override-versions">
        <DialogHeader>
          <DialogTitle>Versioning not available</DialogTitle>
          <DialogDescription>
            Partial overrides do not support A/B versioning.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            This entry is a partial override — its YAML folder customizes layout and sections on top
            of a database-backed page. Versioning requires a fully static YAML entry and is not wired
            into the database render path.
          </p>
          <p>
            To test layout changes, edit the per-entry YAML directly. To run an A/B test, use a
            fully static entry instead.
          </p>
        </div>
        <DialogFooter className="border-t pt-4">
          <Button onClick={() => onOpenChange(false)} data-testid="button-close-partial-override-versions">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DataSourceDialog({
  open,
  onOpenChange,
  contentType,
  sharedLayoutEnablePayload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: string;
  /** When newly linking DB and shared layout was off — pass enable gate fields. */
  sharedLayoutEnablePayload?: SharedLayoutEnablePayload | null;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<WizardStep>("database");
  const [completedSteps, setCompletedSteps] = useState<Set<WizardStep>>(new Set());
  const label = contentType.charAt(0).toUpperCase() + contentType.slice(1);

  const { data: config, isLoading } = useQuery<ContentTypeConfig>({
    queryKey: ["/api/content-types", contentType, "config"],
    queryFn: () => fetch(`/api/content-types/${contentType}/config`).then(r => r.json()),
    enabled: open,
  });

  const { data: databases } = useQuery<DatabaseListItem[]>({
    queryKey: ["/api/databases"],
    enabled: open,
  });

  const [selectedDb, setSelectedDb] = useState("");

  const [fieldMapping, setFieldMapping] = useState<FieldMapping>({});
  const [slugField, setSlugField] = useState("");
  const [localeField, setLocaleField] = useState("");
  const [hreflangsField, setHreflangsField] = useState("");
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [fieldMappingNotes, setFieldMappingNotes] = useState("");
  const [fieldMappingError, setFieldMappingError] = useState<string | null>(null);
  const [aiMappingFields, setAiMappingFields] = useState(false);

  const [sampleItems, setSampleItems] = useState<Record<string, unknown>[]>([]);
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleDialogOpen, setSampleDialogOpen] = useState(false);
  const [deletedFields, setDeletedFields] = useState<string[]>([]);
  const [indexedFields, setIndexedFields] = useState<string[]>([]);
  const [rawFields, setRawFields] = useState<string[]>([]);

  const [transformerModes, setTransformerModes] = useState<Record<string, boolean>>({});
  const [localeIsTransformer, setLocaleIsTransformer] = useState(false);
  const [slugIsTransformer, setSlugIsTransformer] = useState(false);
  const [hreflangsIsTransformer, setHreflangsIsTransformer] = useState(false);

  const markComplete = (s: WizardStep) => {
    setCompletedSteps((prev) => {
      const next = new Set(Array.from(prev));
      next.add(s);
      return next;
    });
  };

  useEffect(() => {
    if (config) {
      setSelectedDb(config.database?.slug || "");

      if (config.field_mapping) {
        const fm: FieldMapping = {};
        const modes: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(config.field_mapping)) {
          if (!k.startsWith("_")) {
            const raw = typeof v === "object" ? v.source : v;
            if (raw && raw.startsWith("function:")) {
              try {
                fm[k] = atob(raw.slice("function:".length));
                modes[k] = true;
              } catch {
                fm[k] = raw;
              }
            } else {
              fm[k] = raw;
            }
          }
        }
        setFieldMapping(fm);
        setTransformerModes(modes);

        const sm = config.field_mapping._slug;
        const smVal = sm ? (typeof sm === "object" ? sm.source : sm) : "";
        if (smVal && smVal.startsWith("function:")) {
          try {
            setSlugField(atob(smVal.slice("function:".length)));
            setSlugIsTransformer(true);
          } catch {
            setSlugField(smVal);
          }
        } else {
          setSlugField(smVal);
          setSlugIsTransformer(false);
        }

        const lm = config.field_mapping._locale;
        const lmVal = lm ? (typeof lm === "object" ? lm.source : lm) : "";
        if (lmVal && lmVal.startsWith("function:")) {
          try {
            setLocaleField(atob(lmVal.slice("function:".length)));
            setLocaleIsTransformer(true);
          } catch {
            setLocaleField(lmVal);
          }
        } else {
          setLocaleField(lmVal);
          setLocaleIsTransformer(false);
        }

        const hm = config.field_mapping._hreflangs;
        const hmVal = hm ? (typeof hm === "object" ? hm.source : hm) : "";
        if (hmVal && hmVal.startsWith("function:")) {
          try {
            setHreflangsField(atob(hmVal.slice("function:".length)));
            setHreflangsIsTransformer(true);
          } catch {
            setHreflangsField(hmVal);
          }
        } else {
          setHreflangsField(hmVal);
          setHreflangsIsTransformer(false);
        }
      }
      setIndexedFields(stripLocaleIndexFields(config.indexes || []) || []);

      if (config.database?.slug && sampleItems.length === 0) {
        loadSampleFromDb(config.database.slug);
      }

      const initialCompleted = new Set<WizardStep>();
      if (config.database?.slug) {
        initialCompleted.add("database");
        initialCompleted.add("preview");
      }
      if (config.field_mapping) {
        const hasSlug = !!config.field_mapping._slug;
        const hasRegular = Object.keys(config.field_mapping).filter(k => !k.startsWith("_")).length > 0;
        if (hasSlug) initialCompleted.add("identity");
        if (hasRegular) {
          initialCompleted.add("mapping");
          initialCompleted.add("indexes");
        }
      }
      setCompletedSteps(initialCompleted);
    }
  }, [config]);

  useEffect(() => {
    setCompletedSteps((prev) => {
      const next = new Set(Array.from(prev));
      if (selectedDb) next.add("database"); else next.delete("database");
      if (sampleItems.length > 0) next.add("preview"); else next.delete("preview");
      if (slugField) next.add("identity"); else next.delete("identity");
      const hasMappedField = Object.values(fieldMapping).some((v) => v != null && v !== "__none__");
      if (hasMappedField) next.add("mapping"); else next.delete("mapping");
      return next;
    });
  }, [selectedDb, fieldMapping, slugField, sampleItems]);

  const loadSampleFromDb = async (dbName: string) => {
    if (!dbName) return;
    setLoadingSample(true);
    try {
      const [itemsRes, rawFieldsRes] = await Promise.all([
        fetch(`/api/databases/${dbName}/items`),
        fetch(`/api/databases/${dbName}/raw-fields`),
      ]);
      if (itemsRes.ok) {
        const data = await itemsRes.json();
        const items = (data.items || []).slice(0, 3) as Record<string, unknown>[];
        setSampleItems(items);
        if (items.length > 0) {
          const keys = new Set<string>();
          for (const item of items) {
            collectFieldPaths(item, "", keys);
          }
          setAvailableFields(Array.from(keys).sort());
        }
      }
      if (rawFieldsRes.ok) {
        const rawData = await rawFieldsRes.json();
        setRawFields((rawData.fields || []).sort());
      }
    } catch {
      setSampleItems([]);
    } finally {
      setLoadingSample(false);
    }
  };

  const handleAnalyzeFields = async () => {
    if (sampleItems.length === 0) return;
    setAiMappingFields(true);
    setFieldMappingError(null);
    setDeletedFields([]);
    try {
      const res = await apiRequest("POST", `/api/content-types/${contentType}/ai/analyze-fields`, {
        sample_posts: sampleItems.slice(0, 3),
      });
      const data = await res.json();
      if (data.error) {
        setFieldMappingError(data.error);
      } else {
        const aiMapping = data.field_mapping || {};
        if (aiMapping._slug) {
          setSlugField(typeof aiMapping._slug === "object" ? aiMapping._slug.source : aiMapping._slug);
          delete aiMapping._slug;
        }
        if (aiMapping._locale) {
          setLocaleField(typeof aiMapping._locale === "object" ? aiMapping._locale.source : aiMapping._locale);
          delete aiMapping._locale;
        }
        if (aiMapping._hreflangs) {
          setHreflangsField(
            typeof aiMapping._hreflangs === "object"
              ? aiMapping._hreflangs.source
              : aiMapping._hreflangs,
          );
          delete aiMapping._hreflangs;
        }
        setFieldMapping(aiMapping);
        if (data.available_fields) {
          setAvailableFields(data.available_fields);
        }
        setFieldMappingNotes(data.notes || "");
      }
    } catch (err) {
      setFieldMappingError(String(err));
    } finally {
      setAiMappingFields(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const fullMapping: Record<string, string> = {};
      if (slugField) {
        fullMapping._slug = slugIsTransformer ? "function:" + btoa(slugField) : slugField;
      }
      if (localeField) {
        fullMapping._locale = localeIsTransformer ? "function:" + btoa(localeField) : localeField;
      }
      if (hreflangsField) {
        fullMapping._hreflangs = hreflangsIsTransformer
          ? "function:" + btoa(hreflangsField)
          : hreflangsField;
      }
      const localeSource = localeIsTransformer ? null : localeField;
      const hreflangsSource = hreflangsIsTransformer ? null : hreflangsField;
      for (const [k, v] of Object.entries(fieldMapping)) {
        if (v != null && v !== "__none__") {
          // Aliases of system specials — not regular schema keys
          if (k === "slug" || k === "image") continue;
          // skip any regular mapping whose source is the same as the locale field —
          // it's already captured by _locale and would create a redundant duplicate
          if (!transformerModes[k] && localeSource && v === localeSource) continue;
          if (!transformerModes[k] && hreflangsSource && v === hreflangsSource) continue;
          fullMapping[k] = transformerModes[k] ? "function:" + btoa(v) : v;
        }
      }

      const payload: Record<string, unknown> = {
        field_mapping: Object.keys(fullMapping).length > 0 ? fullMapping : undefined,
        indexes: stripLocaleIndexFields(indexedFields),
        database: {
          slug: selectedDb,
        },
      };

      const wasDbBacked = !!config?.database?.slug;
      if (!wasDbBacked && sharedLayoutEnablePayload) {
        payload.template_mode = sharedLayoutEnablePayload.template_mode;
        if (sharedLayoutEnablePayload.shared_layout_base_locale) {
          payload.shared_layout_base_locale = sharedLayoutEnablePayload.shared_layout_base_locale;
        }
        if (sharedLayoutEnablePayload.template_entry_source_slug) {
          payload.template_entry_source_slug = sharedLayoutEnablePayload.template_entry_source_slug;
        }
        if (sharedLayoutEnablePayload.template_entry_source_locale) {
          payload.template_entry_source_locale =
            sharedLayoutEnablePayload.template_entry_source_locale;
        }
        if (sharedLayoutEnablePayload.confirm) payload.confirm = true;
      }

      const res = await fetch(`/api/content-types/${contentType}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data: Record<string, unknown> = {};
      try { data = await res.json(); } catch { /* non-JSON */ }

      if (!res.ok) {
        if (data.code === "confirm_template_replace" && data.preview) {
          toast({
            title: "Confirm template replace",
            description:
              "Re-save with confirm after reviewing the overwrite preview in the connect dialog.",
            variant: "destructive",
          });
          return;
        }
        toast({ title: (data.error as string) || "Failed to save configuration", variant: "destructive" });
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });
      toast({ title: `${label} configuration saved` });
      onOpenChange(false);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to save configuration", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const canGoNext = (s: WizardStep): boolean => {
    switch (s) {
      case "database": return !!selectedDb;
      case "preview": return true;
      case "identity": return !!slugField;
      case "mapping": return Object.values(fieldMapping).some((v) => v != null && v !== "__none__");
      case "indexes": return true;
      default: return false;
    }
  };

  const goNext = () => {
    const idx = WIZARD_STEPS.findIndex((s) => s.id === step);
    if (idx < WIZARD_STEPS.length - 1) {
      markComplete(step);
      const nextStep = WIZARD_STEPS[idx + 1].id;
      setStep(nextStep);
      if (nextStep === "preview" && sampleItems.length === 0 && selectedDb) {
        loadSampleFromDb(selectedDb);
      }
    }
  };

  const goBack = () => {
    const idx = WIZARD_STEPS.findIndex((s) => s.id === step);
    if (idx > 0) {
      setStep(WIZARD_STEPS[idx - 1].id);
    }
  };

  const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === step);
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;

  const dbList = databases || [];

  const hreflangsSampleCheck =
    !hreflangsIsTransformer && hreflangsField && sampleItems.length > 0
      ? validateHreflangsFieldAgainstSamples(hreflangsField, sampleItems)
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[580px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect Database to {label}</DialogTitle>
        </DialogHeader>

        <StepIndicator steps={WIZARD_STEPS} currentStep={step} completedSteps={completedSteps} />

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">Loading configuration...</span>
          </div>
        ) : (
          <div className="space-y-4 min-h-[250px]">

            {step === "database" && (
              <div className="space-y-4" data-testid="step-database">
                <p className="text-sm text-muted-foreground">
                  Choose which database provides dynamic entries for this content type. Database items will appear alongside any static YAML entries.
                </p>

                <div className="space-y-2">
                  <Label>Database</Label>
                  <Select value={selectedDb} onValueChange={(v) => { setSelectedDb(v); setSampleItems([]); }}>
                    <SelectTrigger data-testid="select-database">
                      <SelectValue placeholder="Select a database..." />
                    </SelectTrigger>
                    <SelectContent>
                      {dbList.map((db) => (
                        <SelectItem key={db.name} value={db.name}>
                          <div className="flex items-center gap-2">
                            <span>{db.label || db.name}</span>
                            <span className="text-muted-foreground text-xs">({db.name})</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedDb && (() => {
                  const db = dbList.find((d) => d.name === selectedDb);
                  return db ? (
                    <div className="rounded-md border p-3 space-y-1" data-testid="section-db-info">
                      <p className="text-sm font-medium">{db.label || db.name}</p>
                      {db.description && (
                        <p className="text-xs text-muted-foreground">{db.description}</p>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <Badge variant="outline" className="text-xs">{db.source_type}</Badge>
                      </div>
                    </div>
                  ) : null;
                })()}

                {dbList.length === 0 && (
                  <div className="rounded-md bg-muted px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      No databases found. <a href="/private/databases?create=true" className="text-primary underline" data-testid="link-create-database">Create a database</a> first.
                    </p>
                  </div>
                )}

                {dbList.length > 0 && (
                  <div className="text-right">
                    <a href="/private/databases" className="text-xs text-muted-foreground underline" data-testid="link-manage-databases">
                      Manage databases
                    </a>
                  </div>
                )}
              </div>
            )}

            {step === "preview" && (
              <div className="space-y-4" data-testid="step-preview">
                <p className="text-sm text-muted-foreground">
                  Here's what we found in your database. Review the detected fields below — these will be available for mapping in the next steps. You can also auto-detect the mapping using AI.
                </p>

                {loadingSample && (
                  <div className="flex items-center justify-center gap-2 py-6">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm text-muted-foreground">Loading sample data from database...</span>
                  </div>
                )}

                {!loadingSample && sampleItems.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs" data-testid="badge-item-count">
                        {sampleItems.length} sample item{sampleItems.length !== 1 ? "s" : ""} loaded
                      </Badge>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline"
                        onClick={() => setSampleDialogOpen(true)}
                        data-testid="link-view-sample"
                      >
                        View raw JSON
                      </button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => loadSampleFromDb(selectedDb)}
                        disabled={loadingSample}
                        data-testid="button-refresh-sample"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-muted-foreground">Detected Fields ({availableFields.length})</Label>
                      <div className="rounded-md border p-3 flex flex-wrap gap-1.5" data-testid="section-detected-fields">
                        {availableFields.map((f) => (
                          <Badge key={f} variant="outline" className="text-xs font-mono no-default-active-elevate" data-testid={`badge-field-${f}`}>
                            {f}
                          </Badge>
                        ))}
                        {availableFields.length === 0 && (
                          <p className="text-xs text-muted-foreground">No fields detected.</p>
                        )}
                      </div>
                    </div>

                    <Button
                      onClick={handleAnalyzeFields}
                      disabled={aiMappingFields}
                      className="w-full"
                      data-testid="button-ai-fields"
                    >
                      {aiMappingFields ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing fields...</>
                      ) : (
                        <><Wand2 className="h-4 w-4 mr-2" />Auto-detect Field Mapping</>
                      )}
                    </Button>

                    {fieldMappingError && (
                      <div className="rounded-md bg-destructive/10 px-3 py-2">
                        <p className="text-xs text-destructive">{fieldMappingError}</p>
                      </div>
                    )}
                  </>
                )}

                {!loadingSample && sampleItems.length === 0 && selectedDb && (
                  <div className="rounded-md bg-muted px-3 py-4 space-y-2 text-center">
                    <p className="text-sm text-muted-foreground">
                      No sample data available from database "{selectedDb}".
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => loadSampleFromDb(selectedDb)}
                      disabled={loadingSample}
                      data-testid="button-retry-sample"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Retry
                    </Button>
                  </div>
                )}

                <SampleDataDialog
                  open={sampleDialogOpen}
                  onOpenChange={setSampleDialogOpen}
                  sampleItems={sampleItems}
                />
              </div>
            )}

            {step === "identity" && (
              <div className="space-y-4" data-testid="step-identity">
                <p className="text-sm text-muted-foreground">
                  Every database-backed content type needs an identity. The slug field uniquely identifies each item for URL routing. The locale field identifies the item's language for multi-language support.
                </p>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium text-muted-foreground flex-1">Slug Field (_slug)</Label>
                    <Badge variant="default" className="text-[10px] no-default-active-elevate">Required</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={slugIsTransformer ? "text-primary" : ""}
                      onClick={() => {
                        if (!slugIsTransformer) {
                          setSlugIsTransformer(true);
                          if (!slugField) setSlugField("(value, item) => item.slug");
                        } else {
                          setSlugIsTransformer(false);
                          setSlugField("");
                        }
                      }}
                      data-testid="button-toggle-slug-transform"
                    >
                      <Code className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {slugIsTransformer ? (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground font-mono">(value, item) =&gt; ...</p>
                      <Textarea
                        value={slugField}
                        onChange={(e) => setSlugField(e.target.value)}
                        placeholder="(value, item) => item.slug"
                        className="text-xs font-mono min-h-[3rem] resize-y"
                        data-testid="textarea-slug-transform"
                      />
                    </div>
                  ) : (
                    <Select
                      value={slugField || "__none__"}
                      onValueChange={(v) => {
                        setSlugField(v === "__none__" ? "" : v);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs font-mono" data-testid="select-slug-field">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">(none)</SelectItem>
                        {availableFields.map((f) => (
                          <SelectItem key={f} value={f}>{f}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Which field uniquely identifies each item (e.g., "slug", "id")
                  </p>
                </div>

                <div className="space-y-2 pt-2 border-t">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium text-muted-foreground flex-1">Locale Field (_locale)</Label>
                    <Badge variant="outline" className="text-[10px] no-default-active-elevate">Recommended</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={localeIsTransformer ? "text-primary" : ""}
                      onClick={() => {
                        if (!localeIsTransformer) {
                          setLocaleIsTransformer(true);
                          if (!localeField) setLocaleField("(value) => value === 'us' ? 'en' : value");
                        } else {
                          setLocaleIsTransformer(false);
                          setLocaleField("");
                        }
                      }}
                      data-testid="button-toggle-locale-transform"
                    >
                      <Code className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {localeIsTransformer ? (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground font-mono">(value, item) =&gt; ...</p>
                      <Textarea
                        value={localeField}
                        onChange={(e) => setLocaleField(e.target.value)}
                        placeholder="(value) => value === 'us' ? 'en' : value"
                        className="text-xs font-mono min-h-[3rem] resize-y"
                        data-testid="textarea-locale-transform"
                      />
                    </div>
                  ) : (
                    <Select
                      value={localeField || "__none__"}
                      onValueChange={(v) => {
                        setLocaleField(v === "__none__" ? "" : v);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs font-mono" data-testid="select-locale-field">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">(none)</SelectItem>
                        {availableFields.map((f) => (
                          <SelectItem key={f} value={f}>{f}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Which field identifies the item's language (e.g., "lang", "locale")
                  </p>
                </div>

                <div className="space-y-2 pt-2 border-t">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium text-muted-foreground flex-1">Hreflangs Field (_hreflangs)</Label>
                    <Badge variant="outline" className="text-[10px] no-default-active-elevate">Recommended</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={hreflangsIsTransformer ? "text-primary" : ""}
                      onClick={() => {
                        if (!hreflangsIsTransformer) {
                          setHreflangsIsTransformer(true);
                          if (!hreflangsField) {
                            setHreflangsField("(value, item) => item.translations");
                          }
                        } else {
                          setHreflangsIsTransformer(false);
                          setHreflangsField("");
                        }
                      }}
                      data-testid="button-toggle-hreflangs-transform"
                    >
                      <Code className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {hreflangsIsTransformer ? (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground font-mono">(value, item) =&gt; ...</p>
                      <Textarea
                        value={hreflangsField}
                        onChange={(e) => setHreflangsField(e.target.value)}
                        placeholder="(value, item) => item.translations"
                        className="text-xs font-mono min-h-[3rem] resize-y"
                        data-testid="textarea-hreflangs-transform"
                      />
                    </div>
                  ) : (
                    <Select
                      value={hreflangsField || "__none__"}
                      onValueChange={(v) => {
                        setHreflangsField(v === "__none__" ? "" : v);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs font-mono" data-testid="select-hreflangs-field">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">(none)</SelectItem>
                        {availableFields.map((f) => (
                          <SelectItem key={f} value={f}>{f}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Locale→slug map for alternate URLs (e.g. translations: {"{"} en: slug, es: slug {"}"})
                  </p>
                  {hreflangsSampleCheck?.ok === true && (
                    <div
                      className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2"
                      data-testid="text-hreflangs-structure-ok"
                    >
                      <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground">
                        Sample data matches the expected locale→slug map structure.
                      </p>
                    </div>
                  )}
                  {hreflangsSampleCheck && !hreflangsSampleCheck.ok && (
                    <div
                      className="rounded-md bg-destructive/10 px-3 py-2 space-y-1.5"
                      data-testid="text-hreflangs-structure-error"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-destructive flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-destructive font-medium">
                          Field &quot;{hreflangsField}&quot; does not match the expected _hreflangs structure
                          {sampleItems.length > 1 ? ` (sample #${hreflangsSampleCheck.sampleIndex + 1})` : ""}.
                        </p>
                      </div>
                      <p className="text-xs text-destructive pl-5">
                        <span className="font-medium">Expected:</span>{" "}
                        <code className="font-mono bg-background/60 px-1 rounded">{hreflangsSampleCheck.expected}</code>
                      </p>
                      <p className="text-xs text-destructive pl-5">
                        <span className="font-medium">Found:</span> {hreflangsSampleCheck.foundSummary}
                      </p>
                      <pre className="text-[10px] font-mono text-destructive/90 bg-background/60 rounded px-2 py-1.5 ml-5 overflow-x-auto whitespace-pre-wrap break-all">
                        {hreflangsSampleCheck.foundSample}
                      </pre>
                    </div>
                  )}
                </div>

                {(slugIsTransformer || localeIsTransformer || hreflangsIsTransformer) && (
                  <div className="rounded-md bg-muted px-3 py-2 space-y-1" data-testid="section-transform-help">
                    <p className="text-xs font-medium text-muted-foreground">About computed fields</p>
                    <p className="text-xs text-muted-foreground">
                      Write a JavaScript function that receives two arguments: <code className="font-mono bg-background px-1 rounded">value</code> (the raw field value) and <code className="font-mono bg-background px-1 rounded">item</code> (the full database record). Return the normalized value.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Example: <code className="font-mono bg-background px-1 rounded">(value, item) =&gt; value === 'us' ? 'en' : value</code>
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Functions run in a secure sandbox — no access to files, network, or system resources. 50ms timeout.
                    </p>
                  </div>
                )}
              </div>
            )}

            {step === "mapping" && (
              <div className="space-y-4" data-testid="step-mapping">
                <p className="text-sm text-muted-foreground">
                  Map database fields to content type properties. Pick from detected fields, type a custom dot-path, or use the Code button to compute a value with a function.
                </p>

                <p className="text-xs text-muted-foreground" data-testid="text-field-mapping-note">
                  Use <code className="font-mono bg-muted px-1 rounded">raw.fieldName</code> to reference original API fields, or <code className="font-mono bg-muted px-1 rounded">db.fieldName</code> (default) for normalized database fields.
                  The <strong className="font-medium text-foreground">Code</strong> menu chooses how the live value is produced: another field, or a function{" "}
                  <code className="font-mono bg-muted px-1 rounded">(value, item) =&gt; result</code>.
                </p>

                {fieldMappingNotes && (
                  <p className="text-xs text-muted-foreground">{fieldMappingNotes}</p>
                )}

                {fieldMappingError && (
                  <div className="rounded-md bg-destructive/10 px-3 py-2">
                    <p className="text-xs text-destructive">{fieldMappingError}</p>
                  </div>
                )}

                {Object.values(transformerModes).some(Boolean) && (
                  <div className="rounded-md bg-muted px-3 py-2 space-y-1" data-testid="section-transform-help-mapping">
                    <p className="text-xs font-medium text-muted-foreground">About computed fields</p>
                    <p className="text-xs text-muted-foreground">
                      Write a JavaScript function: <code className="font-mono bg-background px-1 rounded">(value, item) =&gt; result</code>. <code className="font-mono bg-background px-1 rounded">value</code> is the raw field value, <code className="font-mono bg-background px-1 rounded">item</code> is the full record. Runs in a secure sandbox (50ms timeout).
                    </p>
                  </div>
                )}

                {Object.keys(fieldMapping).length > 0 && (
                  <div className="space-y-2">
                    {Object.entries(fieldMapping).map(([standardField, sourceField]) => {
                      const isFnMode = !!transformerModes[standardField];
                      const isOptional = !isFnMode && typeof sourceField === "string" && sourceField.startsWith("?");
                      const bareSource = isOptional ? (sourceField as string).slice(1) : sourceField;
                      const hasDotPath = typeof bareSource === "string" && (bareSource.includes(".") || bareSource === "");
                      const isCustom = !isFnMode && bareSource != null && bareSource !== "__none__" && hasDotPath;
                      const selectValue = isCustom ? "__custom__" : ((bareSource as string) || "__none__");
                      return (
                      <div key={standardField} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium w-24 flex-shrink-0 text-right text-muted-foreground">
                            {standardField}
                          </span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          {isFnMode ? (
                            <div className="flex-1 space-y-1">
                              <p className="text-[10px] text-muted-foreground font-mono">(value, item) =&gt; ...</p>
                              <Textarea
                                value={sourceField || ""}
                                onChange={(e) => setFieldMapping((prev) => ({ ...prev, [standardField]: e.target.value }))}
                                placeholder="(value, item) => value"
                                className="text-xs font-mono min-h-[3rem] resize-y"
                                data-testid={`textarea-transform-${standardField}`}
                              />
                            </div>
                          ) : isCustom ? (
                            <>
                              <Input
                                value={bareSource as string}
                                onChange={(e) => {
                                  const prefix = isOptional ? "?" : "";
                                  setFieldMapping((prev) => ({ ...prev, [standardField]: `${prefix}${e.target.value}` }));
                                }}
                                placeholder="e.g. author.details.name"
                                className="h-8 text-xs font-mono flex-1"
                                data-testid={`input-custom-path-${standardField}`}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="flex-shrink-0"
                                onClick={() => {
                                  setFieldMapping((prev) => ({ ...prev, [standardField]: null }));
                                }}
                                data-testid={`button-clear-custom-${standardField}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <Select
                              value={selectValue}
                              onValueChange={(v) => {
                                const prefix = isOptional ? "?" : "";
                                if (v === "__custom__") {
                                  setFieldMapping((prev) => ({ ...prev, [standardField]: prefix }));
                                } else {
                                  setFieldMapping((prev) => ({ ...prev, [standardField]: v === "__none__" ? null : `${prefix}${v}` }));
                                }
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs font-mono" data-testid={`select-field-${standardField}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">(not mapped)</SelectItem>
                                {bareSource && bareSource !== "__none__" && !availableFields.includes(bareSource as string) && (
                                  <SelectItem value={bareSource as string} className="text-destructive font-mono">
                                    {bareSource} (not in DB)
                                  </SelectItem>
                                )}
                                {availableFields.map((f) => (
                                  <SelectItem key={f} value={f}>{f}</SelectItem>
                                ))}
                                <SelectItem value="__custom__">Custom path...</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                          {!isFnMode && bareSource && bareSource !== "__none__" && (
                            <button
                              type="button"
                              onClick={() => {
                                setFieldMapping((prev) => {
                                  const cur = prev[standardField];
                                  if (!cur) return prev;
                                  const wasOptional = typeof cur === "string" && cur.startsWith("?");
                                  return { ...prev, [standardField]: wasOptional ? cur.slice(1) : `?${cur}` };
                                });
                              }}
                              className={`text-[10px] flex-shrink-0 cursor-pointer transition-colors ${isOptional ? "text-muted-foreground hover:text-foreground" : "text-foreground font-medium hover:text-muted-foreground"}`}
                              data-testid={`button-toggle-optional-${standardField}`}
                            >
                              {isOptional ? "optional" : "required"}
                            </button>
                          )}
                          <ComputeModeMenu
                            fieldKey={standardField}
                            mode={isFnMode ? "function" : "field"}
                            testId={`button-toggle-transform-${standardField}`}
                            onNotComputed={() => {
                              setTransformerModes((prev) => {
                                const next = { ...prev };
                                delete next[standardField];
                                return next;
                              });
                              setFieldMapping((prev) => {
                                const cur = prev[standardField];
                                if (typeof cur === "string" && (cur.includes("=>") || cur.includes("return "))) {
                                  return { ...prev, [standardField]: standardField };
                                }
                                return prev;
                              });
                            }}
                            onPickField={() => {
                              setTransformerModes((prev) => {
                                const next = { ...prev };
                                delete next[standardField];
                                return next;
                              });
                              setFieldMapping((prev) => {
                                const cur = prev[standardField];
                                if (typeof cur === "string" && (cur.includes("=>") || cur.includes("return "))) {
                                  return { ...prev, [standardField]: standardField };
                                }
                                return prev;
                              });
                            }}
                            onPickFunction={() => {
                              setTransformerModes((prev) => ({ ...prev, [standardField]: true }));
                              setFieldMapping((prev) => {
                                const cur = prev[standardField];
                                const looksLikeFn =
                                  typeof cur === "string" && (cur.includes("=>") || cur.includes("return "));
                                return {
                                  ...prev,
                                  [standardField]: looksLikeFn ? cur : "(value, item) => value",
                                };
                              });
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="flex-shrink-0"
                            onClick={() => {
                              setFieldMapping((prev) => {
                                const next = { ...prev };
                                delete next[standardField];
                                return next;
                              });
                              setTransformerModes((prev) => {
                                const next = { ...prev };
                                delete next[standardField];
                                return next;
                              });
                              setDeletedFields((prev) => prev.includes(standardField) ? prev : [...prev, standardField]);
                            }}
                            data-testid={`button-delete-field-${standardField}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}

                {Object.keys(fieldMapping).length === 0 && (
                  <div className="space-y-3">
                    {availableFields.length > 0 ? (
                      <>
                        <p className="text-xs text-muted-foreground">Click a field to add it as a mapping:</p>
                        <div className="flex flex-wrap gap-1.5" data-testid="section-suggest-fields">
                          {availableFields.filter(f => {
                            const slugSrc = !slugIsTransformer && slugField ? slugField.replace(/^\?/, '') : null;
                            const localeSrc = !localeIsTransformer && localeField ? localeField.replace(/^\?/, '') : null;
                            if (slugSrc && f === slugSrc) return false;
                            if (localeSrc && f === localeSrc) return false;
                            return true;
                          }).map((f) => (
                            <Badge
                              key={f}
                              variant="outline"
                              className="cursor-pointer text-xs font-mono"
                              onClick={() => setFieldMapping((prev) => ({ ...prev, [f]: f }))}
                              data-testid={`badge-suggest-${f}`}
                            >
                              <Plus className="h-2.5 w-2.5 mr-1" />
                              {f}
                            </Badge>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">No fields detected yet. Use auto-detect below or go back to the Inspect step to load sample data first.</p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAnalyzeFields}
                      disabled={aiMappingFields || sampleItems.length === 0}
                      className="w-full"
                      data-testid="button-ai-fields-mapping"
                    >
                      {aiMappingFields ? (
                        <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Analyzing fields...</>
                      ) : (
                        <><Wand2 className="h-3.5 w-3.5 mr-1" />Auto-detect Field Mapping</>
                      )}
                    </Button>
                  </div>
                )}

                {(() => {
                  const mappedSources = new Set(Object.values(fieldMapping).filter(Boolean));
                  const slugSrc = !slugIsTransformer && slugField ? slugField.replace(/^\?/, '') : null;
                  const localeSrc = !localeIsTransformer && localeField ? localeField.replace(/^\?/, '') : null;
                  const unmapped = availableFields.filter(f => {
                    if (slugSrc && f === slugSrc) return false;
                    if (localeSrc && f === localeSrc) return false;
                    return !mappedSources.has(f) && !(f in fieldMapping);
                  });
                  if (Object.keys(fieldMapping).length === 0 || unmapped.length === 0) return null;
                  return (
                    <div className="flex items-center gap-2 flex-wrap" data-testid="section-unmapped-available">
                      <span className="text-xs text-muted-foreground">Also add:</span>
                      {unmapped.map((f) => (
                        <Badge
                          key={f}
                          variant="outline"
                          className="cursor-pointer text-xs font-mono"
                          onClick={() => setFieldMapping((prev) => ({ ...prev, [f]: f }))}
                          data-testid={`badge-add-field-${f}`}
                        >
                          <Plus className="h-2.5 w-2.5 mr-1" />
                          {f}
                        </Badge>
                      ))}
                    </div>
                  );
                })()}

                {deletedFields.filter((f) => !(f in fieldMapping)).length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">Re-add:</span>
                    {deletedFields.filter((f) => !(f in fieldMapping)).map((f) => (
                      <Badge
                        key={f}
                        variant="outline"
                        className="cursor-pointer text-xs"
                        onClick={() => {
                          setFieldMapping((prev) => ({ ...prev, [f]: null }));
                        }}
                        data-testid={`badge-readd-${f}`}
                      >
                        + {f}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {step === "indexes" && (
              <div className="space-y-4" data-testid="step-indexes">
                <p className="text-sm text-muted-foreground">
                  Indexed fields generate summary cards, filter dropdowns, and sortable columns on the management page. Click a field to toggle indexing. Locale is always indexed automatically.
                </p>

                <div className="flex items-center gap-2 flex-wrap" data-testid="section-index-badges">
                  {localeField && (
                    <Badge variant="default" className="text-xs cursor-default opacity-70 no-default-active-elevate" data-testid="badge-index-locale">
                      <Check className="h-3 w-3 mr-1" />
                      {localeIsTransformer ? "locale (computed)" : localeField} (auto)
                    </Badge>
                  )}
                  {Object.keys(fieldMapping).filter(k => {
                    if (k.startsWith("_") || k === localeField || isLocaleIndexField(k)) return false;
                    // also hide any field whose source maps to the same DB column as the locale
                    if (!localeIsTransformer && localeField && fieldMapping[k] === localeField) return false;
                    return true;
                  }).map((field) => {
                    const isIndexed = indexedFields.includes(field);
                    return (
                      <Badge
                        key={field}
                        variant={isIndexed ? "default" : "outline"}
                        className="text-xs cursor-pointer"
                        onClick={() => {
                          setIndexedFields((prev) =>
                            isIndexed ? prev.filter((f) => f !== field) : [...prev, field]
                          );
                        }}
                        data-testid={`badge-index-${field}`}
                      >
                        {isIndexed && <Check className="h-3 w-3 mr-1" />}
                        {field}
                      </Badge>
                    );
                  })}
                  {Object.keys(fieldMapping).filter(k => {
                    if (k.startsWith("_") || k === localeField || isLocaleIndexField(k)) return false;
                    if (!localeIsTransformer && localeField && fieldMapping[k] === localeField) return false;
                    return true;
                  }).length === 0 && !localeField && (
                    <p className="text-xs text-muted-foreground">No mapped fields available for indexing. Go back and add field mappings first.</p>
                  )}
                </div>
              </div>
            )}

          </div>
        )}

        <DialogFooter>
          {stepIndex > 0 && (
            <Button variant="outline" onClick={goBack} className="mr-auto" data-testid="button-wizard-back">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-datasource">
            Cancel
          </Button>
          {isLastStep ? (
            <Button
              onClick={handleSave}
              disabled={saving || isLoading || !Object.values(fieldMapping).some((v) => v != null && v !== "__none__")}
              data-testid="button-save-datasource"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          ) : (
            <Button
              onClick={goNext}
              disabled={!canGoNext(step)}
              data-testid="button-wizard-next"
            >
              Next
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function collectFieldPaths(obj: unknown, prefix: string, keys: Set<string>): void {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    keys.add(path);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      collectFieldPaths(v, path, keys);
    }
  }
}

function getValueByDotPath(obj: unknown, dotPath: string): unknown {
  let current = obj;
  for (const key of dotPath.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function summarizeValueShape(value: unknown): string {
  if (value === undefined) return "missing (undefined)";
  if (value === null) return "null";
  if (Array.isArray(value)) return `array (${value.length} item${value.length === 1 ? "" : "s"})`;
  if (typeof value === "string") return "string";
  if (typeof value === "number" || typeof value === "boolean") return typeof value;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "empty object {}";
    const valueTypes = Array.from(
      new Set(entries.map(([, v]) => (Array.isArray(v) ? "array" : typeof v))),
    );
    const stringSlugCount = entries.filter(
      ([k, v]) => typeof v === "string" && !!v.trim() && !!normalizeAuditLocaleKey(k),
    ).length;
    if (stringSlugCount > 0 && stringSlugCount < entries.length) {
      return `object with ${entries.length} key(s) but only ${stringSlugCount} locale→slug string entr${stringSlugCount === 1 ? "y" : "ies"} (other values are ${valueTypes.filter((t) => t !== "string").join("/") || "invalid"})`;
    }
    return `object with ${entries.length} key(s), values are ${valueTypes.join("/")}`;
  }
  return typeof value;
}

function truncateJsonSample(value: unknown, max = 200): string {
  try {
    const s = JSON.stringify(value);
    if (s == null) return String(value);
    return s.length <= max ? s : `${s.slice(0, max)}…`;
  } catch {
    return String(value);
  }
}

/** True when value is a non-empty locale → slug string map (same shape normalizeHreflangMap accepts). */
function isValidHreflangMapShape(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  let validEntries = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== "string" || !v.trim()) continue;
    if (!normalizeAuditLocaleKey(k)) continue;
    validEntries++;
  }
  return validEntries > 0;
}

type HreflangSampleValidation =
  | { ok: true }
  | {
      ok: false;
      expected: string;
      foundSummary: string;
      foundSample: string;
      sampleIndex: number;
    };

function validateHreflangsFieldAgainstSamples(
  fieldPath: string,
  samples: Record<string, unknown>[],
): HreflangSampleValidation {
  if (!fieldPath || samples.length === 0) return { ok: true };

  for (let i = 0; i < samples.length; i++) {
    const raw = getValueByDotPath(samples[i], fieldPath);
    if (!isValidHreflangMapShape(raw)) {
      return {
        ok: false,
        expected:
          '{ "en": "english-slug", "es": "spanish-slug" } — an object mapping locale codes to slug strings',
        foundSummary: summarizeValueShape(raw),
        foundSample: truncateJsonSample(raw),
        sampleIndex: i,
      };
    }
  }
  return { ok: true };
}

function formatFieldValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatFieldValue).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Prefer common display keys; recurse when nested (e.g. { slug: { slug: "x" } })
    for (const key of ["slug", "name", "title", "label", "value"] as const) {
      if (key in obj) {
        const nested = formatFieldValue(obj[key]);
        if (nested) return nested;
      }
    }
  }
  return "";
}

/** Flatten a field into discrete display tokens for KPI counts / filters. */
function fieldValueTokens(value: unknown): string[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) {
    return value.flatMap(fieldValueTokens).filter(Boolean);
  }
  const formatted = formatFieldValue(value);
  return formatted ? [formatted] : [];
}

function resolveItemField(item: Record<string, any>, field: string): string {
  switch (field) {
    case "slug": return item.slug || "";
    case "category": return formatFieldValue(item.category);
    case "lang": return item.lang || item.language || "";
    case "status": return formatFieldValue(item.status) || "";
    case "tags": return formatFieldValue(item.tags);
    default: return formatFieldValue(item[field]);
  }
}

function buildItemUrl(pattern: string, item: Record<string, any>, locale: string): string {
  let result = pattern.replaceAll(":locale", locale);
  const paramMatches = pattern.match(/:([a-zA-Z_]+)/g) || [];
  for (const param of paramMatches) {
    const key = param.slice(1);
    if (key === "locale") continue;
    result = result.replaceAll(param, resolveItemField(item, key));
  }
  return result;
}

function normalizeAuditLocaleKey(key: string): string {
  const k = String(key || "").trim().toLowerCase();
  if (!k) return "";
  if (k === "us") return "en";
  const m = k.match(/^([a-z]{2})/);
  return m ? m[1] : k;
}

/** Locale → slug map from _hreflangs / translations, always including the current row. */
function resolveItemLocaleSlugMap(
  item: Record<string, any>,
  localeKey: string | null,
  hreflangsSource: string | null,
): Record<string, string> {
  const selfLocale = normalizeAuditLocaleKey(
    String((localeKey && item[localeKey]) || item.language || item.lang || item.locale || "en"),
  );
  const selfSlug = String(item.slug || "").trim();
  const out: Record<string, string> = {};

  const candidates = [
    hreflangsSource ? item[hreflangsSource] : undefined,
    item.translations,
    item._hreflangs,
  ];
  for (const raw of candidates) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v !== "string" || !v.trim()) continue;
      const loc = normalizeAuditLocaleKey(k);
      if (loc) out[loc] = v.trim();
    }
    break;
  }

  if (selfLocale && selfSlug) out[selfLocale] = selfSlug;
  return out;
}

function DbLangCell({
  item,
  localeKey,
  hreflangsSource,
  itemsBySlug,
}: {
  item: Record<string, any>;
  localeKey: string | null;
  hreflangsSource: string | null;
  itemsBySlug: Map<string, Record<string, any>>;
}) {
  const selfLocale = normalizeAuditLocaleKey(
    String((localeKey && item[localeKey]) || item.language || item.lang || "en"),
  ) || "en";
  const map = resolveItemLocaleSlugMap(item, localeKey, hreflangsSource);
  const locales = Object.keys(map).sort((a, b) => {
    if (a === selfLocale) return -1;
    if (b === selfLocale) return 1;
    return a.localeCompare(b);
  });

  if (locales.length === 0) {
    return (
      <Badge variant="outline" className="text-xs">
        {selfLocale.toUpperCase()}
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-1 flex-wrap" data-testid={`lang-cell-${item.slug || item.id}`}>
      {locales.map((loc) => {
        const slug = map[loc];
        const isSelf = loc === selfLocale;
        const counterpart = !isSelf ? itemsBySlug.get(slug) : null;
        const missing = !isSelf && !counterpart;

        if (isSelf) {
          return (
            <Badge key={loc} variant="outline" className="text-xs" data-testid={`badge-lang-self-${loc}`}>
              {loc.toUpperCase()}
            </Badge>
          );
        }

        return (
          <Popover key={loc}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-md"
                data-testid={`button-lang-alt-${item.slug}-${loc}`}
              >
                <Badge
                  variant="outline"
                  className={`text-xs cursor-pointer hover-elevate gap-1 ${
                    missing
                      ? "border-amber-500/50 text-amber-700 dark:text-amber-400"
                      : ""
                  }`}
                >
                  {loc.toUpperCase()}
                  {missing && <AlertTriangle className="h-2.5 w-2.5" />}
                </Badge>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3 space-y-2" align="start" data-testid={`popover-lang-alt-${loc}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {loc.toUpperCase()} translation
                </p>
                {missing ? (
                  <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-400">
                    Missing in DB
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">Found</Badge>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">Slug</p>
                <p className="text-xs font-mono break-all">{slug || "—"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">Title</p>
                <p className="text-sm font-medium leading-snug">
                  {counterpart
                    ? String(counterpart.title || counterpart.slug || "—")
                    : missing
                      ? "No matching row for this slug"
                      : "—"}
                </p>
              </div>
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}

type MissingEntry = { slug: string; files: string[] };
type FieldValidationResult = {
  valid: boolean;
  total: number;
  found: number;
  missing: MissingEntry[];
  isNewField?: boolean;
};
type ValidationState = Record<string, FieldValidationResult | "loading" | null>;

function FieldValidationIndicator({ result, optional }: { result: FieldValidationResult | "loading" | null | undefined; optional?: boolean }) {
  if (!result) return null;
  if (result === "loading") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground flex-shrink-0" />;
  }
  if (result.isNewField) {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" data-testid="icon-validation-new-field" />;
  }
  if (result.valid || optional) {
    return <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0" data-testid="icon-validation-valid" />;
  }
  return <AlertTriangle className="h-3.5 w-3.5 text-destructive flex-shrink-0" data-testid="icon-validation-invalid" />;
}

function OptionalFieldHint({ result, fieldKey }: { result: FieldValidationResult | "loading" | null | undefined; fieldKey: string }) {
  if (!result || result === "loading" || result.valid) return null;
  return (
    <p className="text-[11px] text-muted-foreground mt-1" data-testid={`text-optional-hint-${fieldKey}`}>
      Optional — {result.found} of {result.total} {result.total === 1 ? "entry has" : "entries have"} this value.
    </p>
  );
}

function FieldValidationMessage({
  result,
  fieldKey,
  source,
  onSetOptional,
  onBackfill,
}: {
  result: FieldValidationResult | "loading" | null | undefined;
  fieldKey: string;
  source?: string;
  onSetOptional?: () => void;
  onBackfill?: (value: string) => Promise<void>;
}) {
  const [showValueInput, setShowValueInput] = useState(false);
  const [fillValue, setFillValue] = useState("");
  const [filling, setFilling] = useState(false);
  if (!result || result === "loading" || result.valid) return null;
  const displaySource = source || (fieldKey.startsWith("__") ? "" : fieldKey);
  if (!displaySource) return null;
  const allMissing = result.found === 0;
  const hasActions = !!onSetOptional || !!onBackfill;
  return (
    <div className="text-[11px] text-destructive mt-1" data-testid={`text-validation-error-${fieldKey}`}>
      <p>
        Source property "<span className="font-mono font-medium">{displaySource}</span>" was not found in {allMissing ? "any" : "some"} content {result.total === 1 ? "entry" : "entries"}.
        {" "}{allMissing ? "None" : `Only ${result.found}`} of {result.total} {result.total === 1 ? "entry has" : "entries have"} this property, it must be in all entries to become a common mapped field.
        {hasActions && (
          <>
            {" "}You can{" "}
            {onSetOptional ? (
              <button
                type="button"
                className="underline font-medium hover:opacity-80"
                onClick={onSetOptional}
                data-testid={`link-set-optional-${fieldKey}`}
              >
                set it as optional
              </button>
            ) : (
              "set it as optional"
            )}
            {" "}or{" "}
            {onBackfill ? (
              <button
                type="button"
                className="underline font-medium hover:opacity-80"
                onClick={() => setShowValueInput((v) => !v)}
                data-testid={`link-set-value-${fieldKey}`}
              >
                set a value
              </button>
            ) : (
              "set a value"
            )}
            {" "}for all the missing ones right now.
          </>
        )}
      </p>
      {showValueInput && onBackfill && (
        <div className="flex items-center gap-2 mt-1.5" data-testid={`backfill-row-${fieldKey}`}>
          <Input
            value={fillValue}
            onChange={(e) => setFillValue(e.target.value)}
            placeholder={`Value for "${displaySource}" in missing entries`}
            className="text-xs font-mono h-7 flex-1"
            disabled={filling}
            onKeyDown={(e) => {
              if (e.key === "Enter" && fillValue.trim() && !filling) {
                setFilling(true);
                onBackfill(fillValue.trim())
                  .then(() => { setShowValueInput(false); setFillValue(""); })
                  .catch(() => {})
                  .finally(() => setFilling(false));
              }
            }}
            autoFocus
            data-testid={`input-backfill-${fieldKey}`}
          />
          <Button
            size="sm"
            className="h-7 text-[11px]"
            disabled={filling || !fillValue.trim()}
            onClick={() => {
              setFilling(true);
              onBackfill(fillValue.trim())
                .then(() => { setShowValueInput(false); setFillValue(""); })
                .catch(() => {})
                .finally(() => setFilling(false));
            }}
            data-testid={`button-backfill-save-${fieldKey}`}
          >
            {filling ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            disabled={filling}
            onClick={() => { setShowValueInput(false); setFillValue(""); }}
            data-testid={`button-backfill-cancel-${fieldKey}`}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

const KNOWN_SPECIAL_FIELDS = ["_slug", "_locale", "_hreflangs", "_updated_at", "_image"] as const;
/** Must match server SEO_FIELD_MAPPING_KEYS — DB baselines into locale seo: (not dotted seo.*). */
const SEO_DB_MAPPING_ROWS = [
  { mappingKey: "seo_main_keyword", displayPath: "seo.main_keyword", label: "Main keyword", template: "{{ seo.main_keyword }}" },
  { mappingKey: "seo_is_pillar", displayPath: "seo.is_pillar", label: "Is pillar", template: "{{ seo.is_pillar }}" },
  { mappingKey: "seo_pillar_path", displayPath: "seo.pillar_path", label: "Pillar path", template: "{{ seo.pillar_path }}" },
] as const;
const SEO_DB_MAPPING_KEYS = new Set(SEO_DB_MAPPING_ROWS.map((r) => r.mappingKey));
/** Must match server RESERVED_IMAGE_FIELD — preview/OG system special. */
const RESERVED_IMAGE_FIELD = "_image";
const FORBIDDEN_SCHEMA_FIELD = "image";
/** Must match server SLUG_ALIAS_FIELD — runtime alias of `_slug`. */
const FORBIDDEN_SLUG_ALIAS = "slug";
const FORBIDDEN_SCHEMA_FIELDS = new Set([FORBIDDEN_SCHEMA_FIELD, FORBIDDEN_SLUG_ALIAS]);
const SPECIAL_FIELD_DEFAULTS: Record<string, string> = {
  _slug: "slug",
  _locale: "locale",
  _hreflangs: "translations",
  _updated_at: "updated_at",
};

const SPECIAL_FIELD_INFO: Record<
  string,
  { title: string; summary: string; howItWorks: string[]; howToSet: string[]; expected: string }
> = {
  _slug: {
    title: "_slug — Entry identity",
    summary:
      "System field on every content type. Points at the value that uniquely identifies each entry for URL routing and lookups. The resolved value is also available as {{ entry.slug }} (alias). You cannot declare a custom field named slug.",
    howItWorks: [
      "For database types, this is usually a column on each row (e.g. slug).",
      "For static types, default identity is the YAML/folder slug field.",
      "Templates use {{ entry.slug }} or {{ entry._slug }} (both exposed).",
    ],
    howToSet: [
      "Map it to a string field such as slug or id (DB identity).",
      "Or use a computed function: (value, item) => item.slug",
    ],
    expected: "A non-empty string unique per locale (e.g. \"how-to-write-quizzes\").",
  },
  _locale: {
    title: "_locale — Language of the entry",
    summary:
      "System field on every content type. Identifies which language each entry/row belongs to. May be empty on static types when locale comes from the file name. Exposed as {{ entry.locale }} and {{ entry._locale }}.",
    howItWorks: [
      "Each DB row is one locale; _locale tells the system whether the row is en, es, etc.",
      "On static types, locale often comes from the filename (en.yml); mapping locale is optional.",
      "Used when filtering by locale and building locale-aware URLs. Not required for template exposure.",
    ],
    howToSet: [
      "Map it to lang, language, or locale when present on the entry (DB).",
      "Leave empty on static types if locale is implied by the file / URL.",
    ],
    expected: "A site locale code matching url_pattern keys (typically \"en\" or \"es\"), or empty on static.",
  },
  _hreflangs: {
    title: "_hreflangs — Locale → slug map",
    summary:
      "Routing-only system field for alternate URLs when EN/ES (or other) slugs differ. Not available as a template variable. On static types this is read-only — alternates use locale files / slug overrides.",
    howItWorks: [
      "Expects a dictionary: { en: \"english-slug\", es: \"spanish-slug\" }.",
      "getAlternateUrls reads this map for language switching, hreflang, and sitemap alternates.",
      "Static types keep folder / per-locale slug behavior; do not set _hreflangs there.",
      "Do not use {{ entry._hreflangs }} in templates — it is stripped from the single bag.",
    ],
    howToSet: [
      "On DB types: map to a translations-like field or a function.",
      "On static types: not editable — use locale YAML slug overrides instead.",
    ],
    expected:
      "Record<locale, slug> on DB types. Unused on static (read-only).",
  },
  _updated_at: {
    title: "_updated_at — Last content change",
    summary:
      "Editorial clock for sitemap <lastmod>, {{ entry.updated_at }}, Schema.org dateModified, and the manage Updated column. Last time title, meta title/description, or section copy/images changed — not Git or file mtime.",
    howItWorks: [
      "Stored as top-level updated_at on the locale or variant YAML being saved ({directory}/{slug}/{locale}.yml).",
      "Empty values resolve to published_at (first go-live on _common.yml) until this locale is saved; that save writes the seed onto the layer file.",
      "The next real content save (title, meta.page_title, meta.description, section copy/images) sets now and overwrites a manual backdate. SEO-only / robots / redirects / og_image / reorder / layout do not bump.",
      "Mapping key _updated_at defaults to source updated_at. Not .sync-state.json. published_at stays once-only on _common.yml.",
    ],
    howToSet: [
      "On DB types: map to updated_at, modified_at, or a function that returns a date. Whitelist patches stamp the mapped column.",
      "On static types: edit content (or set/backdate updated_at here / via MCP). Next whitelist save overwrites a manual date.",
    ],
    expected: "ISO-8601 UTC string after normalize (e.g. \"2024-03-15T12:30:00.000Z\").",
  },
  _image: {
    title: "_image — Preview / OG image",
    summary:
      "System field for entry list thumbnails and Open Graph. Exposed as {{ entry.image }} and {{ entry._image }}. You cannot declare a custom field named image.",
    howItWorks: [
      "Maps to a URL (or path) on the entry / database row.",
      "When empty, optional preview.component screenshots can fill the gap.",
      "Not indexable or unique.",
    ],
    howToSet: [
      "Activate automatic preview generation on the content type.",
      "Upload a specific image per entry.",
      "Or use Code → Use a function to build a dynamic URL.",
      "On DB types you can also map to an image URL field (e.g. featured_image, og_image).",
    ],
    expected: "A URL string, or empty.",
  },
};

function formatDefaultDisplay(value: string | null | undefined): string {
  if (value === null) return "null";
  if (value === undefined) return "(no default)";
  return JSON.stringify(value);
}

/** Read-only default until clicked; then inline edit with null affordance. */
function ClickToEditDefault({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftIsNull, setDraftIsNull] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setDraftIsNull(value === null);
    setDraft(value === null || value === undefined ? "" : value);
    setEditing(true);
  };

  useEffect(() => {
    if (editing && !draftIsNull) inputRef.current?.focus();
  }, [editing, draftIsNull]);

  const commit = () => {
    onChange(draftIsNull ? null : draft);
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 min-w-0 flex-1" data-testid={`edit-default-${fieldKey}`}>
        <Input
          ref={inputRef}
          value={draftIsNull ? "" : draft}
          onChange={(e) => {
            setDraftIsNull(false);
            setDraft(e.target.value);
          }}
          placeholder="Default value"
          className="text-xs font-mono h-7 flex-1 min-w-0"
          disabled={draftIsNull}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          onBlur={(e) => {
            // Don't commit if clicking null / cancel within the edit group
            const next = e.relatedTarget as HTMLElement | null;
            if (next?.closest(`[data-testid="edit-default-${fieldKey}"]`)) return;
            commit();
          }}
          data-testid={`input-default-${fieldKey}`}
        />
        <Button
          type="button"
          variant={draftIsNull ? "default" : "outline"}
          size="sm"
          className="text-[10px] h-7 flex-shrink-0"
          onClick={() => {
            setDraftIsNull(true);
            setDraft("");
          }}
          data-testid={`button-default-null-${fieldKey}`}
        >
          null
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0"
          onClick={commit}
          data-testid={`button-default-save-${fieldKey}`}
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="flex-1 min-w-0 text-left text-[11px] text-muted-foreground truncate rounded-md px-1.5 py-1 hover:bg-muted/60 focus:outline-none focus:ring-1 focus:ring-ring"
      onClick={startEditing}
      title="Click to edit default"
      data-testid={`button-default-display-${fieldKey}`}
    >
      default: <code className="font-mono">{formatDefaultDisplay(value)}</code>
    </button>
  );
}

/** Code icon menu for choosing how a field value is computed. */
function ComputeModeMenu({
  fieldKey,
  mode,
  onNotComputed,
  onPickField,
  onPickFunction,
  testId,
}: {
  fieldKey: string;
  mode: "none" | "field" | "function";
  onNotComputed: () => void;
  onPickField: () => void;
  onPickFunction: () => void;
  /** Override trigger test id (wizard uses button-toggle-transform-*). */
  testId?: string;
}) {
  const [open, setOpen] = useState(false);

  const pick = (action: () => void) => {
    action();
    setOpen(false);
  };

  const items: {
    id: "none" | "field" | "function";
    label: string;
    info: string;
    testIdSuffix: string;
    onSelect: () => void;
  }[] = [
    {
      id: "none",
      label: "Not computed",
      info: "Use the field as-is (same-name identity). No remap and no function — the default when you only need a fallback default value.",
      testIdSuffix: "none",
      onSelect: onNotComputed,
    },
    {
      id: "field",
      label: "Value from another field",
      info: "Read this property from a different source field or dotted path on the entry / database row.",
      testIdSuffix: "field",
      onSelect: onPickField,
    },
    {
      id: "function",
      label: "Use a function",
      info: "Compute with a JavaScript function (value, item) => result. Runs in a secure sandbox (50ms timeout).",
      testIdSuffix: "function",
      onSelect: onPickFunction,
    },
  ];

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`flex-shrink-0 ${mode !== "none" ? "text-primary" : ""}`}
          title="How to compute this value"
          data-testid={testId ?? `button-code-${fieldKey}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Code className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="z-[10001] w-64 p-1 pointer-events-auto"
        data-testid={`menu-compute-${fieldKey}`}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <TooltipProvider delayDuration={200}>
          <div className="flex flex-col">
            {items.map((item) => {
              const selected = mode === item.id;
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-0.5 rounded-sm ${selected ? "bg-accent/60" : ""}`}
                >
                  <button
                    type="button"
                    className="relative flex flex-1 min-w-0 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                    onClick={() => pick(item.onSelect)}
                    data-testid={`menu-compute-${item.testIdSuffix}-${fieldKey}`}
                  >
                    {selected ? (
                      <Check className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                    ) : (
                      <span className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                    )}
                    <span className="truncate">{item.label}</span>
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="flex-shrink-0 p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent"
                        aria-label={`About ${item.label}`}
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`menu-compute-info-${item.testIdSuffix}-${fieldKey}`}
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="left"
                      className="z-[10002] max-w-[220px] text-xs"
                    >
                      {item.info}
                    </TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}

function SpecialFieldInfoDialog({
  fieldKey,
  open,
  onOpenChange,
}: {
  fieldKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const info = fieldKey ? SPECIAL_FIELD_INFO[fieldKey] : null;
  const title = info?.title ?? (fieldKey ? `${fieldKey} — Special field` : "Special field");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto" data-testid="dialog-special-field-info">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{title}</DialogTitle>
          <DialogDescription>
            {info?.summary ??
              "Underscore-prefixed keys are system fields used for routing and locale linking. slug/locale/image/updated_at are also exposed on {{ entry.* }}; _hreflangs is routing-only."}
          </DialogDescription>
        </DialogHeader>
        {info ? (
          <div className="space-y-4 text-sm">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">How it works</p>
              <ul className="list-disc pl-4 space-y-1.5 text-muted-foreground">
                {info.howItWorks.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">How to set its value</p>
              <ul className="list-disc pl-4 space-y-1.5 text-muted-foreground">
                {info.howToSet.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Expected value</p>
              <p className="text-muted-foreground font-mono text-xs bg-muted rounded-md px-3 py-2">{info.expected}</p>
            </div>
          </div>
        ) : fieldKey ? (
          <p className="text-sm text-muted-foreground">
            <code className="font-mono bg-muted px-1 rounded">{fieldKey}</code> is a custom special field.
            Underscore keys are reserved for system use and are not available as{" "}
            <code className="font-mono bg-muted px-1 rounded">{"{{ entry.* }}"}</code> variables.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-special-field-info">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldMappingDialog({
  open,
  onOpenChange,
  contentType,
  onRequestStrategy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: string;
  /** Open the type Strategy dialog (required before marking fields required). */
  onRequestStrategy?: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [specialInfoKey, setSpecialInfoKey] = useState<string | null>(null);
  const [previewConfigOpen, setPreviewConfigOpen] = useState(false);
  const reopenMappingAfterPreviewRef = useRef(false);
  const skipNextConfigHydrateRef = useRef(false);
  const label = contentType.charAt(0).toUpperCase() + contentType.slice(1);

  const { data: config, isLoading } = useQuery<ContentTypeConfig>({
    queryKey: ["/api/content-types", contentType, "config"],
    queryFn: () => fetch(`/api/content-types/${contentType}/config`).then(r => r.json()),
    enabled: open,
  });

  const isDbBacked = !!config?.database?.slug;

  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [fieldDefaults, setFieldDefaults] = useState<Record<string, string | null>>({});
  const [indexedFields, setIndexedFields] = useState<string[]>([]);
  const [uniqueFields, setUniqueFields] = useState<string[]>(["slug"]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDefault, setNewDefault] = useState("");
  const [newDefaultIsNull, setNewDefaultIsNull] = useState(false);
  const [defaultSpecified, setDefaultSpecified] = useState(false);
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [showAddField, setShowAddField] = useState(false);
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);
  const [transformerModes, setTransformerModes] = useState<Record<string, boolean>>({});
  const [customModes, setCustomModes] = useState<Record<string, boolean>>({});
  /** YAML: show source picker for a field (map from another field). */
  const [remapModes, setRemapModes] = useState<Record<string, boolean>>({});
  const [optionalFields, setOptionalFields] = useState<Record<string, boolean>>({});
  const [newOptional, setNewOptional] = useState(false);
  const [validation, setValidation] = useState<ValidationState>({});
  const [newValueValidation, setNewValueValidation] = useState<FieldValidationResult | "loading" | null>(null);
  const [editorHints, setEditorHints] = useState<Record<string, EditorHint>>({});
  const [hintDialogField, setHintDialogField] = useState<string | null>(null);
  /** Field key pending Required-for-publish confirm (asterisk). */
  const [pendingRequiredField, setPendingRequiredField] = useState<string | null>(null);
  const [showFillFromAdvanced, setShowFillFromAdvanced] = useState(false);
  const [schemaEducationOpen, setSchemaEducationOpen] = useState(false);
  const [seoEducationOpen, setSeoEducationOpen] = useState(false);
  const [showSeoAdvanced, setShowSeoAdvanced] = useState(false);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const requestCounters = useRef<Record<string, number>>({});

  const dbSlugForHints = config?.database?.slug;
  const { data: hintPreviewData, isLoading: hintPreviewLoading } = useQuery<{
    items: Record<string, unknown>[];
  }>({
    queryKey: [`/api/databases/${dbSlugForHints}/items`, "hint-preview"],
    queryFn: () =>
      fetch(`/api/databases/${dbSlugForHints}/items?page=1&limit=100`).then((r) => r.json()),
    enabled: hintDialogField !== null && !!dbSlugForHints,
    staleTime: 60_000,
  });

  /** Remap DB items onto content-type field names so preview matches editor keys. */
  const hintPreviewItems = useMemo(() => {
    const items = hintPreviewData?.items;
    if (!items) return undefined;
    return items.map((item) => {
      const out: Record<string, unknown> = {};
      for (const [ctKey, source] of Object.entries(mappings)) {
        if (transformerModes[ctKey] || !source) continue;
        out[ctKey] = source.includes(".")
          ? getValueByDotPath(item, source)
          : item[source];
      }
      return out;
    });
  }, [hintPreviewData?.items, mappings, transformerModes]);

  const { data: staticHintPreviewData, isLoading: staticHintPreviewLoading } = useQuery<{
    results?: Record<string, unknown>[];
  }>({
    queryKey: ["/api/content-types", contentType, "items", "hint-preview"],
    queryFn: () =>
      fetch(`/api/content-types/${encodeURIComponent(contentType)}/items?limit=200`).then((r) =>
        r.json(),
      ),
    enabled: hintDialogField !== null && !dbSlugForHints,
    staleTime: 60_000,
  });

  const staticHintPreviewItems = staticHintPreviewData?.results;
  const hintExistingItems = dbSlugForHints ? hintPreviewItems : staticHintPreviewItems;
  const hintExistingItemsLoading = dbSlugForHints
    ? hintPreviewLoading
    : staticHintPreviewLoading;

  // All source props — used in the editing dropdown for existing rows
  const { data: allAvailableProps } = useQuery<{ common: string[]; partial: { key: string; count: number; total: number }[] }>({
    queryKey: ["/api/content-types", contentType, "available-properties-all"],
    queryFn: () => fetch(`/api/content-types/${contentType}/available-properties`).then(r => r.json()),
    enabled: open,
  });

  // Raw DB columns — needed so specials/custom Fill-from can pick unmapped source keys
  const { data: dbRawFieldsData } = useQuery<{ fields: string[] }>({
    queryKey: ["/api/databases", dbSlugForHints, "raw-fields"],
    queryFn: () => fetch(`/api/databases/${dbSlugForHints}/raw-fields`).then((r) => r.json()),
    enabled: open && !!dbSlugForHints,
    staleTime: 60_000,
  });

  const mergedSourceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const k of allAvailableProps?.common ?? []) set.add(k);
    for (const k of dbRawFieldsData?.fields ?? []) set.add(k);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allAvailableProps?.common, dbRawFieldsData?.fields]);

  // Unmapped props only — used in the "add new field" combobox
  const { data: availableProps } = useQuery<{ common: string[]; partial: { key: string; count: number; total: number }[] }>({
    queryKey: ["/api/content-types", contentType, "available-properties-exclude-mapped"],
    queryFn: () => fetch(`/api/content-types/${contentType}/available-properties?exclude_mapped=true`).then(r => r.json()),
    enabled: open,
  });

  useEffect(() => {
    if (!open || !config) return;
    if (skipNextConfigHydrateRef.current) {
      skipNextConfigHydrateRef.current = false;
      return;
    }
    const fm: Record<string, string> = {};
    const tmodes: Record<string, boolean> = {};
    const optFields: Record<string, boolean> = {};
    const defaults: Record<string, string | null> = {};
    if (config.field_mapping) {
      for (const [k, v] of Object.entries(config.field_mapping)) {
        if (typeof v === "string") {
          if (v.startsWith("function:")) {
            fm[k] = atob(v.slice(9));
            tmodes[k] = true;
          } else if (v.startsWith("?")) {
            fm[k] = v.slice(1);
            optFields[k] = true;
          } else {
            fm[k] = v;
          }
        } else if (v && typeof v === "object" && "source" in v) {
          if (typeof v.source === "string" && v.source.startsWith("?")) {
            fm[k] = v.source.slice(1);
            optFields[k] = true;
          } else {
            fm[k] = v.source;
          }
          if ("default" in v) {
            defaults[k] = v.default as string | null;
          }
        }
      }
    }
    // System specials on every type (DB and static)
    for (const key of KNOWN_SPECIAL_FIELDS) {
      if (!(key in fm)) {
        if (key === "_hreflangs" && !config.database?.slug) {
          fm[key] = "";
        } else if (key === "_image") {
          fm[key] = "";
        } else {
          fm[key] = SPECIAL_FIELD_DEFAULTS[key] ?? "";
        }
      }
    }
    // Migrate legacy plain image → _image
    if ("image" in fm) {
      if (!fm[RESERVED_IMAGE_FIELD]) fm[RESERVED_IMAGE_FIELD] = fm.image;
      delete fm.image;
    }
    // Migrate legacy plain slug → _slug
    if ("slug" in fm) {
      if (!fm._slug) fm._slug = fm.slug;
      delete fm.slug;
    }
    // Migrate legacy plain updated_at → _updated_at
    if ("updated_at" in fm) {
      if (!fm._updated_at) fm._updated_at = fm.updated_at;
      delete fm.updated_at;
    }
    setMappings(fm);
    setFieldDefaults(defaults);
    setTransformerModes(tmodes);
    setOptionalFields(optFields);
    setNewOptional(false);
    // A source is "custom" if it contains a dot (dotted path like author.name)
    const cmodes: Record<string, boolean> = {};
    const rmodes: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(fm)) {
      if (!tmodes[k] && v.includes(".")) cmodes[k] = true;
      // Non-identity source = remap (YAML shows source picker)
      if (!tmodes[k] && !k.startsWith("_") && v && v !== k) rmodes[k] = true;
    }
    setCustomModes(cmodes);
    setRemapModes(rmodes);
    setIndexedFields(stripLocaleIndexFields(config.indexes || []) || []);
    setEditorHints(config.editor || {});
    setUniqueFields(config.unique_fields ?? ["slug"]);
    setValidation({});
    setShowAddField(false);
    setPendingDeleteKey(null);
    setShowFillFromAdvanced(false);
    requestCounters.current = {};
  }, [open, config]);

  const validateSingleField = (key: string, source: string) => {
    if (isDbBacked || !source || key.startsWith("_")) return;
    const reqId = (requestCounters.current[key] || 0) + 1;
    requestCounters.current[key] = reqId;
    setValidation((prev) => ({ ...prev, [key]: "loading" }));
    fetch(`/api/content-types/${contentType}/validate-field?source=${encodeURIComponent(source)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((result: FieldValidationResult | null) => {
        if (requestCounters.current[key] !== reqId) return;
        if (!result) {
          setValidation((prev) => ({ ...prev, [key]: null }));
          return;
        }
        // Identity schema: always valid; warn when no entry has the key
        if (source === key) {
          setValidation((prev) => ({
            ...prev,
            [key]: {
              ...result,
              valid: true,
              isNewField: result.total > 0 && result.found === 0,
              missing: result.found === 0 ? [] : result.missing,
            },
          }));
          return;
        }
        setValidation((prev) => ({ ...prev, [key]: result }));
      })
      .catch(() => {
        if (requestCounters.current[key] !== reqId) return;
        setValidation((prev) => ({ ...prev, [key]: null }));
      });
  };

  const debouncedValidate = (key: string, source: string) => {
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(() => validateSingleField(key, source), 500);
  };

  useEffect(() => {
    if (!config || isDbBacked) return;
    const rawMapping: Record<string, string> = {};
    if (config.field_mapping) {
      for (const [k, v] of Object.entries(config.field_mapping)) {
        if (typeof v === "string" && !v.startsWith("function:") && !k.startsWith("_")) {
          rawMapping[k] = v.startsWith("?") ? v.slice(1) : v;
        }
      }
    }
    if (Object.keys(rawMapping).length === 0) return;
    const bulkReqId = Date.now();
    requestCounters.current["__bulk"] = bulkReqId;
    fetch(`/api/content-types/${contentType}/validate-mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field_mapping: rawMapping }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data: { results: Record<string, FieldValidationResult> } | null) => {
        if (requestCounters.current["__bulk"] !== bulkReqId || !data) return;
        setValidation(data.results || {});
      })
      .catch(() => {});
  }, [config, contentType, isDbBacked]);

  const handleSourceChange = (key: string, value: string) => {
    setMappings((prev) => ({ ...prev, [key]: value }));
    if (!transformerModes[key] && !key.startsWith("_") && !isDbBacked) {
      debouncedValidate(key, value);
    }
  };

  const validateNewValue = (source: string) => {
    if (isDbBacked || !source) {
      setNewValueValidation(null);
      return;
    }
    const reqId = (requestCounters.current["__new"] || 0) + 1;
    requestCounters.current["__new"] = reqId;
    setNewValueValidation("loading");
    fetch(`/api/content-types/${contentType}/validate-field?source=${encodeURIComponent(source)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((result: FieldValidationResult | null) => {
        if (requestCounters.current["__new"] !== reqId) return;
        setNewValueValidation(result);
      })
      .catch(() => {
        if (requestCounters.current["__new"] !== reqId) return;
        setNewValueValidation(null);
      });
  };

  const debouncedValidateNew = (source: string) => {
    if (debounceTimers.current["__new"]) clearTimeout(debounceTimers.current["__new"]);
    debounceTimers.current["__new"] = setTimeout(() => validateNewValue(source), 500);
  };

  const handleNewValueChange = (value: string) => {
    setNewValue(value);
    debouncedValidateNew(value.trim() || newKey.trim());
  };

  const filteredAvailableProps = (() => {
    if (!availableProps) return { common: [], partial: [] };
    const q = newValue.toLowerCase().trim();
    if (!q) return availableProps;
    return {
      common: availableProps.common.filter(k => k.toLowerCase().includes(q)),
      partial: availableProps.partial.filter(p => p.key.toLowerCase().includes(q)),
    };
  })();

  const handleBackfill = async (key: string, source: string, value: string) => {
    const res = await fetch(`/api/content-types/${contentType}/backfill-property`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, value }),
    });
    let data: Record<string, unknown> = {};
    try { data = await res.json(); } catch { /* non-JSON response */ }
    if (!res.ok) {
      toast({ title: (data.error as string) || "Failed to set value on missing entries", variant: "destructive" });
      throw new Error("backfill failed");
    }
    const updated = (data.updated as number) ?? 0;
    toast({ title: `Value set on ${updated} ${updated === 1 ? "entry" : "entries"}` });
    if (key === "__new") {
      validateNewValue(source);
    } else {
      validateSingleField(key, source);
    }
    queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "available-properties-all"] });
    queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "available-properties-exclude-mapped"] });
  };

  const handleAddField = () => {
    const key = newKey.trim();
    if (!key || key in mappings) return;
    if (FORBIDDEN_SCHEMA_FIELDS.has(key) || key === RESERVED_IMAGE_FIELD || key.startsWith("_")) {
      toast({
        title: key === FORBIDDEN_SCHEMA_FIELD
          ? `Use system field ${RESERVED_IMAGE_FIELD} for preview/OG (aliased to {{ entry.image }})`
          : key === FORBIDDEN_SLUG_ALIAS
            ? "Use system field _slug for entry identity (aliased to {{ entry.slug }})"
            : "Reserved or system field names cannot be added here",
        variant: "destructive",
      });
      return;
    }
    if (!defaultSpecified) {
      toast({
        title: "Default required",
        description: "Specify a default value for the new schema field (or set it to null).",
        variant: "destructive",
      });
      return;
    }
    // Static types: schema key = YAML parent key (identity). Remaps only for DB.
    const source = isDbBacked ? (newValue.trim() || key) : key;
    setMappings((prev) => ({ ...prev, [key]: source }));
    setFieldDefaults((prev) => ({
      ...prev,
      [key]: newDefaultIsNull ? null : newDefault,
    }));
    if (newOptional) {
      setOptionalFields((prev) => ({ ...prev, [key]: true }));
    }
    if (newValueValidation && newValueValidation !== "loading") {
      setValidation((prev) => ({ ...prev, [key]: newValueValidation }));
    } else if (!isDbBacked && !key.startsWith("_")) {
      validateSingleField(key, source);
    }
    setNewKey("");
    setNewValue("");
    setNewDefault("");
    setNewDefaultIsNull(false);
    setDefaultSpecified(false);
    setNewOptional(false);
    setNewValueValidation(null);
    setSourceDropdownOpen(false);
    setShowAddField(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const fullMapping: Record<string, string | { source: string; default: string | null }> = {};
      for (const [k, v] of Object.entries(mappings)) {
        if (FORBIDDEN_SCHEMA_FIELDS.has(k)) continue;
        if (k.startsWith("seo.") || k === "seo.pillar") continue;
        // Static regular fields: force identity (no rename)
        const sourceValue = !isDbBacked && !k.startsWith("_") && !transformerModes[k] && !SEO_DB_MAPPING_KEYS.has(k)
          ? k
          : v;
        if (sourceValue || KNOWN_SPECIAL_FIELDS.includes(k as typeof KNOWN_SPECIAL_FIELDS[number])) {
          const encoded = transformerModes[k]
            ? "function:" + btoa(sourceValue || "")
            : (optionalFields[k] && sourceValue ? "?" + sourceValue : sourceValue || "");
          if (!k.startsWith("_") && !SEO_DB_MAPPING_KEYS.has(k) && k in fieldDefaults) {
            fullMapping[k] = { source: encoded, default: fieldDefaults[k] };
          } else {
            fullMapping[k] = encoded;
          }
        }
      }

      const safeIndexes = stripLocaleIndexFields(
        indexedFields.filter(
          (f) => f !== FORBIDDEN_SCHEMA_FIELD && f !== RESERVED_IMAGE_FIELD && !f.startsWith("_"),
        ),
      );
      const safeUnique = uniqueFields.filter(
        (f) => f !== FORBIDDEN_SCHEMA_FIELD && f !== RESERVED_IMAGE_FIELD && !f.startsWith("_"),
      );

      const payload = {
        field_mapping: Object.keys(fullMapping).length > 0 ? fullMapping : undefined,
        editor: Object.keys(editorHints).length > 0 ? editorHints : null,
        indexes: safeIndexes.length > 0 ? safeIndexes : undefined,
        unique_fields: safeUnique,
      };

      const res = await fetch(`/api/content-types/${contentType}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data: Record<string, unknown> = {};
      try { data = await res.json(); } catch { /* non-JSON response */ }

      if (!res.ok) {
        if (data.validation && typeof data.validation === "object") {
          setValidation((prev) => ({ ...prev, ...(data.validation as Record<string, FieldValidationResult>) }));
        }
        toast({ title: (data.error as string) || "Failed to save field mappings", variant: "destructive" });
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });
      const newFieldWarnings = Object.entries(validation)
        .filter(([, r]) => r && r !== "loading" && (r as FieldValidationResult).isNewField)
        .map(([k]) => k);
      toast({
        title: `${label} fields saved`,
        description: newFieldWarnings.length
          ? `New schema fields (not yet on entries): ${newFieldWarnings.join(", ")}`
          : undefined,
      });
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to save field mappings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const allowAttachedRequiredMode = !!config?.single_template || !!config?.database?.slug;

  const applyRequiredMode = useCallback(
    (field: string, nextRequired: RequiredMode): boolean => {
      if (nextRequired !== false) {
        if (!isValidContentTypeStrategy(config?.strategy)) {
          toast({
            title: "Content type strategy required",
            description:
              "Set a type strategy (non-empty purpose) before marking fields required.",
            variant: "destructive",
          });
          onRequestStrategy?.();
          return false;
        }
        const cur = editorHints[field] || {};
        if (!isValidFillIntent(cur.fill_intent)) {
          toast({
            title: "Fill intent required",
            description:
              "Set fill_intent (goal + purpose) in field settings before marking this field required.",
            variant: "destructive",
          });
          setHintDialogField(field);
          return false;
        }
      }
      setEditorHints((prev) => {
        const cur = prev[field] || {};
        if (nextRequired === false) {
          const { required: _r, ...rest } = cur;
          if (Object.keys(rest).length === 0) {
            const clone = { ...prev };
            delete clone[field];
            return clone;
          }
          return { ...prev, [field]: rest };
        }
        return { ...prev, [field]: { ...cur, required: nextRequired } };
      });
      return true;
    },
    [config?.strategy, editorHints, onRequestStrategy, toast],
  );

  const handleRequiredFieldClick = useCallback(
    (field: string) => {
      if (!readSkipRequiredConfirm()) {
        setPendingRequiredField(field);
        return;
      }
      const current = normalizeRequiredMode(editorHints[field]?.required);
      const next = nextRequiredMode(current, allowAttachedRequiredMode);
      applyRequiredMode(field, next);
    },
    [allowAttachedRequiredMode, applyRequiredMode, editorHints],
  );

  const regularKeys = Object.keys(mappings).filter(
    (k) => !k.startsWith("_") && !FORBIDDEN_SCHEMA_FIELDS.has(k) && !SEO_DB_MAPPING_KEYS.has(k),
  );
  const specialKeys = Array.from(
    new Set<string>([...KNOWN_SPECIAL_FIELDS, ...Object.keys(mappings).filter((k) => k.startsWith("_"))]),
  );
  // Always show Fill from (source) for custom fields — unified schema model
  const showSourceEditor = isDbBacked;

  const defaultFunctionBody = (key: string) => {
    if (key === "_slug") return "(value, item) => item.slug";
    if (key === "_locale") return "(value) => value === 'us' ? 'en' : value";
    if (key === "_hreflangs") return "(value, item) => item.translations";
    if (key === "_updated_at") return "(value, item) => item.updated_at";
    if (key === "_image") return "(value, item) => value";
    return "(value, item) => value";
  };

  const enterFunctionMode = (key: string) => {
    setCustomModes((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setRemapModes((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setTransformerModes((prev) => ({ ...prev, [key]: true }));
    setMappings((prev) => {
      const cur = prev[key] || "";
      // Don't keep a plain field path as function source text
      const looksLikeFn = cur.includes("=>") || cur.includes("return ");
      return {
        ...prev,
        [key]: looksLikeFn ? cur : defaultFunctionBody(key),
      };
    });
    setValidation((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const exitFunctionMode = (key: string) => {
    setTransformerModes((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const fallback = key.startsWith("_")
      ? (SPECIAL_FIELD_DEFAULTS[key] ?? "")
      : key;
    setMappings((prev) => ({ ...prev, [key]: fallback }));
    setRemapModes((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (!isDbBacked && !key.startsWith("_") && fallback) {
      validateSingleField(key, fallback);
    }
  };

  const enterRemapMode = (key: string) => {
    setTransformerModes((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setRemapModes((prev) => ({ ...prev, [key]: true }));
    setMappings((prev) => {
      const cur = prev[key] || "";
      const looksLikeFn = cur.includes("=>") || cur.includes("return ");
      // Keep an existing field path; don't leave a function body as the source
      return { ...prev, [key]: looksLikeFn ? key : (cur || key) };
    });
    if (!isDbBacked && !key.startsWith("_")) {
      const cur = mappings[key] || key;
      const looksLikeFn = cur.includes("=>") || cur.includes("return ");
      validateSingleField(key, looksLikeFn ? key : cur);
    }
  };

  const resetComputeMode = (key: string) => {
    setTransformerModes((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setRemapModes((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setCustomModes((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const fallback = key.startsWith("_")
      ? (SPECIAL_FIELD_DEFAULTS[key] ?? "")
      : key;
    setMappings((prev) => ({ ...prev, [key]: fallback }));
    if (!isDbBacked && !key.startsWith("_") && fallback) {
      validateSingleField(key, fallback);
    }
  };

  const renderSourceEditor = (
    key: string,
    opts?: { allowEmpty?: boolean; hideOptionalToggle?: boolean; hideFunctionOption?: boolean },
  ) => {
    const isFn = !!transformerModes[key];
    const isCustom = !!customModes[key];
    const isSpecial = key.startsWith("_");
    const isSeoDbMap = SEO_DB_MAPPING_KEYS.has(key);
    const vResult = isFn ? null : validation[key];
    const currentSrc = mappings[key] || "";
    const selectOptions = mergedSourceOptions;
    const sameNameKey = isSpecial || isSeoDbMap ? null : key;
    const currentInList =
      !currentSrc ||
      selectOptions.includes(currentSrc) ||
      (!!sameNameKey && currentSrc === sameNameKey);
    const extraOption = currentSrc && !currentInList ? currentSrc : null;
    const selectValue =
      key === "_image" && !currentSrc && !!config?.preview?.component
        ? "__auto_preview__"
        : currentSrc
          ? currentSrc
          : opts?.allowEmpty
            ? "__none__"
            : sameNameKey || "__none__";
    return (
      <>
        {isFn ? (
          <div className="flex-1 flex items-start gap-1">
            <div className="flex-1 space-y-1">
              <p className="text-[10px] text-muted-foreground font-mono">(value, item) =&gt; ...</p>
              <Textarea
                value={currentSrc}
                onChange={(e) => setMappings((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder="(value, item) => value"
                className="text-xs font-mono min-h-[3rem] resize-y"
                data-testid={`textarea-transform-${key}`}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="flex-shrink-0 text-muted-foreground mt-4"
              title="Pick from list"
              onClick={() => exitFunctionMode(key)}
              data-testid={`button-pick-from-list-${key}`}
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : isCustom ? (
          <div className="flex-1 flex items-center gap-1">
            <Input
              value={currentSrc}
              onChange={(e) => handleSourceChange(key, e.target.value)}
              placeholder="path.to.field"
              className="text-xs font-mono flex-1"
              data-testid={`input-mapping-${key}`}
              autoFocus
            />
            <Button
              variant="ghost"
              size="icon"
              className="flex-shrink-0 text-muted-foreground"
              title="Pick from list"
              onClick={() => {
                setCustomModes((prev) => { const n = { ...prev }; delete n[key]; return n; });
                if (selectOptions.length) {
                  handleSourceChange(key, sameNameKey || selectOptions[0] || "");
                }
              }}
              data-testid={`button-pick-from-list-${key}`}
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Select
            value={selectValue}
            onValueChange={(v) => {
              if (v === "__auto_preview__") {
                handleSourceChange(key, "");
                reopenMappingAfterPreviewRef.current = true;
                skipNextConfigHydrateRef.current = true;
                onOpenChange(false);
                window.setTimeout(() => setPreviewConfigOpen(true), 150);
              } else if (v === "__function__") {
                enterFunctionMode(key);
              } else if (v === "__custom__") {
                setCustomModes((prev) => ({ ...prev, [key]: true }));
                setMappings((prev) => ({ ...prev, [key]: "" }));
              } else if (v === "__none__") {
                handleSourceChange(key, "");
              } else {
                if ((allAvailableProps?.partial ?? []).some((p) => p.key === v)) {
                  setOptionalFields((prev) => ({ ...prev, [key]: true }));
                }
                handleSourceChange(key, v);
              }
            }}
          >
            <SelectTrigger className="flex-1 text-xs font-mono h-9" data-testid={`select-mapping-${key}`}>
              <SelectValue placeholder="Select source…" />
            </SelectTrigger>
            <SelectContent>
              {(opts?.allowEmpty || selectValue === "__none__") && (
                <SelectItem value="__none__" className="text-xs font-mono text-muted-foreground">
                  (none)
                </SelectItem>
              )}
              {key === "_image" && (
                <SelectItem value="__auto_preview__" className="text-xs font-mono">
                  Activate automatic preview…
                </SelectItem>
              )}
              {extraOption && (
                <SelectItem key={extraOption} value={extraOption} className="text-xs font-mono">
                  <span className="flex items-center gap-2">
                    <Check className="h-3 w-3 text-green-600 flex-shrink-0" />
                    {extraOption}
                  </span>
                </SelectItem>
              )}
              {sameNameKey && !selectOptions.includes(sameNameKey) && sameNameKey !== extraOption && (
                <SelectItem value={sameNameKey} className="text-xs font-mono">
                  <span className="flex items-center gap-2">
                    <Check className="h-3 w-3 text-green-600 flex-shrink-0" />
                    {sameNameKey}
                    <span className="text-[10px] text-muted-foreground">(same name)</span>
                  </span>
                </SelectItem>
              )}
              {selectOptions.map((opt) => (
                <SelectItem key={opt} value={opt} className="text-xs font-mono">
                  <span className="flex items-center gap-2">
                    <Check className="h-3 w-3 text-green-600 flex-shrink-0" />
                    {opt}
                  </span>
                </SelectItem>
              ))}
              {(allAvailableProps?.partial ?? []).map((p) => (
                <SelectItem key={p.key} value={p.key} className="text-xs font-mono">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                    {p.key}
                    <span className="text-[10px] text-muted-foreground">{p.count}/{p.total} — added as optional</span>
                  </span>
                </SelectItem>
              ))}
              <SelectItem value="__custom__" className="text-xs font-mono text-muted-foreground italic">
                Custom path…
              </SelectItem>
              {!opts?.hideFunctionOption && (
                <SelectItem value="__function__" className="text-xs font-mono text-muted-foreground italic">
                  Compute with function…
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )}
        {!isFn && !isDbBacked && !isSpecial && currentSrc !== key && (
          <FieldValidationIndicator result={vResult} optional={!!optionalFields[key]} />
        )}
        {!isFn && !isDbBacked && !opts?.hideOptionalToggle && currentSrc !== key && (
          <Button
            variant="ghost"
            size="icon"
            className={`flex-shrink-0 ${optionalFields[key] ? "text-primary" : ""}`}
            title={optionalFields[key] ? "Optional field — not required in all entries. Click to make it required." : "Make optional — allow entries without this property"}
            onClick={() => {
              setOptionalFields((prev) => {
                const next = { ...prev };
                if (next[key]) delete next[key];
                else next[key] = true;
                return next;
              });
            }}
            data-testid={`button-toggle-optional-${key}`}
          >
            <CircleDashed className="h-3.5 w-3.5" />
          </Button>
        )}
      </>
    );
  };

  const renderDeleteConfirm = (key: string) => (
    pendingDeleteKey === key && (
      <div className="flex items-center gap-2 ml-[7.5rem] text-[11px] mt-1" data-testid={`confirm-delete-${key}`}>
        <span className="text-muted-foreground">
          Remove &quot;<span className="font-mono font-medium">{key}</span>&quot;{" "}
          {isDbBacked ? "mapping" : "field"}? Values in your YML files will not be affected.
        </span>
        <Button
          variant="destructive"
          size="sm"
          className="text-[11px]"
          onClick={() => {
            setMappings((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
            setTransformerModes((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
            setRemapModes((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
            setCustomModes((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
            setFieldDefaults((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
            setOptionalFields((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
            setValidation((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
            setIndexedFields((prev) => prev.filter((f) => f !== key));
            setUniqueFields((prev) => prev.filter((f) => f !== key));
            setPendingDeleteKey(null);
          }}
          data-testid={`button-confirm-delete-${key}`}
        >
          Remove
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-[11px]"
          onClick={() => setPendingDeleteKey(null)}
          data-testid={`button-cancel-delete-${key}`}
        >
          Cancel
        </Button>
      </div>
    )
  );

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{label} Fields</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : (
          <div className="space-y-5">
            <div
              className="rounded-md border border-border bg-muted/20 p-3 space-y-3 text-sm text-muted-foreground"
              data-testid="fields-schema-education"
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                onClick={() => setSchemaEducationOpen((v) => !v)}
                aria-expanded={schemaEducationOpen}
                data-testid="button-toggle-fields-schema-education"
              >
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  What are content type fields?
                </p>
                <IconChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${schemaEducationOpen ? "rotate-180" : ""}`}
                />
              </button>

              {schemaEducationOpen && (
                <div className="space-y-2">
              <p>
                Adding fields to your {contentType} helps you describe each entry better. It also increases
                AI agents&apos; efficiency: agents read each field&apos;s{" "}
                <code className="font-mono bg-muted px-1 rounded text-xs">fill_intent</code>{" "}
                (goal and purpose) and try to set the right values. Purpose is also shown as the
                hint in the item editor. Field values then become accessible through{" "}
                <code className="font-mono bg-muted px-1 rounded text-xs">{"{{ entry.field_name }}"}</code>{" "}
                in the entry YAML file.
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
                onClick={() => setShowFillFromAdvanced((v) => !v)}
                data-testid="button-toggle-fields-advanced"
              >
                {showFillFromAdvanced ? "Hide advanced details" : "Read more (advanced)"}
                <IconChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${showFillFromAdvanced ? "rotate-180" : ""}`}
                />
              </button>
              {showFillFromAdvanced && (
                <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2 text-xs">
                  <p>
                    Declare schema fields for this type. A YAML parent key becomes{" "}
                    <code className="font-mono bg-muted px-1 rounded text-xs">{"{{ entry.fieldName }}"}</code>{" "}
                    when added here. New fields require a default (including <code className="font-mono text-xs">null</code>).
                    SEO head keys use the Meta tab and{" "}
                    <code className="font-mono bg-muted px-1 rounded text-xs">{"{{ meta.* }}"}</code>.
                    Cluster strategy fields are in the SEO fields block below (
                    <code className="font-mono bg-muted px-1 rounded text-xs">{"{{ seo.main_keyword }}"}</code>
                    ). On database-backed types you can map a DB column as the baseline (
                    <code className="font-mono bg-muted px-1 rounded text-xs">seo_main_keyword</code> etc.);
                    locale YAML still wins. URL / query values use{" "}
                    <code className="font-mono bg-muted px-1 rounded text-xs">{"{{ param.* }}"}</code>.
                  </p>
                  {contentType === "authors" && (
                    <div
                      className="rounded-md border border-border bg-muted/50 px-3 py-2 space-y-1.5"
                      data-testid="fields-authors-person-education"
                    >
                      <p className="font-medium text-foreground">Authors = Schema.org Person</p>
                      <p>
                        These fields map to a public Person entity (author hubs + BlogPosting.author). Fill for E-E-A-T:
                        stable <code className="font-mono">name</code>, optional <code className="font-mono">jobTitle</code>,
                        short <code className="font-mono">description</code> (bio), <code className="font-mono">sameAs</code>{" "}
                        profile URLs, <code className="font-mono">worksFor</code>, <code className="font-mono">knowsAbout</code>{" "}
                        topics, and a real portrait. Slug is immutable; default author{" "}
                        <code className="font-mono">4geeks-academy</code> is undeletable. Blog posts only store slug
                        pointers in <code className="font-mono">authors: []</code> — never paste Person JSON into blog.
                      </p>
                      <p>
                        Agent playbook: <code className="font-mono">explain_site</code> topic{" "}
                        <code className="font-mono">relation-fields</code>; field specs live in each field&apos;s{" "}
                        <code className="font-mono">fill_intent</code> purpose (sliders icon) and below.
                      </p>
                    </div>
                  )}
                  <p data-testid="fields-compute-education">
                    The <strong className="font-medium text-foreground">default</strong> is the fallback when an entry has no value
                    (click it to edit). Use the <strong className="font-medium text-foreground">Code</strong> button to compute
                    the live value from another field or a function{" "}
                    <code className="font-mono bg-muted px-1 rounded text-xs">(value, item) =&gt; result</code>.
                  </p>
                  <p>
                    UI: <code className="font-mono">client/src/pages/ContentTypeManagePage.tsx</code>{" "}
                    (<code className="font-mono">FieldMappingDialog</code>. Stored in{" "}
                    <code className="font-mono">content-types.yml</code>{" "}
                    <code className="font-mono">field_mapping</code> as a path string,{" "}
                    <code className="font-mono">{"{ source, default }"}</code>, or{" "}
                    <code className="font-mono">function:</code>-prefixed base64 for calculated fields /
                    <code className="font-mono">editor</code> hints. Remap sources only when a database is
                    attached (column → schema key), or via Code → Value from another field on static types.
                    System identity (<code className="font-mono">slug</code>,{" "}
                    <code className="font-mono">locale</code>, <code className="font-mono">image</code> and
                    underscore forms) is auto-exposed on{" "}
                    <code className="font-mono">{"{{ entry.* }}"}</code>;{" "}
                    <code className="font-mono">_hreflangs</code> is routing-only.{" "}
                    <code className="font-mono">_updated_at</code> is last <strong className="font-medium text-foreground">content</strong> change
                    (title, meta title/description, section copy/images) on locale YAML{" "}
                    <code className="font-mono">updated_at</code>
                    — not Git. Empty uses first-publish until this locale is saved. Do not add fields named{" "}
                    <code className="font-mono">slug</code> or <code className="font-mono">image</code> — use{" "}
                    <code className="font-mono">_slug</code> / <code className="font-mono">_image</code>{" "}
                    for DB identity config.
                  </p>
                  <p>
                    Static types (no database): Fields writes <strong>top-level keys</strong> on{" "}
                    <code className="font-mono">{"{directory}/{slug}/{locale}.yml"}</code> (or a variant
                    file when previewing with <code className="font-mono">?variant=</code>). The API path is
                    still <code className="font-mono">field-overrides</code>, but static entries do not use a{" "}
                    <code className="font-mono">field_overrides</code> bag. DB-backed types still store CT
                    overlays under <code className="font-mono">field_overrides</code>.
                  </p>
                  <p>
                    Asterisk (<code className="font-mono">editor.required</code>): double{" "}
                    <strong className="font-medium text-foreground">**</strong> = required for
                    publish on all live entries; single{" "}
                    <strong className="font-medium text-foreground">*</strong> = required only
                    when the entry uses the shared template (skipped if{" "}
                    <code className="font-mono">detached: true</code>). Drafts may be empty; JSON
                    fields must satisfy their schema. Live pages also always need{" "}
                    <code className="font-mono">meta.page_title</code> and{" "}
                    <code className="font-mono">meta.description</code>. See{" "}
                    <code className="font-mono">shared/validateRequiredFields.ts</code>,{" "}
                    <code className="font-mono">server/live-entry-seo-gate.ts</code>,{" "}
                    <code className="font-mono">scripts/validation/validators/required-fields.ts</code>.
                  </p>
                </div>
              )}
                </div>
              )}
            </div>

            {Object.values(transformerModes).some(Boolean) && (
              <div className="rounded-md bg-muted px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  Computed fields use: <code className="font-mono bg-background px-1 rounded">(value, item) =&gt; result</code>. Runs in a secure sandbox (50ms timeout).
                </p>
              </div>
            )}

            {specialKeys.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">System fields</Label>
                {specialKeys.map((key) => {
                  const staticHreflangsLocked = key === "_hreflangs" && !isDbBacked;
                  const staticImageGuidance = key === "_image" && !isDbBacked;
                  const allowEmpty =
                    key === "_locale" ||
                    key === "_image" ||
                    key === "_hreflangs" ||
                    key === "_updated_at";
                  return (
                  <div key={key} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      onClick={() => setSpecialInfoKey(key)}
                      title={`About ${key}`}
                      data-testid={`button-special-field-info-${key}`}
                    >
                      <Badge
                        variant="outline"
                        className="text-xs font-mono flex-shrink-0 cursor-pointer hover-elevate gap-1 pr-1.5"
                      >
                        {key}
                        <Info className="h-3 w-3 text-muted-foreground" />
                      </Badge>
                    </button>
                    <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    {staticHreflangsLocked ? (
                      <p
                        className="text-[11px] text-muted-foreground flex-1 leading-snug"
                        data-testid={`note-mapping-${key}`}
                      >
                        Alternative locales are calculated automatically from{" "}
                        <code className="font-mono">en.yml</code>,{" "}
                        <code className="font-mono">es.yml</code>, or{" "}
                        <code className="font-mono">[lang].yml</code>.
                      </p>
                    ) : (
                      renderSourceEditor(key, {
                        allowEmpty,
                        hideOptionalToggle: true,
                      })
                    )}
                  </div>
                  {key === "_locale" && !isDbBacked && !(mappings[key] || "").trim() && (
                    <p className="text-[11px] text-muted-foreground ml-[7.5rem]">
                      Locale usually comes from the file name / URL. Map a source only if the entry stores locale explicitly.
                    </p>
                  )}
                  {staticImageGuidance && !transformerModes[key] && !(mappings[key] || "").trim() && !config?.preview?.component && (
                    <p className="text-[11px] text-muted-foreground ml-[7.5rem]" data-testid={`note-mapping-${key}`}>
                      Or upload a specific image per entry, or use a function to build a dynamic OG preview URL.
                    </p>
                  )}
                  </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-2" data-testid="seo-fields-schema-block">
              <Label className="text-xs text-muted-foreground">SEO fields</Label>
              <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3 text-sm text-muted-foreground">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 text-left"
                  onClick={() => setSeoEducationOpen((v) => !v)}
                  aria-expanded={seoEducationOpen}
                  data-testid="button-toggle-seo-fields-education"
                >
                  <p className="flex items-center gap-1.5 font-medium text-foreground">
                    <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    What are SEO fields?
                  </p>
                  <IconChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${seoEducationOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {seoEducationOpen && (
                  <div className="space-y-2">
                    <p>
                      <span className="font-medium text-foreground">Main keyword</span> (
                      <code className="font-mono text-xs">{"{{ seo.main_keyword }}"}</code>) is this page&apos;s
                      own query. <span className="font-medium text-foreground">Is pillar</span> marks this page
                      as the hub — save fills <span className="font-medium text-foreground">Pillar path</span>{" "}
                      with this page&apos;s URL. Supporting pages set Pillar path to that hub URL (same locale
                      prefix). Missing or empty = cluster gap; <code className="font-mono text-xs">pillar_path: null</code> =
                      intentional opt-out.
                    </p>
                    <p>
                      Same workflow as other fields: optional database column as baseline, locale YAML{" "}
                      <code className="font-mono text-xs">seo:</code> as the override editors write, Reset restores
                      the database baseline (clears the YAML key only — never writes the DB). Rejected on{" "}
                      <code className="font-mono text-xs">_common.yml</code>. Edit/Reset need a locale YAML file.
                    </p>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
                      onClick={() => setShowSeoAdvanced((v) => !v)}
                      data-testid="button-toggle-seo-fields-advanced"
                    >
                      {showSeoAdvanced ? "Hide advanced details" : "Read more (advanced)"}
                      <IconChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${showSeoAdvanced ? "rotate-180" : ""}`}
                      />
                    </button>
                    {showSeoAdvanced && (
                      <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2 text-xs">
                        <p>
                          Templates/edits use nested <code className="font-mono">seo:</code> on{" "}
                          <code className="font-mono">{"{directory}/{slug}/{locale}.yml"}</code> via{" "}
                          <code className="font-mono">writeSeoFields</code>. DB baselines use{" "}
                          <code className="font-mono">field_mapping</code> keys{" "}
                          <code className="font-mono">seo_main_keyword</code>,{" "}
                          <code className="font-mono">seo_is_pillar</code>,{" "}
                          <code className="font-mono">seo_pillar_path</code> — never dotted{" "}
                          <code className="font-mono">seo.main_keyword</code> (rejected; would break{" "}
                          <code className="font-mono">writeMappedFields</code>). Merge:{" "}
                          <code className="font-mono">server/seo-effective-seo.ts</code>. Index:{" "}
                          <code className="font-mono">{"{contentRoot}/seo-index.json"}</code>. Paths:{" "}
                          <code className="font-mono">server/seo-fields.ts</code>,{" "}
                          <code className="font-mono">server/seo-index.ts</code>,{" "}
                          <code className="font-mono">KNOWN_SEO_FIELDS</code> /{" "}
                          <code className="font-mono">SEO_FIELD_MAPPING_KEYS</code> in{" "}
                          <code className="font-mono">server/content-types.ts</code>.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1 pt-1" data-testid="seo-fields-mapping-rows">
                {SEO_DB_MAPPING_ROWS.map((row) => (
                  <div key={row.mappingKey} className="flex items-center gap-2">
                    <span
                      className="text-xs font-mono w-36 flex-shrink-0 text-right text-muted-foreground truncate"
                      title={row.displayPath}
                    >
                      {row.displayPath}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    {isDbBacked ? (
                      renderSourceEditor(row.mappingKey, {
                        allowEmpty: true,
                        hideOptionalToggle: true,
                        hideFunctionOption: true,
                      })
                    ) : (
                      <>
                        <span className="text-xs text-foreground">{row.label}</span>
                        <code className="text-[11px] font-mono text-muted-foreground">{row.template}</code>
                      </>
                    )}
                  </div>
                ))}
                {isDbBacked && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed pt-1" data-testid="seo-fields-db-baseline-note">
                    Default from database column; locale YAML <code className="font-mono">seo:</code> overrides
                    and is what editors write. Reset restores the database baseline.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Fields</Label>
              {regularKeys.length > 0 ? (
                <div className="space-y-1">
                  {regularKeys.map((key) => {
                    const isFn = !!transformerModes[key];
                    const isRemap = !!remapModes[key] || showSourceEditor;
                    const showComputeEditor = isFn || isRemap;
                    const vResult = isFn ? null : validation[key];
                    const currentSrc = mappings[key] || "";
                    return (
                      <div key={key}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono w-28 flex-shrink-0 text-right text-muted-foreground truncate" title={key}>
                            {key}
                          </span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          {showComputeEditor ? (
                            <div className="flex-1 flex flex-col gap-1 min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                {renderSourceEditor(key)}
                              </div>
                              <ClickToEditDefault
                                fieldKey={key}
                                value={fieldDefaults[key]}
                                onChange={(v) =>
                                  setFieldDefaults((prev) => ({ ...prev, [key]: v }))
                                }
                              />
                            </div>
                          ) : (
                            <div className="flex-1 flex items-center gap-2 min-w-0">
                              <ClickToEditDefault
                                fieldKey={key}
                                value={fieldDefaults[key]}
                                onChange={(v) =>
                                  setFieldDefaults((prev) => ({ ...prev, [key]: v }))
                                }
                              />
                            </div>
                          )}
                          <ComputeModeMenu
                            fieldKey={key}
                            mode={
                              isFn
                                ? "function"
                                : !!remapModes[key] || (showSourceEditor && currentSrc !== key)
                                  ? "field"
                                  : "none"
                            }
                            onNotComputed={() => resetComputeMode(key)}
                            onPickField={() => enterRemapMode(key)}
                            onPickFunction={() => enterFunctionMode(key)}
                          />
                          {(isDbBacked || isFn || currentSrc === key || !showComputeEditor) && (
                            <FieldValidationIndicator result={vResult} optional={optionalFields[key]} />
                          )}
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={`flex-shrink-0 ${
                                    editorHints[key]?.required === true ||
                                    editorHints[key]?.required === "attached"
                                      ? "text-primary"
                                      : ""
                                  }`}
                                  onClick={() => handleRequiredFieldClick(key)}
                                  data-testid={`button-required-field-${key}`}
                                >
                                  {editorHints[key]?.required === true ? (
                                    <span
                                      className="inline-flex items-center"
                                      aria-hidden
                                    >
                                      <Asterisk className="h-3.5 w-3.5" />
                                      <Asterisk className="h-3.5 w-3.5 -ml-2" />
                                    </span>
                                  ) : (
                                    <Asterisk className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                className="text-xs"
                                data-testid={`tooltip-required-field-${key}`}
                              >
                                {editorHints[key]?.required === true
                                  ? "** Always required"
                                  : editorHints[key]?.required === "attached"
                                    ? "* When attached"
                                    : readSkipRequiredConfirm()
                                      ? "Click to cycle required mode"
                                      : allowAttachedRequiredMode
                                        ? "** Always · * Attached"
                                        : "Click to set required"}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`flex-shrink-0 ${editorHints[key]?.type && editorHints[key]?.type !== "text" ? "text-primary" : ""}`}
                            title="Configure editor type"
                            onClick={() => setHintDialogField(key)}
                            data-testid={`button-hint-field-${key}`}
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="flex-shrink-0"
                            title="Remove field"
                            onClick={() => setPendingDeleteKey(key)}
                            data-testid={`button-delete-mapping-${key}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        {!showComputeEditor && (
                          <p className="text-[10px] text-muted-foreground ml-[7.5rem] mt-0.5 flex items-center gap-1">
                            <span>
                              Use it as <code className="font-mono">{`{{ entry.${key} }}`}</code> on any yml
                            </span>
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    aria-label={`About {{ entry.${key} }}`}
                                    data-testid={`button-single-var-info-${key}`}
                                  >
                                    <Info className="h-3 w-3" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  className="z-[10001] max-w-[260px] text-xs"
                                >
                                  In page or component YAML, reference this field with{" "}
                                  <code className="font-mono">{`{{ entry.${key} }}`}</code>.
                                  The value comes from the entry&apos;s{" "}
                                  <code className="font-mono">{key}</code> property (or its default when missing).
                                  Use the Code button only if you need to remap or compute it.
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </p>
                        )}
                        {renderDeleteConfirm(key)}
                        {!isFn && !isDbBacked && vResult && vResult !== "loading" && vResult.isNewField && pendingDeleteKey !== key && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1" data-testid={`text-new-field-warn-${key}`}>
                            New field — no entry YAML has <code className="font-mono">{key}</code> yet. Defaults will apply until entries set a value.
                          </p>
                        )}
                        {!isFn && !isDbBacked && currentSrc !== key && pendingDeleteKey !== key && (
                          optionalFields[key] ? (
                            <OptionalFieldHint result={vResult} fieldKey={key} />
                          ) : (
                            <FieldValidationMessage
                              result={vResult}
                              fieldKey={key}
                              source={mappings[key]}
                              onSetOptional={() => setOptionalFields((prev) => ({ ...prev, [key]: true }))}
                              onBackfill={(value) => handleBackfill(key, mappings[key] || key, value)}
                            />
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-2">
                  {isDbBacked ? "No field mappings defined yet." : "No fields declared yet."}
                </p>
              )}

              <div className="pt-1">
                {showAddField ? (
                  <div className="flex items-center gap-2 min-w-0" data-testid="section-add-field">
                    <Input
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      placeholder="Field name"
                      title={
                        isDbBacked
                          ? "Schema key + optional DB remap. Default is required (may be null)."
                          : "Schema key must match the YAML parent key. Default is required (may be null)."
                      }
                      className="text-xs font-mono flex-1 min-w-0"
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddField(); }}
                      autoFocus
                      data-testid="input-new-mapping-key"
                    />
                    {defaultSpecified && !newDefaultIsNull ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <Input
                          value={newDefault}
                          onChange={(e) => {
                            setNewDefault(e.target.value);
                            setDefaultSpecified(true);
                          }}
                          placeholder="Default value"
                          className="text-xs font-mono flex-1 min-w-0"
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddField(); }}
                          autoFocus
                          data-testid="input-new-field-default"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 flex-shrink-0 text-muted-foreground"
                          title="Back to default options"
                          onClick={() => {
                            setNewDefault("");
                            setNewDefaultIsNull(false);
                            setDefaultSpecified(false);
                          }}
                          data-testid="button-new-field-default-back"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div
                        className="inline-flex items-center rounded-md border border-border p-0.5 flex-shrink-0"
                        role="group"
                        aria-label="Default type"
                        data-testid="toggle-new-field-default"
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-[10px] h-7 px-2"
                          onClick={() => {
                            setNewDefaultIsNull(false);
                            setDefaultSpecified(true);
                          }}
                          data-testid="button-new-field-default-value"
                        >
                          Default value
                        </Button>
                        <Button
                          type="button"
                          variant={newDefaultIsNull ? "default" : "ghost"}
                          size="sm"
                          className="text-[10px] h-7 px-2"
                          onClick={() => {
                            setNewDefaultIsNull(true);
                            setNewDefault("");
                            setDefaultSpecified(true);
                          }}
                          data-testid="button-new-field-default-null"
                        >
                          Default null
                        </Button>
                      </div>
                    )}
                    {isDbBacked && (
                      <Input
                        value={newValue}
                        onChange={(e) => handleNewValueChange(e.target.value)}
                        placeholder="DB source (optional)"
                        className="text-xs font-mono flex-1 min-w-0"
                        data-testid="input-new-mapping-source"
                      />
                    )}
                    <Button
                      variant="outline"
                      size="icon"
                      className="flex-shrink-0"
                      onClick={handleAddField}
                      disabled={!newKey.trim() || newKey.trim() in mappings || !defaultSpecified}
                      data-testid="button-add-mapping"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="flex-shrink-0"
                      onClick={() => {
                        setShowAddField(false);
                        setNewKey("");
                        setNewValue("");
                        setNewDefault("");
                        setNewDefaultIsNull(false);
                        setDefaultSpecified(false);
                        setNewValueValidation(null);
                        setNewOptional(false);
                      }}
                      data-testid="button-cancel-add-field"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddField(true)}
                    data-testid="button-show-add-field"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Add new field
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Indexes</Label>
              <p className="text-[11px] text-muted-foreground">
                Indexed fields generate filter dropdowns and summary cards on the management page. Language is always indexed automatically via <code className="font-mono">_locale</code>.
              </p>
              <div className="flex items-center gap-2 flex-wrap" data-testid="section-index-toggles">
                {mappings._locale && typeof mappings._locale === "string" && !mappings._locale.startsWith("function:") && (
                  <Badge variant="default" className="text-xs cursor-default opacity-70 no-default-active-elevate" data-testid="badge-index-locale-auto">
                    <Check className="h-3 w-3 mr-1" />
                    {mappings._locale} (Language, auto)
                  </Badge>
                )}
                {regularKeys.filter((field) => !isLocaleIndexField(field)).map((field) => {
                  const isIndexed = indexedFields.includes(field);
                  return (
                    <Badge
                      key={field}
                      variant={isIndexed ? "default" : "outline"}
                      className="text-xs cursor-pointer"
                      onClick={() => {
                        setIndexedFields((prev) =>
                          isIndexed ? prev.filter((f) => f !== field) : [...prev, field]
                        );
                      }}
                      data-testid={`badge-index-toggle-${field}`}
                    >
                      {isIndexed && <Check className="h-3 w-3 mr-1" />}
                      {field}
                    </Badge>
                  );
                })}
                {regularKeys.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Add fields first to enable indexing.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2" data-testid="section-unique-toggles">
              <Label className="text-xs text-muted-foreground font-medium">Unique Fields</Label>
              <p className="text-[11px] text-muted-foreground">
                Unique fields must have a distinct value across entries. When duplicating, the creation modal will prompt for new values. The same value can appear across different locales of the same entry.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={uniqueFields.includes("slug") ? "default" : "outline"}
                  className="text-xs cursor-default no-default-active-elevate"
                  data-testid="badge-unique-toggle-slug"
                >
                  {uniqueFields.includes("slug") && <Check className="h-3 w-3 mr-1" />}
                  slug
                </Badge>
                {regularKeys.filter(f => f !== "slug").map((field) => {
                  const isUnique = uniqueFields.includes(field);
                  return (
                    <Badge
                      key={field}
                      variant={isUnique ? "default" : "outline"}
                      className="text-xs cursor-pointer"
                      onClick={() => {
                        setUniqueFields((prev) =>
                          isUnique ? prev.filter((f) => f !== field) : [...prev, field]
                        );
                      }}
                      data-testid={`badge-unique-toggle-${field}`}
                    >
                      {isUnique && <Check className="h-3 w-3 mr-1" />}
                      {field}
                    </Badge>
                  );
                })}
                {regularKeys.length === 0 && (
                  <p className="text-[11px] text-muted-foreground italic">
                    Add fields first to enable unique field selection.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-mappings">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || isLoading}
            data-testid="button-save-mappings"
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <SpecialFieldInfoDialog
      fieldKey={specialInfoKey}
      open={!!specialInfoKey}
      onOpenChange={(next) => {
        if (!next) setSpecialInfoKey(null);
      }}
    />
    <EditorTypeDialog
      open={hintDialogField !== null}
      fieldName={hintDialogField}
      initialHint={hintDialogField ? editorHints[hintDialogField] : undefined}
      existingItems={hintExistingItems}
      existingItemsLoading={hintExistingItemsLoading}
      onClose={() => setHintDialogField(null)}
      onApply={(hint) => {
        const field = hintDialogField;
        if (!field) return;
        setEditorHints((prev) => {
          const prevHint = prev[field] || {};
          const merged: EditorHint = { ...hint };
          if (prevHint.required === true || prevHint.required === "attached") {
            merged.required = prevHint.required;
          }
          return { ...prev, [field]: merged };
        });
        setHintDialogField(null);
      }}
    />
    <RequiredFieldConfirmDialog
      open={pendingRequiredField !== null}
      fieldName={pendingRequiredField}
      currentRequired={
        pendingRequiredField
          ? normalizeRequiredMode(editorHints[pendingRequiredField]?.required)
          : false
      }
      allowAttachedMode={allowAttachedRequiredMode}
      onOpenChange={(next) => {
        if (!next) setPendingRequiredField(null);
      }}
      onSelect={(nextRequired, neverAskAgain) => {
        const field = pendingRequiredField;
        if (!field) return;
        if (applyRequiredMode(field, nextRequired) && neverAskAgain) {
          writeSkipRequiredConfirm(true);
        }
        setPendingRequiredField(null);
      }}
    />
    <EntryPreviewConfigDialog
      open={previewConfigOpen}
      onOpenChange={setPreviewConfigOpen}
      contentType={contentType}
      preview={config?.preview}
      fieldMapping={mappings}
      onFinished={() => {
        if (!reopenMappingAfterPreviewRef.current) return;
        reopenMappingAfterPreviewRef.current = false;
        window.setTimeout(() => onOpenChange(true), 150);
      }}
    />
    </>
  );
}

function StrategyDialog({
  open,
  onOpenChange,
  contentType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: string;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [clearingStrategy, setClearingStrategy] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [constraints, setConstraints] = useState<string[]>([]);
  const [newConstraint, setNewConstraint] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const label = contentType.charAt(0).toUpperCase() + contentType.slice(1);

  const { data: config, isLoading } = useQuery<ContentTypeConfig>({
    queryKey: ["/api/content-types", contentType, "config"],
    queryFn: () => fetch(`/api/content-types/${contentType}/config`).then((r) => r.json()),
    enabled: open,
  });

  useEffect(() => {
    if (!open || !config) return;
    const s = config.strategy;
    setPurpose(typeof s?.purpose === "string" ? s.purpose : "");
    setConstraints(
      Array.isArray(s?.constraints)
        ? s.constraints.filter((c): c is string => typeof c === "string")
        : [],
    );
    setNewConstraint("");
    setShowAdvanced(false);
  }, [open, config]);

  const hasRequiredFields = Object.values(config?.editor || {}).some(
    (h) => h?.required === true || h?.required === "attached",
  );
  const canClear = !hasRequiredFields && isValidContentTypeStrategy(config?.strategy);
  const purposeTrimmed = purpose.trim();
  const canSave = purposeTrimmed.length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const trimmedConstraints = constraints.map((c) => c.trim()).filter(Boolean);
      const strategy = trimmedConstraints.length
        ? { purpose: purposeTrimmed, constraints: trimmedConstraints }
        : { purpose: purposeTrimmed };
      await apiRequest("PUT", `/api/content-types/${contentType}/config`, { strategy });
      await queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
      toast({ title: "Strategy saved" });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Failed to save strategy",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!canClear) return;
    setClearingStrategy(true);
    try {
      await apiRequest("PUT", `/api/content-types/${contentType}/config`, { strategy: null });
      await queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
      toast({ title: "Strategy cleared" });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Failed to clear strategy",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setClearingStrategy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]" data-testid="dialog-content-type-strategy">
        <DialogHeader>
          <DialogTitle>{label} Strategy</DialogTitle>
          <DialogDescription>
            Type-level purpose for staff and agents — why this content type exists.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
            <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : (
          <div className="space-y-4">
            <div
              className="space-y-2 text-sm text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2.5"
              data-testid="strategy-education"
            >
              <p>
                <strong className="font-medium text-foreground">Strategy</strong> is the main brief for
                this content type. Agents and staff use it as context when filling required fields.
              </p>
              <p>
                It is <strong className="font-medium text-foreground">not</strong> the same as per-field{" "}
                <code className="font-mono text-[10px]">fill_intent</code> (why/how to fill one field)
                or Insights <code className="font-mono text-[10px]">insights_intent</code> (component
                taxonomy).
              </p>
              <p>
                Any field marked required (<code className="font-mono text-[10px]">true</code> or{" "}
                <code className="font-mono text-[10px]">attached</code>) needs a valid strategy with a
                non-empty purpose first.
              </p>
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => setShowAdvanced((v) => !v)}
                data-testid="button-strategy-advanced"
              >
                {showAdvanced ? "Hide advanced" : "Read more (advanced)"}
              </button>
              {showAdvanced && (
                <p className="text-xs pt-1">
                  Stored on <code className="font-mono text-[10px]">content-types.yml</code> as{" "}
                  <code className="font-mono text-[10px]">strategy.purpose</code> /{" "}
                  <code className="font-mono text-[10px]">strategy.constraints</code>. Code:{" "}
                  <code className="font-mono text-[10px]">shared/contentTypeStrategy.ts</code>,{" "}
                  <code className="font-mono text-[10px]">server/content-types.ts</code> (strategy
                  header). MCP: <code className="font-mono text-[10px]">update_content_type</code>.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="strategy-purpose">Purpose</Label>
              <Textarea
                id="strategy-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Why this content type exists — catalog clarity, local presence, editorial, …"
                className="min-h-[88px] text-sm"
                data-testid="input-strategy-purpose"
              />
            </div>

            <div className="space-y-2">
              <Label>Constraints (optional)</Label>
              <div className="space-y-1.5" data-testid="section-strategy-constraints">
                {constraints.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={c}
                      onChange={(e) => {
                        const v = e.target.value;
                        setConstraints((prev) => prev.map((x, j) => (j === i ? v : x)));
                      }}
                      className="text-sm"
                      data-testid={`input-strategy-constraint-${i}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="flex-shrink-0"
                      onClick={() => setConstraints((prev) => prev.filter((_, j) => j !== i))}
                      data-testid={`button-remove-strategy-constraint-${i}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={newConstraint}
                  onChange={(e) => setNewConstraint(e.target.value)}
                  placeholder="Add a constraint…"
                  className="text-sm"
                  data-testid="input-strategy-constraint-new"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const t = newConstraint.trim();
                      if (!t) return;
                      setConstraints((prev) => [...prev, t]);
                      setNewConstraint("");
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!newConstraint.trim()}
                  onClick={() => {
                    const t = newConstraint.trim();
                    if (!t) return;
                    setConstraints((prev) => [...prev, t]);
                    setNewConstraint("");
                  }}
                  data-testid="button-add-strategy-constraint"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
            </div>

            {hasRequiredFields && (
              <p className="text-xs text-muted-foreground" data-testid="text-strategy-clear-blocked">
                Clear is disabled while required fields exist. Remove required/attached from all fields
                first, or keep a valid strategy.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between sm:space-x-0">
          <Button
            variant="outline"
            onClick={handleClear}
            disabled={!canClear || clearingStrategy || saving || isLoading}
            data-testid="button-clear-strategy"
            title={
              hasRequiredFields
                ? "Cannot clear while required fields exist"
                : !isValidContentTypeStrategy(config?.strategy)
                  ? "No strategy to clear"
                  : "Clear strategy from content-types.yml"
            }
          >
            {clearingStrategy ? "Clearing…" : "Clear"}
          </Button>
          <div className="flex gap-2 w-full sm:w-auto justify-end">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-strategy"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!canSave || saving || isLoading}
              data-testid="button-save-strategy"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SeoSettingsDialog({
  open,
  onOpenChange,
  contentType,
  staticCount,
  dbCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: string;
  staticCount: number;
  dbCount: number;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const label = contentType.charAt(0).toUpperCase() + contentType.slice(1);

  const { data: config, isLoading } = useQuery<ContentTypeConfig>({
    queryKey: ["/api/content-types", contentType, "config"],
    queryFn: () => fetch(`/api/content-types/${contentType}/config`).then(r => r.json()),
    enabled: open,
  });

  const { data: localeSettings } = useQuery<LocaleSettings>({
    queryKey: ["/api/settings/locales"],
    staleTime: Infinity,
    enabled: open,
  });

  const availableLocales = localeSettings?.supported_locales ?? [
    { code: "en", label: "English" },
    { code: "es", label: "Spanish" },
  ];

  const [patternMode, setPatternMode] = useState<"non-localized" | "shorthand" | "per-locale">("shorthand");
  const [nonLocalizedPattern, setNonLocalizedPattern] = useState("");
  const [shorthandPattern, setShorthandPattern] = useState("");
  const [localePatterns, setLocalePatterns] = useState<{ locale: string; path: string }[]>([]);
  const [activeLocaleIndex, setActiveLocaleIndex] = useState(0);

  const nonLocalizedRef = useRef<HTMLInputElement>(null);
  const shorthandRef = useRef<HTMLInputElement>(null);
  const localeRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!open || !config?.url_pattern) return;
    const detected = detectPatternMode(config.url_pattern);
    setPatternMode(detected.mode);
    setNonLocalizedPattern(detected.nonLocalizedPattern);
    setShorthandPattern(detected.shorthandPattern);
    const detectedCodes = new Set(detected.localePatterns.map(lp => lp.locale));
    const extraFromAvailable = availableLocales
      .filter(l => !detectedCodes.has(l.code))
      .map(l => ({ locale: l.code, path: "" }));
    setLocalePatterns([...detected.localePatterns, ...extraFromAvailable]);
  }, [open, config]);

  useEffect(() => {
    setLocalePatterns(prev => {
      const existingMap = Object.fromEntries(prev.map(lp => [lp.locale, lp.path]));
      const next = availableLocales.map(l => ({ locale: l.code, path: existingMap[l.code] ?? "" }));
      const changed = next.length !== prev.length || next.some((lp, i) => lp.locale !== prev[i]?.locale || lp.path !== prev[i]?.path);
      return changed ? next : prev;
    });
  }, [availableLocales]);

  const URL_SAFE_FIELDS = new Set(["slug", "category", "lang", "status", "tags"]);

  const mappedKeys = (() => {
    const keys: string[] = ["slug"];
    if (!config?.field_mapping) return keys;
    const fromMapping = Object.entries(config.field_mapping)
      .filter(([k, v]) => v != null && !k.startsWith("_") && URL_SAFE_FIELDS.has(k))
      .map(([k]) => k);
    return Array.from(new Set([...keys, ...fromMapping]));
  })();

  function normalizePathInput(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed && !trimmed.startsWith("/")) return "/" + trimmed;
    return trimmed;
  }

  function validatePattern(p: string): string {
    if (!p) return "";
    const normalized = normalizePathInput(p);
    if (!normalized.includes(":slug")) return "Must include :slug";
    return "";
  }

  const nonLocalizedError = nonLocalizedPattern ? validatePattern(nonLocalizedPattern) : "";
  const shorthandError = shorthandPattern ? validatePattern(shorthandPattern) : "";
  const localeErrors = localePatterns.map(lp => lp.path ? validatePattern(lp.path) : "");
  const hasLocaleErrors = localeErrors.some(e => e !== "");
  const allLocalesFilled = localePatterns.length > 0 && localePatterns.every(lp => lp.path.trim() !== "");

  const canSubmit =
    patternMode === "non-localized"
      ? nonLocalizedPattern.trim() !== "" && !nonLocalizedError
      : patternMode === "shorthand"
        ? shorthandPattern.trim() !== "" && !shorthandError
        : allLocalesFilled && !hasLocaleErrors;

  const activePattern =
    patternMode === "non-localized"
      ? nonLocalizedPattern
      : patternMode === "shorthand"
        ? shorthandPattern
        : (localePatterns[activeLocaleIndex]?.path ?? "");

  const unknownVars = (() => {
    const patternsToCheck =
      patternMode === "per-locale"
        ? localePatterns.map(lp => lp.path)
        : [activePattern];
    const allVars = patternsToCheck.flatMap(p => (p.match(/:([a-z_]+)/g) || []).map(m => m.slice(1)));
    const unique = Array.from(new Set(allVars));
    return unique.filter(v => !mappedKeys.includes(v));
  })();

  const sampleItem = { slug: "sample-item", category: "general" };

  const insertVariable = (varName: string) => {
    if (patternMode === "non-localized") {
      const el = nonLocalizedRef.current;
      const token = `:${varName}`;
      if (!el) { setNonLocalizedPattern(prev => prev + token); return; }
      const start = el.selectionStart ?? nonLocalizedPattern.length;
      const end = el.selectionEnd ?? nonLocalizedPattern.length;
      const next = nonLocalizedPattern.slice(0, start) + token + nonLocalizedPattern.slice(end);
      setNonLocalizedPattern(next);
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
    } else if (patternMode === "shorthand") {
      const el = shorthandRef.current;
      const token = `:${varName}`;
      if (!el) { setShorthandPattern(prev => prev + token); return; }
      const start = el.selectionStart ?? shorthandPattern.length;
      const end = el.selectionEnd ?? shorthandPattern.length;
      const next = shorthandPattern.slice(0, start) + token + shorthandPattern.slice(end);
      setShorthandPattern(next);
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
    } else {
      const idx = activeLocaleIndex;
      const el = localeRefs.current[idx];
      const current = localePatterns[idx]?.path ?? "";
      const token = `:${varName}`;
      if (!el) {
        setLocalePatterns(prev => prev.map((lp, i) => i === idx ? { ...lp, path: lp.path + token } : lp));
        return;
      }
      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? current.length;
      const next = current.slice(0, start) + token + current.slice(end);
      setLocalePatterns(prev => prev.map((lp, i) => i === idx ? { ...lp, path: next } : lp));
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
    }
  };

  const previewItems = (() => {
    if (patternMode === "non-localized") {
      const p = normalizePathInput(nonLocalizedPattern);
      return p ? [{ label: "URL", pattern: p, locale: "en" }] : [];
    } else if (patternMode === "shorthand") {
      const suffix = normalizePathInput(shorthandPattern);
      if (!suffix) return [];
      return availableLocales.map(l => ({
        label: l.code.toUpperCase(),
        pattern: `/${l.code}${suffix}`,
        locale: l.code,
      }));
    } else {
      return localePatterns
        .filter(lp => lp.path.trim())
        .map(lp => ({
          label: lp.locale.toUpperCase(),
          pattern: `/${lp.locale}${normalizePathInput(lp.path)}`,
          locale: lp.locale,
        }));
    }
  })();

  const handleSave = async () => {
    setSaving(true);
    try {
      let url_pattern: Record<string, string>;
      if (patternMode === "non-localized") {
        url_pattern = { default: normalizePathInput(nonLocalizedPattern) };
      } else if (patternMode === "shorthand") {
        const suffix = normalizePathInput(shorthandPattern);
        url_pattern = Object.fromEntries(availableLocales.map(l => [l.code, `/${l.code}${suffix}`]));
      } else {
        url_pattern = Object.fromEntries(
          localePatterns.map(lp => [lp.locale, `/${lp.locale}${normalizePathInput(lp.path)}`])
        );
      }
      await apiRequest("PUT", `/api/content-types/${contentType}/config`, { url_pattern });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
      toast({ title: "URL pattern saved" });
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to save URL pattern", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const totalEntries = staticCount + dbCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{label} URL Settings</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
            <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {totalEntries > 0 && (
              <div className="flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5" data-testid="banner-url-change-warning">
                <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-xs text-destructive leading-relaxed">
                  <span className="font-medium">Changing the URL pattern may break existing URLs.</span>{" "}
                  This content type has {totalEntries} existing {totalEntries === 1 ? "entry" : "entries"} already indexed by search engines and sitemaps. You will need to set up redirections manually.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>URL Pattern</Label>
              <div className="flex rounded-md border overflow-visible" data-testid="segmented-url-pattern-mode">
                {([
                  { value: "non-localized" as const, label: "No locale prefix" },
                  { value: "shorthand" as const, label: "Use locale prefix" },
                  { value: "per-locale" as const, label: "Customized" },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`flex-1 text-xs py-1.5 px-1 transition-colors ${
                      patternMode === opt.value
                        ? "bg-primary text-primary-foreground font-medium"
                        : "text-muted-foreground hover-elevate"
                    } ${opt.value === "non-localized" ? "rounded-l-md" : ""} ${opt.value === "per-locale" ? "rounded-r-md" : ""}`}
                    onClick={() => setPatternMode(opt.value)}
                    data-testid={`button-pattern-mode-${opt.value}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {patternMode === "non-localized" && (
                <div className="space-y-1">
                  <Input
                    ref={nonLocalizedRef}
                    placeholder={`/${contentType}/:slug`}
                    value={nonLocalizedPattern}
                    onChange={(e) => setNonLocalizedPattern(e.target.value)}
                    className="font-mono text-sm"
                    data-testid="input-url-pattern-non-localized"
                  />
                  {nonLocalizedError && (
                    <p className="text-xs text-destructive" data-testid="text-non-localized-error">{nonLocalizedError}</p>
                  )}
                  <p className="text-xs text-muted-foreground">A single URL for all locales, no language prefix.</p>
                </div>
              )}

              {patternMode === "shorthand" && (
                <div className="space-y-1">
                  <div className="flex items-center">
                    <span
                      className="inline-flex items-center rounded-l-md border border-r-0 bg-muted px-2 py-2 text-xs text-muted-foreground flex-shrink-0"
                      data-testid="label-locale-prefix"
                    >
                      /:locale
                    </span>
                    <Input
                      ref={shorthandRef}
                      placeholder={`/${contentType}/:slug`}
                      value={shorthandPattern}
                      onChange={(e) => setShorthandPattern(e.target.value)}
                      className="rounded-l-none font-mono text-sm"
                      data-testid="input-url-pattern-shorthand"
                    />
                  </div>
                  {shorthandError && (
                    <p className="text-xs text-destructive" data-testid="text-shorthand-error">{shorthandError}</p>
                  )}
                </div>
              )}

              {patternMode === "per-locale" && (
                <div className="space-y-2">
                  {localePatterns.map((lp, i) => (
                    <div key={lp.locale} className="space-y-1">
                      <div className="flex items-center">
                        <span className="inline-flex items-center rounded-l-md border border-r-0 bg-muted px-2 py-2 text-xs text-muted-foreground flex-shrink-0">
                          /{lp.locale}
                        </span>
                        <Input
                          ref={el => { localeRefs.current[i] = el; }}
                          placeholder={`/${contentType}/:slug`}
                          value={lp.path}
                          onChange={(e) => setLocalePatterns(prev => prev.map((p, j) => j === i ? { ...p, path: e.target.value } : p))}
                          onFocus={() => setActiveLocaleIndex(i)}
                          className="rounded-l-none font-mono text-sm"
                          data-testid={`input-url-pattern-${lp.locale}`}
                        />
                      </div>
                      {localeErrors[i] && (
                        <p className="text-xs text-destructive" data-testid={`text-pattern-error-${lp.locale}`}>{localeErrors[i]}</p>
                      )}
                    </div>
                  ))}
                  <Link
                    href="/private/settings"
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    onClick={() => onOpenChange(false)}
                    data-testid="link-manage-locales"
                  >
                    Manage locales
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>

            {unknownVars.length > 0 && (
              <p className="text-xs text-destructive" data-testid="text-unknown-vars-warning">
                Unknown variable{unknownVars.length > 1 ? "s" : ""}: {unknownVars.map(v => `:${v}`).join(", ")}
              </p>
            )}

            <div className="space-y-1.5" data-testid="section-available-variables">
              <Label className="text-xs text-muted-foreground">Click to insert a variable</Label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {mappedKeys.map((key) => (
                  <Badge
                    key={key}
                    variant="outline"
                    className="cursor-pointer font-mono text-xs"
                    onClick={() => insertVariable(key)}
                    data-testid={`chip-var-${key}`}
                  >
                    :{key}
                  </Badge>
                ))}
              </div>
            </div>

            {previewItems.length > 0 && (
              <div className="rounded-md bg-muted px-3 py-2 space-y-1" data-testid="section-url-previews">
                <Label className="text-xs text-muted-foreground">Preview</Label>
                {previewItems.map(({ label: lbl, pattern, locale }) => (
                  <p key={locale} className="text-xs text-muted-foreground font-mono" data-testid={`text-url-preview-${locale}`}>
                    {lbl}: {buildItemUrl(pattern, sampleItem, locale)}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-seo">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || isLoading || !canSubmit} data-testid="button-save-seo">
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ContentTypeManagePage() {
  const { toast } = useToast();
  const [, params] = useRoute("/private/type/:contentType");
  const [, navigate] = useLocation();
  const contentType = params?.contentType || "blog";
  const label = contentType.charAt(0).toUpperCase() + contentType.slice(1);

  const [search, setSearch] = useState("");
  /** Debounced value used for list API queries — avoids a request per keystroke. */
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [updatedSortDir, setUpdatedSortDir] = useState<UpdatedSortDir>(null);
  const [tagFilters, setTagFilters] = useState<Record<string, string[]>>({});
  const [listPage, setListPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);
  const [clearing, setClearing] = useState(false);
  const [dsDialogOpen, setDsDialogOpen] = useState(false);
  const [connectDbConfirmOpen, setConnectDbConfirmOpen] = useState(false);
  const [clearCacheConfirmOpen, setClearCacheConfirmOpen] = useState(false);
  const [seoDialogOpen, setSeoDialogOpen] = useState(false);
  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false);
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"static" | "db">("static");
  const [listPerspective, setListPerspective] = useState<"default" | "seo">("default");
  const [seoModalOpen, setSeoModalOpen] = useState(false);
  const [seoModalTarget, setSeoModalTarget] = useState<ManagedSeoModalTarget | null>(null);
  const [seoPickerOpen, setSeoPickerOpen] = useState(false);
  const [seoPickerPending, setSeoPickerPending] = useState<{
    slug: string;
    locale: string;
    initialTab?: SeoModalTab;
  } | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<StaticEntry | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [isDeletingEntry, setIsDeletingEntry] = useState(false);

  const [semanticResults, setSemanticResults] = useState<Record<string, unknown>[] | null>(null);
  const [semanticActive, setSemanticActive] = useState(false);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const semanticDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [deleteTypeDialogOpen, setDeleteTypeDialogOpen] = useState(false);
  const [deleteTypeConfirmInput, setDeleteTypeConfirmInput] = useState("");
  const [isDeletingType, setIsDeletingType] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{
    static_entry_count: number;
    has_database: boolean;
    database_slug: string | null;
    directory: string;
    message: string;
    affected_urls: string[];
  } | null>(null);
  const [urlsExpanded, setUrlsExpanded] = useState(false);
  const [dryRunLoading, setDryRunLoading] = useState(false);

  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertConfirmInput, setConvertConfirmInput] = useState("");
  const [isConverting, setIsConverting] = useState(false);
  const [convertDryRunLoading, setConvertDryRunLoading] = useState(false);
  const [convertDryRun, setConvertDryRun] = useState<{
    entry_count: number;
    locale_count: number;
    files_to_write: number;
    files_to_overwrite: number;
    existing_slug_folders: string[];
    templates_to_delete: string[];
    directory: string;
    database_slug: string;
    message: string;
  } | null>(null);

  const [showYamlEditor, setShowYamlEditor] = useState(false);
  const [yamlEditorInfo, setYamlEditorInfo] = useState<{ contentType: string; slug: string; locale: string } | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [duplicatingPage, setDuplicatingPage] = useState<{
    loc: string;
    label: string;
    contentType: string;
    locale?: string;
    sourceSlug?: string;
    isDraft?: boolean;
  } | null>(null);
  const [createContentType, setCreateContentType] = useState<string>(contentType);
  const [createContentTitle, setCreateContentTitle] = useState("");
  const [createContentSlugEn, setCreateContentSlugEn] = useState("");
  const [createContentSlugEs, setCreateContentSlugEs] = useState("");
  const [createContentSlugEnStatus, setCreateContentSlugEnStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [createContentSlugEsStatus, setCreateContentSlugEsStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [slugEnConflictReason, setSlugEnConflictReason] = useState<string | null>(null);
  const [slugEsConflictReason, setSlugEsConflictReason] = useState<string | null>(null);
  const [editingSlugEn, setEditingSlugEn] = useState(false);
  const [editingSlugEs, setEditingSlugEs] = useState(false);
  const [isCreatingContent, setIsCreatingContent] = useState(false);

  const [createVersionOpen, setCreateVersionOpen] = useState(false);
  const [createVersionEntry, setCreateVersionEntry] = useState<StaticEntry | null>(null);
  const [createVersionSlug, setCreateVersionSlug] = useState("");
  const [createVersionLocale, setCreateVersionLocale] = useState("en");
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);
  const [partialOverrideDialogOpen, setPartialOverrideDialogOpen] = useState(false);
  const [partialOverrideVersionsDialogOpen, setPartialOverrideVersionsDialogOpen] = useState(false);
  const [versionsData, setVersionsData] = useState<Record<string, Record<string, { variants: { slug: string; allocation: number }[] }> | null>>({});
  const [versionsLoading, setVersionsLoading] = useState<Set<string>>(new Set());
  const [editingDbEntry, setEditingDbEntry] = useState<{
    item: Record<string, unknown>;
    index: number;
  } | null>(null);
  const [openingDbEdit, setOpeningDbEdit] = useState(false);

  const { data: allItemsData, isLoading: allLoading } = useQuery<ItemsResponse>({
    queryKey: [
      "/api/content-types",
      contentType,
      "items",
      listPage,
      debouncedSearch,
      updatedSortDir,
      tagFilters,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(listPage),
        pageSize: String(MANAGE_LIST_PAGE_SIZE),
      });
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      if (updatedSortDir) {
        params.set("sort", "updated_at");
        params.set("sortDir", updatedSortDir);
      }
      for (const [field, values] of Object.entries(tagFilters)) {
        for (const value of values) {
          params.append(field, value);
        }
      }
      return fetch(
        `/api/content-types/${contentType}/items?${params.toString()}`,
      ).then((r) => r.json());
    },
    enabled: listPerspective === "default" && viewMode === "db",
    staleTime: 60000,
    placeholderData: (prev) => prev,
  });

  const { data: staticEntriesData, isLoading: staticLoading, isFetching: staticFetching } = useQuery<StaticEntriesResponse>({
    queryKey: [
      "/api/content-types",
      contentType,
      "static-entries",
      listPage,
      debouncedSearch,
      updatedSortDir,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(listPage),
        pageSize: String(MANAGE_LIST_PAGE_SIZE),
      });
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      if (updatedSortDir) {
        params.set("sort", "updated_at");
        params.set("sortDir", updatedSortDir);
      }
      return fetch(
        `/api/content-types/${contentType}/static-entries?${params.toString()}`,
      ).then((r) => r.json());
    },
    enabled: listPerspective === "default" && viewMode === "static",
    staleTime: 60000,
  });

  const { data: seoEntriesData, isLoading: seoEntriesLoading, isFetching: seoEntriesFetching } = useQuery<SeoEntriesResponse>({
    queryKey: [
      "/api/content-types",
      contentType,
      "seo-entries",
      listPage,
      debouncedSearch,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(listPage),
        pageSize: String(MANAGE_LIST_PAGE_SIZE),
      });
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      return fetch(
        `/api/content-types/${contentType}/seo-entries?${params.toString()}`,
      ).then((r) => r.json());
    },
    enabled: listPerspective === "seo",
    staleTime: 0,
    refetchOnMount: "always",
    placeholderData: (prev) => prev,
  });

  const { data: cacheStatus } = useQuery<CacheStatus>({
    queryKey: ["/api/content-types", contentType, "cache-status"],
    queryFn: () => fetch(`/api/content-types/${contentType}/cache-status`).then(r => r.json()),
    staleTime: 30000,
  });

  const { data: typeConfig } = useQuery<ContentTypeConfig>({
    queryKey: ["/api/content-types", contentType, "config"],
    queryFn: () => fetch(`/api/content-types/${contentType}/config`).then(r => r.json()),
    staleTime: 60000,
  });

  /** Full DB item set for KPI cards + partial-override slug membership (not the table). */
  const { data: dbItemsMeta, isLoading: dbItemsMetaLoading } = useQuery<ItemsResponse>({
    queryKey: ["/api/content-types", contentType, "items", "meta-full"],
    queryFn: () =>
      fetch(`/api/content-types/${contentType}/items`).then((r) => r.json()),
    enabled: !!typeConfig?.database?.slug,
    staleTime: 60000,
  });

  /** Unpaginated static entries for the 14-day update timeline (omit `page`). */
  const { data: staticTimelineData } = useQuery<StaticEntriesResponse>({
    queryKey: ["/api/content-types", contentType, "static-entries", "timeline-full"],
    queryFn: () =>
      fetch(`/api/content-types/${contentType}/static-entries`).then((r) => r.json()),
    staleTime: 60000,
  });

  const schemaOrgRequirements = typeConfig?.schema_org_requirements ?? [];
  const hasSchemaOrgRequirements = schemaOrgRequirements.length > 0;

  const {
    data: schemaOrgCoverage,
    isLoading: schemaOrgCoverageLoading,
    refetch: refetchSchemaOrgCoverage,
  } = useQuery<SchemaOrgCoverageResponse>({
    queryKey: ["/api/content-types", contentType, "schema-org-coverage"],
    queryFn: () =>
      fetch(`/api/content-types/${encodeURIComponent(contentType)}/schema-org-coverage`).then((r) =>
        r.json(),
      ),
    enabled: hasSchemaOrgRequirements,
    staleTime: 30_000,
  });

  const [schemaOrgEnsuring, setSchemaOrgEnsuring] = useState(false);
  /** After Generate OG, show a Refresh link until the user reloads the thumb. */
  const [ogAwaitingRefresh, setOgAwaitingRefresh] = useState<Set<string>>(() => new Set());
  const [ogThumbBustByKey, setOgThumbBustByKey] = useState<Record<string, number>>({});
  const [schemaOrgMissingOpen, setSchemaOrgMissingOpen] = useState(false);

  const handleSchemaOrgEnsure = async () => {
    if (!contentType || !hasSchemaOrgRequirements) return;
    setSchemaOrgEnsuring(true);
    try {
      const res = await apiRequest(
        "POST",
        `/api/content-types/${encodeURIComponent(contentType)}/schema-org-ensure`,
        {},
      );
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      toast({
        title: "Schema.org sections attached",
        description: `Added ${result.added ?? 0}, already present ${result.already_present ?? 0}${
          result.errors ? `, errors ${result.errors}` : ""
        }.`,
      });
      await refetchSchemaOrgCoverage();
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "static-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "items"] });
    } catch (err: any) {
      toast({
        title: "Failed to attach Schema.org",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setSchemaOrgEnsuring(false);
    }
  };

  const { data: entryPreviewsData } = useQuery<{
    preview: ContentTypePreviewConfig | null;
    captureReady?: boolean;
    captureReadyError?: string;
    width: number;
    maxHeight: number;
    index: Record<
      string,
      {
        slug: string;
        locale: string;
        needsCapture: boolean;
        fromSource: boolean;
        cacheBustedUrl: string | null;
        propsHash?: string;
        meta: { failedAt?: string; dirty?: boolean; url?: string } | null;
      }
    >;
  }>({
    queryKey: ["/api/content-types", contentType, "entry-previews"],
    queryFn: () =>
      fetch(`/api/content-types/${encodeURIComponent(contentType)}/entry-previews`).then((r) => r.json()),
    enabled: !!typeConfig?.preview?.component,
    staleTime: 30_000,
  });

  const { data: entryPreviewQueueData } = useQuery<{
    configError: string | null;
    queue: { pending: number; active: number; completedSession: number; failedSession: number };
  }>({
    queryKey: ["/api/content-types", contentType, "entry-previews", "queue"],
    queryFn: async () => {
      const r = await apiRequest(
        "GET",
        `/api/content-types/${encodeURIComponent(contentType)}/entry-previews/queue`,
      );
      return r.json();
    },
    enabled: !!typeConfig?.preview?.component,
    refetchInterval: (query) => {
      const q = query.state.data?.queue;
      if (q && (q.pending > 0 || q.active > 0)) return 1_500;
      return false;
    },
  });

  const entryPreviewQueueBusyCount =
    (entryPreviewQueueData?.queue.pending ?? 0) + (entryPreviewQueueData?.queue.active ?? 0);

  useEffect(() => {
    if (entryPreviewQueueBusyCount > 0) {
      void queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentType, "entry-previews"],
        exact: true,
      });
      void queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentType, "entry-previews", "stats"],
        exact: true,
      });
    }
  }, [contentType, entryPreviewQueueBusyCount, entryPreviewQueueData?.queue.completedSession]);

  const enqueueServerPreviews = useCallback(
    async (opts: {
      mode: "missing" | "all" | "failed";
      locales: string[];
      slugs?: string[];
    }) => {
      try {
        const r = await apiRequest(
          "POST",
          `/api/content-types/${encodeURIComponent(contentType)}/entry-previews/enqueue`,
          opts,
        );
        const data = await r.json();
        if (!r.ok) {
          throw new Error(data.error || data.code || `Enqueue failed (${r.status})`);
        }
        void queryClient.invalidateQueries({
          queryKey: ["/api/content-types", contentType, "entry-previews"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["/api/content-types", contentType, "entry-previews", "queue"],
        });
        toast({
          title: "OG preview jobs queued",
          description: `${(data.enqueued as string[] | undefined)?.length ?? 0} job(s) on the server. You can close this tab.`,
        });
        return data;
      } catch (err) {
        toast({
          title: "Couldn't queue OG previews",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        throw err;
      }
    },
    [contentType],
  );

  const entryPreviewGenCounts = useMemo(() => {
    if (!entryPreviewsData?.index) return { missing: 0, all: 0 };
    const rows = Object.values(entryPreviewsData.index).filter(
      (r) => !r.fromSource && !r.meta?.failedAt,
    );
    return {
      missing: rows.filter((r) => r.needsCapture).length,
      all: rows.length,
    };
  }, [entryPreviewsData]);

  const handleGenerateAllPreviews = useCallback(
    async (mode: "missing" | "all") => {
      if (!entryPreviewsData?.preview || entryPreviewsData.captureReady === false) return;
      const rows = Object.values(entryPreviewsData.index).filter(
        (r) => !r.fromSource && !r.meta?.failedAt,
      );
      const targets = mode === "missing" ? rows.filter((r) => r.needsCapture) : rows;
      if (targets.length === 0) return;
      const locales = [...new Set(targets.map((r) => r.locale))];
      const slugs = [...new Set(targets.map((r) => r.slug))];
      await enqueueServerPreviews({ mode, locales, slugs });
    },
    [entryPreviewsData, enqueueServerPreviews],
  );

  const markEntryPreviewDirty = async (slug: string, locale: string) => {
    const previewKey = `${slug}:${locale}`;
    setOgAwaitingRefresh((prev) => {
      const next = new Set(prev);
      next.add(previewKey);
      return next;
    });
    try {
      await enqueueServerPreviews({ mode: "all", locales: [locale], slugs: [slug] });
    } catch {
      /* toast already shown */
    }
  };

  const refreshOgPreviewRow = async (previewKey: string) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentType, "entry-previews"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentType, "seo-entries"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentType, "items"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentType, "static-entries"],
      }),
    ]);
    setOgThumbBustByKey((prev) => ({ ...prev, [previewKey]: Date.now() }));
    setOgAwaitingRefresh((prev) => {
      const next = new Set(prev);
      next.delete(previewKey);
      return next;
    });
  };

  const withOgThumbBust = (previewKey: string, src: string) => {
    if (!src) return src;
    const bust = ogThumbBustByKey[previewKey];
    if (!bust) return src;
    return `${src}${src.includes("?") ? "&" : "?"}__refresh=${bust}`;
  };

  const handleRetryQueuedPreviews = useCallback(
    async (failures: EntryPreviewFailure[]) => {
      if (failures.length === 0) return;
      const locales = [...new Set(failures.map((f) => f.locale))];
      const slugs = [...new Set(failures.map((f) => f.slug))];
      await enqueueServerPreviews({ mode: "failed", locales, slugs });
    },
    [enqueueServerPreviews],
  );

  const urlPatterns = typeConfig?.url_pattern || {};
  // Static listings inject locale from the filename as `lang` when `_locale` is unset
  // (see loadStaticContentTypeItems). Mirror that so Language KPIs / filters work for
  // YAML-backed types without requiring an explicit _locale mapping.
  const localeKey = (() => {
    const staticFallback = typeConfig?.database?.slug ? null : "lang";
    const raw = typeConfig?.field_mapping?._locale;
    if (!raw) return staticFallback;
    const val = typeof raw === "object" ? raw.source : raw;
    if (typeof val === "string" && val.startsWith("function:")) {
      const fm = typeConfig?.field_mapping || {};
      const localeLike = ["lang", "locale", "language"];
      for (const f of localeLike) {
        if (f in fm && !f.startsWith("_")) return f;
      }
      return staticFallback;
    }
    return val;
  })();

  const hreflangsSource = (() => {
    const raw = typeConfig?.field_mapping?._hreflangs;
    if (!raw) return "translations";
    const val = typeof raw === "object" ? raw.source : raw;
    if (typeof val === "string" && val.startsWith("function:")) return "translations";
    return typeof val === "string" && val.trim() ? val : "translations";
  })();

  const items = allItemsData?.results || [];
  const metaItems = dbItemsMeta?.results || [];

  const itemsBySlug = (() => {
    const map = new Map<string, Record<string, any>>();
    for (const item of metaItems) {
      const slug = String(item.slug ?? "").trim();
      if (slug) map.set(slug, item);
    }
    return map;
  })();
  const dbSlug = typeConfig?.database?.slug || null;
  const hasDbConnection = !!dbSlug;

  const dbSlugSet = new Set(
    hasDbConnection ? metaItems.map((item) => String(item.slug ?? "")).filter(Boolean) : [],
  );
  const isPartialOverride = (entrySlug: string) => hasDbConnection && dbSlugSet.has(entrySlug);

  const contentUpdateTimelineItems = useMemo(() => {
    const staticSources = (staticTimelineData?.results || []).map((entry) => ({
      slug: entry.slug,
      title: entry.title,
      updated_at: entry.updated_at,
      urls: entry.urls,
    }));

    const dbSources = metaItems
      .map((item) => {
        const slug = String(item.slug ?? "").trim();
        if (!slug) return null;
        const itemLocale = localeKey ? String(item[localeKey] || "en") : "en";
        const pattern =
          itemLocale === "es"
            ? urlPatterns.es || urlPatterns.en
            : urlPatterns.en || urlPatterns.default || "";
        const itemUrl = pattern ? buildItemUrl(pattern, item, itemLocale) : "";
        const urls: Record<string, string> = {};
        if (itemUrl) urls[itemLocale] = itemUrl;
        return {
          slug,
          title: String(item.title || slug),
          updated_at: item.updated_at,
          urls,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);

    return buildContentUpdateTimelineItems(staticSources, dbSources);
  }, [staticTimelineData?.results, metaItems, localeKey, urlPatterns]);

  const LOCALE_LABELS: Record<string, string> = { en: "English", es: "Spanish", pt: "Portuguese", fr: "French", de: "German", it: "Italian" };

  const { data: dbEditorConfig } = useQuery<Record<string, { type?: string }>>({
    queryKey: ["/api/databases", dbSlug, "editor-config"],
    queryFn: () =>
      fetch(`/api/databases/${dbSlug}`).then(async (r) => {
        const data = await r.json();
        return (data.config?.editor as Record<string, { type?: string }>) || {};
      }),
    enabled: !!dbSlug,
    staleTime: 60000,
  });

  const isTagsField = (fieldKey: string) =>
    dbEditorConfig?.[fieldKey]?.type === "tags";

  const allIndexFields = (() => {
    const explicit = stripLocaleIndexFields(typeConfig?.indexes || []) || [];
    const result = [...explicit];
    if (localeKey && !result.includes(localeKey)) {
      result.push(localeKey);
    }
    return result;
  })();


  useEffect(() => {
    if (viewMode !== "db" || !dbSlug) {
      setSemanticResults(null);
      setSemanticActive(false);
      setSemanticLoading(false);
      if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);
      return;
    }

    if (!debouncedSearch.trim()) {
      setSemanticResults(null);
      setSemanticActive(false);
      setSemanticLoading(false);
      if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);
      return;
    }

    setSemanticLoading(true);

    if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);

    // Input is already debounced; run semantic search promptly after that settles.
    semanticDebounceRef.current = setTimeout(async () => {
      try {
        const localeFilter = (tagFilters[localeKey || ""] ?? [])[0] || "";
        const params = new URLSearchParams({ q: debouncedSearch.trim(), limit: "50" });
        if (localeFilter) params.set("locale", localeFilter);

        const res = await fetch(`/api/databases/${dbSlug}/search?${params.toString()}`);
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const data = await res.json();

        setSemanticResults(data.items || []);
        setSemanticActive(data.semantic === true);
      } catch {
        setSemanticResults(null);
        setSemanticActive(false);
      } finally {
        setSemanticLoading(false);
      }
    }, 50);

    return () => {
      if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);
    };
  }, [debouncedSearch, viewMode, dbSlug, tagFilters, localeKey]);

  useEffect(() => {
    setListPage(1);
  }, [debouncedSearch, updatedSortDir, tagFilters, viewMode, listPerspective, contentType]);

  const matchesFilter = (item: Record<string, unknown>, field: string, value: string) => {
    const needle = value.toLowerCase();
    const tokens = fieldValueTokens(item[field]).map((t) => t.toLowerCase());
    if (tokens.length > 1 || isTagsField(field) || Array.isArray(item[field])) {
      return tokens.includes(needle);
    }
    return (tokens[0] || "") === needle;
  };

  const useSemanticList =
    viewMode === "db" && debouncedSearch.trim() && semanticResults !== null;

  const semanticFiltered = (() => {
    if (!useSemanticList || !semanticResults) return [];
    let result = semanticResults;
    for (const [field, values] of Object.entries(tagFilters)) {
      for (const value of values) {
        result = result.filter((p) => matchesFilter(p, field, value));
      }
    }
    return sortByUpdatedAt(result, updatedSortDir, (p) => p.updated_at);
  })();

  const semanticTotal = semanticFiltered.length;
  const semanticTotalPages = Math.max(1, Math.ceil(semanticTotal / MANAGE_LIST_PAGE_SIZE) || 1);
  const semanticSafePage = Math.min(Math.max(1, listPage), semanticTotalPages);
  const filtered = useSemanticList
    ? semanticFiltered.slice(
        (semanticSafePage - 1) * MANAGE_LIST_PAGE_SIZE,
        semanticSafePage * MANAGE_LIST_PAGE_SIZE,
      )
    : items;

  const filteredStatic = staticEntriesData?.results || [];
  /** Hide rows while typing (debounce) or while the list query is in flight. */
  const staticListLoading =
    search !== debouncedSearch || staticLoading || staticFetching;
  const filteredSeoEntries = seoEntriesData?.entries || [];

  const staticTotal = staticEntriesData?.total ?? filteredStatic.length;
  const staticTotalPages = staticEntriesData?.totalPages ?? 1;
  const staticPage = staticEntriesData?.page ?? listPage;

  const itemsTotal = useSemanticList
    ? semanticTotal
    : (allItemsData?.total ?? items.length);
  const itemsTotalPages = useSemanticList
    ? semanticTotalPages
    : (allItemsData?.totalPages ?? 1);
  const itemsPage = useSemanticList
    ? semanticSafePage
    : (allItemsData?.page ?? listPage);

  const seoTotal = seoEntriesData?.total ?? filteredSeoEntries.length;
  const seoTotalPages = seoEntriesData?.totalPages ?? 1;
  const seoPage = seoEntriesData?.page ?? listPage;

  const hasDb = !!typeConfig?.database?.slug;
  const singleTemplateEnabled = !!typeConfig?.single_template;
  const [singleTemplateSaving, setSingleTemplateSaving] = useState(false);
  const [seoMonitoringSaving, setSeoMonitoringSaving] = useState(false);
  const seoMonitoringEnabled = typeConfig?.seo_monitoring?.enabled === true;
  const requireClusterEnabled = typeConfig?.seo_monitoring?.require_cluster === true;
  const [explainSharedLayoutOpen, setExplainSharedLayoutOpen] = useState(false);
  const [explainLinkedDatabaseOpen, setExplainLinkedDatabaseOpen] = useState(false);
  const [enableSharedLayoutOpen, setEnableSharedLayoutOpen] = useState(false);
  const [sharedLayoutUsableTemplate, setSharedLayoutUsableTemplate] = useState(false);
  const [sharedLayoutDivergences, setSharedLayoutDivergences] = useState<
    Array<{
      locale: string;
      sectionCount: number;
      sectionIds: string[];
      basename?: string;
      naming?: "template" | "single";
    }>
  >([]);
  const [sharedLayoutBindings, setSharedLayoutBindings] = useState<
    Array<{
      id: string;
      name?: string;
      component: string;
      locale: string;
      memberCount: number;
      members: Array<{ contentType: string; slug: string; sectionId: string }>;
    }>
  >([]);
  const [sharedLayoutReplacePreview, setSharedLayoutReplacePreview] = useState<{
    current: Array<{ locale: string; sectionCount: number; sectionIds: string[] }>;
    proposed: { locale: string; sectionCount: number; sectionIds: string[] };
    paths_to_overwrite: string[];
  } | null>(null);
  const [pendingEnablePayload, setPendingEnablePayload] =
    useState<SharedLayoutEnablePayload | null>(null);
  /** Template choice when connecting a database (B1). */
  const [dbConnectTemplatePayload, setDbConnectTemplatePayload] =
    useState<SharedLayoutEnablePayload | null>(null);
  const [dbConnectUsableTemplate, setDbConnectUsableTemplate] = useState(false);
  const [dbConnectDivergences, setDbConnectDivergences] = useState<
    Array<{
      locale: string;
      sectionCount: number;
      sectionIds: string[];
      basename?: string;
      naming?: "template" | "single";
    }>
  >([]);
  const [dbConnectBindings, setDbConnectBindings] = useState<
    Array<{
      id: string;
      name?: string;
      component: string;
      locale: string;
      memberCount: number;
      members: Array<{ contentType: string; slug: string; sectionId: string }>;
    }>
  >([]);

  const { data: databasesForLabel } = useQuery<DatabaseListItem[]>({
    queryKey: ["/api/databases"],
    enabled: hasDb,
    staleTime: 60000,
  });
  const linkedDbLabel =
    (dbSlug && databasesForLabel?.find((d) => d.name === dbSlug)?.label) || dbSlug || null;
  const applySingleTemplateToggle = async (
    checked: boolean,
    enablePayload?: SharedLayoutEnablePayload,
  ) => {
    setSingleTemplateSaving(true);
    try {
      const body: Record<string, unknown> = { single_template: checked };
      if (checked && enablePayload) {
        body.template_mode = enablePayload.template_mode;
        if (enablePayload.shared_layout_base_locale) {
          body.shared_layout_base_locale = enablePayload.shared_layout_base_locale;
        }
        if (enablePayload.template_entry_source_slug) {
          body.template_entry_source_slug = enablePayload.template_entry_source_slug;
        }
        if (enablePayload.template_entry_source_locale) {
          body.template_entry_source_locale = enablePayload.template_entry_source_locale;
        }
        if (enablePayload.confirm) body.confirm = true;
      }
      const res = await apiRequest("PUT", `/api/content-types/${contentType}/config`, body);
      const result = await res.json().catch(() => ({}));
      await queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });
      const dissolvedCount = result?.bindingsDissolved?.count ?? 0;
      toast({
        title: checked ? "Shared template on" : "Shared template off",
        description: checked
          ? dissolvedCount > 0
            ? `Shared layout enabled. Removed ${dissolvedCount} section binding${dissolvedCount === 1 ? "" : "s"}.`
            : "All entries share one layout from template.{locale}.yml."
          : "Each entry keeps its own full layout. Cross-locale sync is off.",
      });
      setEnableSharedLayoutOpen(false);
      setSharedLayoutReplacePreview(null);
      setPendingEnablePayload(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const jsonMatch = msg.match(/^\d+:\s*(\{[\s\S]*\})$/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]) as {
            code?: string;
            preview?: typeof sharedLayoutReplacePreview;
            error?: string;
          };
          if (parsed.code === "confirm_template_replace" && parsed.preview) {
            setPendingEnablePayload(enablePayload || null);
            setSharedLayoutReplacePreview(parsed.preview);
            return;
          }
          toast({
            title: "Failed to update shared template",
            description: parsed.error || msg,
            variant: "destructive",
          });
          return;
        } catch {
          /* fall through */
        }
      }
      toast({
        title: "Failed to update shared template",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSingleTemplateSaving(false);
    }
  };

  const saveSeoMonitoring = async (patch: { enabled: boolean; require_cluster?: boolean }) => {
    setSeoMonitoringSaving(true);
    try {
      const require_cluster =
        patch.require_cluster ?? (patch.enabled ? requireClusterEnabled : false);
      await apiRequest("PUT", `/api/content-types/${contentType}/config`, {
        seo_monitoring: patch.enabled
          ? { enabled: true, require_cluster: require_cluster }
          : { enabled: false, require_cluster: false },
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/seo/overview"] });
      toast({
        title: patch.enabled ? "SEO monitoring on" : "SEO monitoring off",
        description: patch.enabled
          ? "This type is included in seo-index.json and Cluster Map stats."
          : "Entries are excluded from cluster monitoring until re-enabled.",
      });
    } catch (err) {
      toast({
        title: "Failed to update SEO monitoring",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSeoMonitoringSaving(false);
    }
  };

  const handleToggleSingleTemplate = async (checked: boolean) => {
    if (!checked) {
      await applySingleTemplateToggle(false);
      return;
    }
    try {
      const res = await apiRequest("GET", `/api/content-types/${contentType}/shared-layout-status`);
      const data = await res.json();
      setSharedLayoutUsableTemplate(!!data.usable_template);
      setSharedLayoutDivergences(data.template_locales ?? data.locales ?? []);
      setSharedLayoutBindings(data.bindings ?? []);
    } catch {
      setSharedLayoutUsableTemplate(false);
      setSharedLayoutDivergences([]);
      setSharedLayoutBindings([]);
    }
    setSharedLayoutReplacePreview(null);
    setEnableSharedLayoutOpen(true);
  };

  const openConnectDatabase = async () => {
    const needsChoice = !hasDb && !singleTemplateEnabled;
    if (needsChoice) {
      try {
        const res = await apiRequest(
          "GET",
          `/api/content-types/${contentType}/shared-layout-status`,
        );
        const data = await res.json();
        setDbConnectUsableTemplate(!!data.usable_template);
        setDbConnectDivergences(data.template_locales ?? data.locales ?? []);
        setDbConnectBindings(data.bindings ?? []);
        setDbConnectTemplatePayload({
          template_mode: data.usable_template ? "keep_existing" : "from_entry",
          shared_layout_base_locale: "en",
        });
      } catch {
        setDbConnectUsableTemplate(false);
        setDbConnectDivergences([]);
        setDbConnectBindings([]);
        setDbConnectTemplatePayload({ template_mode: "from_entry" });
      }
    } else {
      setDbConnectTemplatePayload(null);
    }
    setConnectDbConfirmOpen(true);
  };

  const staticEntryCount =
    typeConfig?.static_entry_count !== undefined
      ? typeConfig.static_entry_count
      : staticLoading
        ? null
        : staticEntriesData?.total ?? staticEntriesData?.count ?? 0;
  const dbEntryCount = hasDb
    ? (dbItemsMetaLoading ? null : dbItemsMeta?.count ?? metaItems.length)
    : null;

  const defaultViewMode = hasDb ? "db" : "static";
  const prevDefaultRef = useRef(defaultViewMode);
  useEffect(() => {
    if (prevDefaultRef.current !== defaultViewMode) {
      prevDefaultRef.current = defaultViewMode;
      setViewMode(defaultViewMode);
    }
  }, [defaultViewMode]);

  const handleDeleteEntry = async (localesToDelete: string[]) => {
    if (!deletingEntry || deleteConfirmInput !== deletingEntry.slug) return;
    setIsDeletingEntry(true);
    try {
      const token = getDebugToken();
      const author = await resolveAuthorName();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;

      if (contentType === "authors") {
        const previewRes = await fetch("/api/content/delete-entries", {
          method: "POST",
          headers,
          body: JSON.stringify({
            contentType: "authors",
            slugs: [deletingEntry.slug],
            confirm: false,
            author,
          }),
        });
        const previewData = await previewRes.json();
        if (!previewRes.ok) {
          toast({
            title: "Error",
            description: previewData.error || "Failed to preview delete",
            variant: "destructive",
          });
          return;
        }
        const needs = (previewData.preview?.needs_reassignment || []) as Array<{ slug: string }>;
        const defaultAuthor = previewData.preview?.default_author_slug || "4geeks-academy";
        const reassignments: Record<string, string[]> = {};
        for (const row of needs) {
          reassignments[row.slug] = [defaultAuthor];
        }
        if (needs.length > 0) {
          const ok = window.confirm(
            `${needs.length} blog post(s) would lose their last author. Reassign to "${defaultAuthor}" and delete?`,
          );
          if (!ok) return;
        }
        const response = await fetch("/api/content/delete-entries", {
          method: "POST",
          headers,
          body: JSON.stringify({
            contentType: "authors",
            slugs: [deletingEntry.slug],
            confirm: true,
            reassignments,
            author,
          }),
        });
        const data = await response.json();
        if (response.ok) {
          const failed = Array.isArray(data.results)
            ? data.results.filter((r: { ok?: boolean }) => !r.ok)
            : [];
          toast({
            title: failed.length ? "Deleted with errors" : "Entry deleted",
            description: failed.length
              ? failed.map((f: { slug: string; error?: string }) => `${f.slug}: ${f.error}`).join("; ")
              : "Author removed; blog.authors updated.",
            variant: failed.length ? "destructive" : undefined,
          });
          setDeleteModalOpen(false);
          setDeletingEntry(null);
          setDeleteConfirmInput("");
          queryClient.invalidateQueries({
            queryKey: ["/api/content-types", contentType, "static-entries"],
          });
        } else {
          toast({
            title: "Error",
            description: data.error || "Failed to delete",
            variant: "destructive",
          });
        }
        return;
      }

      const response = await fetch("/api/content/delete", {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: contentType,
          slug: deletingEntry.slug,
          confirmSlug: deleteConfirmInput,
          author,
          ...(localesToDelete.length > 0 ? { localesToDelete } : {}),
        }),
      });
      const data = await response.json();
      if (response.ok) {
        toast({ title: "Entry deleted", description: data.message });
        setDeleteModalOpen(false);
        setDeletingEntry(null);
        setDeleteConfirmInput("");
        queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "static-entries"] });
      } else {
        toast({ title: "Error", description: data.error || "Failed to delete", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Connection error", variant: "destructive" });
    } finally {
      setIsDeletingEntry(false);
    }
  };

  const handleClearCache = async () => {
    setClearing(true);
    try {
      await apiRequest("POST", `/api/content-types/${contentType}/clear-cache`);
      toast({ title: `${label} cache cleared`, description: "Refreshing entries..." });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "cache-status"] });
      setClearCacheConfirmOpen(false);
    } catch {
      toast({ title: "Failed to clear cache", variant: "destructive" });
    } finally {
      setClearing(false);
    }
  };

  const resolveMappingSource = (raw: unknown): string | null => {
    if (!raw) return null;
    const val =
      typeof raw === "object" && raw !== null && "source" in raw
        ? (raw as { source: unknown }).source
        : raw;
    if (typeof val !== "string" || !val.trim() || val.startsWith("function:")) return null;
    return val.replace(/^(raw|db)\./, "").trim() || null;
  };

  const openDbEntryEdit = async (listItem: Record<string, any>) => {
    if (!dbSlug) {
      toast({ title: "No database connected", variant: "destructive" });
      return;
    }
    setOpeningDbEdit(true);
    try {
      const pageSize = 1000;
      let page = 1;
      let matched: { item: Record<string, unknown>; index: number } | null = null;
      const targetSlug = String(listItem.slug ?? "").trim();
      const targetLocale = localeKey ? String(listItem[localeKey] ?? "").trim() : "";
      const slugField = resolveMappingSource(typeConfig?.field_mapping?._slug) || "slug";

      while (!matched) {
        const res = await fetch(`/api/databases/${dbSlug}/items?limit=${pageSize}&page=${page}`);
        if (!res.ok) throw new Error(`Failed to load database items (${res.status})`);
        const data = await res.json();
        const pageItems: Record<string, unknown>[] = data.items || [];
        const total = typeof data.total_count === "number" ? data.total_count : pageItems.length;

        for (let i = 0; i < pageItems.length; i++) {
          const dbItem = pageItems[i];
          const dbSlugVal = String(dbItem[slugField] ?? dbItem.slug ?? "").trim();
          if (dbSlugVal !== targetSlug) continue;
          if (localeKey && targetLocale) {
            const dbLocale = String(dbItem[localeKey] ?? "").trim();
            if (dbLocale && dbLocale !== targetLocale) continue;
          }
          matched = { item: dbItem, index: (page - 1) * pageSize + i };
          break;
        }

        if (matched) break;
        if (pageItems.length === 0 || page * pageSize >= total) break;
        page += 1;
      }

      if (!matched) {
        toast({
          title: "Database entry not found",
          description: targetSlug
            ? `No row matched "${targetSlug}" in ${dbSlug}.`
            : `Could not resolve this entry in ${dbSlug}.`,
          variant: "destructive",
        });
        return;
      }

      setEditingDbEntry(matched);
    } catch (err) {
      toast({
        title: "Failed to open database entry",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setOpeningDbEdit(false);
    }
  };

  const handleOpenConvertDialog = async () => {
    setConvertConfirmInput("");
    setConvertDryRun(null);
    setConvertDialogOpen(true);
    setConvertDryRunLoading(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(`/api/content-types/${contentType}/convert-to-static`, {
        method: "POST",
        headers,
        body: JSON.stringify({ dry_run: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setConvertDryRun(data);
      } else {
        toast({
          title: "Cannot convert",
          description: data.error || "Failed to preview conversion",
          variant: "destructive",
        });
        setConvertDialogOpen(false);
      }
    } catch {
      toast({ title: "Cannot convert", description: "Connection error", variant: "destructive" });
      setConvertDialogOpen(false);
    } finally {
      setConvertDryRunLoading(false);
    }
  };

  const handleConvertToStatic = async () => {
    if (convertConfirmInput !== contentType) return;
    setIsConverting(true);
    try {
      const token = getDebugToken();
      const author = await resolveAuthorName();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(`/api/content-types/${contentType}/convert-to-static`, {
        method: "POST",
        headers,
        body: JSON.stringify({ dry_run: false, author }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "Converted to static",
          description: `Wrote ${data.written?.length ?? 0} new and ${data.overwritten?.length ?? 0} overwritten file(s). Database unlinked.`,
        });
        setConvertDialogOpen(false);
        setConvertConfirmInput("");
        setConvertDryRun(null);
        queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });
        queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
        queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "items"] });
        queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "static-entries"] });
        queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "cache-status"] });
        setViewMode("static");
      } else {
        toast({
          title: "Conversion failed",
          description: data.error || "Failed to convert",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Conversion failed", description: "Connection error", variant: "destructive" });
    } finally {
      setIsConverting(false);
    }
  };

  const handleOpenDeleteTypeDialog = async () => {
    setDeleteTypeConfirmInput("");
    setDryRunResult(null);
    setUrlsExpanded(false);
    setDeleteTypeDialogOpen(true);
    setDryRunLoading(true);
    try {
      const res = await fetch(`/api/content-types/${contentType}?dry_run=true`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setDryRunResult(data);
      }
    } catch {
    } finally {
      setDryRunLoading(false);
    }
  };

  const handleDeleteType = async () => {
    if (deleteTypeConfirmInput !== contentType) return;
    setIsDeletingType(true);
    try {
      const res = await apiRequest("DELETE", `/api/content-types/${contentType}`);
      const data = await res.json();
      if (data.success) {
        toast({ title: "Content type deleted", description: `"${contentType}" has been removed from content-types.yml.` });
        setDeleteTypeDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });
        navigate("/");
      } else {
        toast({ title: "Failed to delete content type", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Failed to delete content type", description: String(err), variant: "destructive" });
    } finally {
      setIsDeletingType(false);
    }
  };

  const fetchVersionsForEntry = async (slug: string) => {
    if (slug in versionsData || versionsLoading.has(slug)) return;
    setVersionsLoading(prev => new Set([...prev, slug]));
    try {
      const res = await fetch(`/api/versioning/${contentType}/${slug}`);
      const data = await res.json();
      setVersionsData(prev => ({ ...prev, [slug]: data.versioning || null }));
    } finally {
      setVersionsLoading(prev => { const next = new Set(prev); next.delete(slug); return next; });
    }
  };

  const handleCreateVersion = async () => {
    if (!createVersionEntry || !createVersionSlug) return;
    setIsCreatingVersion(true);
    try {
      const res = await apiRequest("POST", `/api/versioning/${contentType}/${createVersionEntry.slug}`, {
        variantSlug: createVersionSlug,
        locale: createVersionLocale,
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed to create version", variant: "destructive" });
        return;
      }
      toast({ title: `Version "${createVersionSlug}" created`, description: data.filePath });
      setCreateVersionOpen(false);
      setVersionsData(prev => { const next = { ...prev }; delete next[createVersionEntry.slug]; return next; });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "static-entries"] });
      navigate(`/private/${contentType}/${createVersionEntry.slug}/versions`);
    } catch {
      toast({ title: "Failed to create version", variant: "destructive" });
    } finally {
      setIsCreatingVersion(false);
    }
  };

  const copyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast({ title: "Copied", description: url, duration: 2000 });
  };

  const handleDownloadYml = async (slug: string) => {
    const token = getDebugToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Token ${token}`;
    try {
      const resolveRes = await fetch(`/api/content/resolve-folder?slug=${encodeURIComponent(slug)}`, { headers });
      if (!resolveRes.ok) {
        toast({ title: "No YAML found", description: "This entry has no YAML content files" });
        return;
      }
      const resolveData = await resolveRes.json();
      const entries: { directory: string; files: string[]; title?: string; contentType: string }[] = resolveData.multiple
        ? resolveData.matches
        : [resolveData];
      let downloadedCount = 0;
      for (const entry of entries) {
        for (const filename of entry.files) {
          try {
            const res = await fetch(`/api/content/file?path=${encodeURIComponent(`${entry.directory}/${filename}`)}`, { headers });
            if (!res.ok) continue;
            const text = await res.text();
            const blob = new Blob([text], { type: 'text/yaml' });
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = entries.length > 1 ? `${entry.contentType}-${slug}-${filename}` : `${slug}-${filename}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
            downloadedCount++;
          } catch {}
        }
      }
      if (downloadedCount > 0) {
        toast({ title: "Download complete", description: `Downloaded ${downloadedCount} YAML file(s) for "${slug}"` });
      } else {
        toast({ title: "No files found", description: `No YAML files could be downloaded for "${slug}"`, variant: "destructive" });
      }
    } catch {
      toast({ title: "Download failed", description: "An error occurred while downloading", variant: "destructive" });
    }
  };

  const handleEditYaml = async (entry: StaticEntry) => {
    const locale = entry.locales[0] || "en";
    const token = getDebugToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Token ${token}`;
    try {
      const res = await fetch(`/api/content/raw-file?contentType=${encodeURIComponent(contentType)}&slug=${encodeURIComponent(entry.slug)}&locale=${encodeURIComponent(locale)}`, { headers });
      if (!res.ok) {
        toast({ title: "No YAML found", description: "This entry has no YAML content files", variant: "destructive" });
        return;
      }
      const data = await res.json();
      if (!data.exists) {
        toast({ title: "No YAML found", description: "This entry has no YAML content files", variant: "destructive" });
        return;
      }
      setYamlEditorInfo({ contentType, slug: entry.slug, locale });
      setShowYamlEditor(true);
    } catch {
      toast({ title: "Error", description: "Failed to check YAML files", variant: "destructive" });
    }
  };

  const handleOpenSingleTemplate = async () => {
    const token = getDebugToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Token ${token}`;
    try {
      const res = await fetch(
        `/api/content/raw-file?contentType=${encodeURIComponent(contentType)}&slug=${encodeURIComponent("_common.template")}&locale=en`,
        { headers },
      );
      if (!res.ok) {
        toast({
          title: "No template found",
          description: "This content type has no _common.template.yml (or template.*.yml / legacy single.*) yet.",
          variant: "destructive",
        });
        return;
      }
      const data = await res.json();
      if (!data.exists) {
        toast({
          title: "No template found",
          description: "This content type has no _common.template.yml (or template.*.yml / legacy single.*) yet.",
          variant: "destructive",
        });
        return;
      }
      setYamlEditorInfo({ contentType, slug: "_common.template", locale: "en" });
      setShowYamlEditor(true);
    } catch {
      toast({ title: "Error", description: "Failed to open the single template", variant: "destructive" });
    }
  };

  const beginEditSeo = useCallback(
    async (slug: string, locale: string, initialTab?: SeoModalTab) => {
      try {
        const data = await resolveSeoContexts(contentType, slug, locale);
        if (data.contexts.length <= 1) {
          const choice: SeoContextChoice =
            data.default ?? data.contexts[0] ?? { type: "live" };
          setSeoModalTarget({
            contentType,
            slug,
            locale,
            initialTab,
            variant: choice.type === "variant" ? choice.variant : undefined,
          });
          setSeoModalOpen(true);
          return;
        }
        setSeoPickerPending({ slug, locale, initialTab });
        setSeoPickerOpen(true);
      } catch (e) {
        toast({
          title: "Failed to load SEO contexts",
          description: e instanceof Error ? e.message : "Could not list LIVE/variant contexts.",
          variant: "destructive",
        });
      }
    },
    [contentType, toast],
  );

  const handleDuplicate = async (entry: StaticEntry) => {
    const firstLocale = entry.locales[0] || "en";
    const firstUrl = entry.urls[firstLocale] || Object.values(entry.urls)[0] || "";
    const suggestedSlug = `${entry.slug}-copy`;
    setDuplicatingPage({
      loc: firstUrl || `/${firstLocale}/${entry.slug}`,
      label: entry.title,
      contentType,
      locale: firstLocale,
      sourceSlug: entry.slug,
      isDraft: entry.status === "draft",
    });
    setCreateContentType(contentType);
    setCreateContentTitle(`${entry.title} (Copy)`);
    setCreateContentSlugEn(suggestedSlug);
    setCreateContentSlugEs(suggestedSlug);
    setCreateContentSlugEnStatus('checking');
    setCreateContentSlugEsStatus('checking');
    setSlugEnConflictReason(null);
    setSlugEsConflictReason(null);
    setEditingSlugEn(true);
    setEditingSlugEs(true);
    setCreateModalOpen(true);
    try {
      const [enRes, esRes] = await Promise.all([
        fetch(`/api/content/check-slug?type=${encodeURIComponent(contentType)}&slug=${encodeURIComponent(suggestedSlug)}&locale=en`),
        fetch(`/api/content/check-slug?type=${encodeURIComponent(contentType)}&slug=${encodeURIComponent(suggestedSlug)}&locale=es`),
      ]);
      const [enData, esData] = await Promise.all([enRes.json(), esRes.json()]);
      setCreateContentSlugEnStatus(enData.available ? 'available' : 'taken');
      setSlugEnConflictReason(enData.available ? null : (enData.reason === 'redirect_conflict' ? `Conflicts with redirect: ${enData.conflictUrl} → ${enData.redirectTo}` : null));
      setCreateContentSlugEsStatus(esData.available ? 'available' : 'taken');
      setSlugEsConflictReason(esData.available ? null : (esData.reason === 'redirect_conflict' ? `Conflicts with redirect: ${esData.conflictUrl} → ${esData.redirectTo}` : null));
    } catch {
      setCreateContentSlugEnStatus('idle');
      setCreateContentSlugEsStatus('idle');
    }
  };

  const hasAuthorField = metaItems.some(p => p.author_name || p.author);
  const hasPublishedAt = metaItems.some(p => p.published_at);

  const toggleUpdatedSort = () => {
    setUpdatedSortDir((prev) => (prev === null ? "desc" : prev === "desc" ? "asc" : null));
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="inline-flex">
            <Button variant="ghost" size="icon" data-testid="button-back-home">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold" data-testid="text-page-title">{label} Management</h1>
            <p className="text-sm text-muted-foreground">
              Overview of all {contentType} entries and cache status{hasDb && <> — or by calling the <WebhookUrlPopover type={contentType} /></>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMappingDialogOpen(true)}
              data-testid="button-field-mappings"
            >
              <List className="h-4 w-4 mr-1" />
              Fields
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSeoDialogOpen(true)}
              data-testid="button-seo-settings"
            >
              <LinkIcon className="h-4 w-4 mr-1" />
              URLs
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStrategyDialogOpen(true)}
              data-testid="button-content-type-strategy"
              className={
                !isValidContentTypeStrategy(typeConfig?.strategy) &&
                Object.values(typeConfig?.editor || {}).some(
                  (h) => h?.required === true || h?.required === "attached",
                )
                  ? "border-destructive/50 text-destructive"
                  : undefined
              }
            >
              <IconChess className="h-4 w-4 mr-1" />
              Strategy
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" data-testid="button-more-actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleOpenDeleteTypeDialog}
                  className="text-destructive focus:text-destructive"
                  data-testid="button-delete-content-type"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Content Type
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {allIndexFields.length > 0 && metaItems.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {allIndexFields.map((idx) => {
              const isLocale = idx === localeKey;
              const counts: Record<string, number> = {};
              for (const item of metaItems) {
                const raw = item[idx];
                const tokens =
                  typeof raw === "string" && raw.includes(",")
                    ? raw.split(",").map((t) => t.trim()).filter(Boolean)
                    : fieldValueTokens(raw);
                for (const token of tokens) {
                  const t = token.toLowerCase();
                  if (t && t !== "[object object]") counts[t] = (counts[t] || 0) + 1;
                }
              }
              const sortedEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
              return (
                <Card key={idx} data-testid={`card-kpi-${idx}`}>
                  <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {isLocale ? "Language" : idx.charAt(0).toUpperCase() + idx.slice(1)}
                    </CardTitle>
                    {isLocale ? (
                      <Globe className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <LayoutList className="h-4 w-4 text-muted-foreground" />
                    )}
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const VISIBLE_COUNT = 2;
                      const visible = sortedEntries.slice(0, VISIBLE_COUNT);
                      const remaining = sortedEntries.length - VISIBLE_COUNT;
                      return (
                        <div className="flex flex-wrap gap-1.5">
                          {visible.map(([val, count]) => (
                            <Badge key={val} variant="secondary" className="text-xs" data-testid={`text-kpi-${idx}-${val}`}>
                              {dbItemsMetaLoading ? "..." : count}
                              <span className="ml-1 text-muted-foreground font-normal">
                                {isLocale ? val.toUpperCase() : val.charAt(0).toUpperCase() + val.slice(1)}
                              </span>
                            </Badge>
                          ))}
                          {remaining > 0 && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Badge variant="outline" className="text-xs cursor-pointer" data-testid={`button-view-more-${idx}`}>
                                  +{remaining} more
                                </Badge>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto max-w-xs p-3" align="start">
                                <div className="flex flex-wrap gap-1.5">
                                  {sortedEntries.slice(VISIBLE_COUNT).map(([val, count]) => (
                                    <Badge key={val} variant="secondary" className="text-xs" data-testid={`text-kpi-${idx}-${val}`}>
                                      {dbItemsMetaLoading ? "..." : count}
                                      <span className="ml-1 text-muted-foreground font-normal">
                                        {isLocale ? val.toUpperCase() : val.charAt(0).toUpperCase() + val.slice(1)}
                                      </span>
                                    </Badge>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <Card data-testid="card-kpi-seo-monitoring">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                SEO monitoring
              </CardTitle>
              <Switch
                checked={seoMonitoringEnabled}
                disabled={seoMonitoringSaving || typeConfig === undefined}
                onCheckedChange={(checked) => void saveSeoMonitoring({ enabled: checked })}
                data-testid="switch-seo-monitoring"
              />
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Include entries in seo-index.json and the SEO tab Cluster Map. Omitted in config = off.
              </p>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-xs text-muted-foreground">Require cluster</span>
                <Switch
                  checked={requireClusterEnabled}
                  disabled={
                    seoMonitoringSaving || !seoMonitoringEnabled || typeConfig === undefined
                  }
                  onCheckedChange={(checked) =>
                    void saveSeoMonitoring({ enabled: true, require_cluster: checked })
                  }
                  data-testid="switch-require-cluster"
                />
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-single-template">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Single template
              </CardTitle>
              <Switch
                checked={singleTemplateEnabled}
                disabled={singleTemplateSaving || typeConfig === undefined}
                onCheckedChange={handleToggleSingleTemplate}
                data-testid="switch-single-template"
              />
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Share one layout across every entry. Turn overrides on only when one page needs to look different.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => setExplainSharedLayoutOpen(true)}
                data-testid="button-single-template-advanced"
              >
                How shared layout works
              </button>
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={handleOpenSingleTemplate}
                data-testid="button-open-single-template"
              >
                Open template
              </button>
              </div>
            </CardContent>
          </Card>
          <EntryPreviewCard
            contentType={contentType}
            preview={typeConfig?.preview}
            fieldMapping={typeConfig?.field_mapping}
            queueBusyCount={entryPreviewQueueBusyCount}
            generateAllCounts={entryPreviewGenCounts}
            onGenerateAll={handleGenerateAllPreviews}
            onRetryQueued={handleRetryQueuedPreviews}
            configError={entryPreviewQueueData?.configError ?? null}
          />
          <Card data-testid="card-kpi-linked-database">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Linked Database
              </CardTitle>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid="button-data-source"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => void openConnectDatabase()}
                    data-testid="button-manage-connection"
                  >
                    <Database className="h-4 w-4 mr-2" />
                    {hasDb ? "Manage Connection" : "Add Connection"}
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild data-testid="button-open-database-page">
                    <Link href={dbSlug ? `/private/databases/${dbSlug}` : "/private/databases"}>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      {dbSlug ? "Open Database" : "Open Databases"}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setClearCacheConfirmOpen(true)}
                    disabled={clearing}
                    data-testid="button-clear-cache"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${clearing ? "animate-spin" : ""}`} />
                    Clear Cache
                  </DropdownMenuItem>
                  {hasDb && (
                    <DropdownMenuItem
                      onClick={handleOpenConvertDialog}
                      data-testid="button-convert-to-static"
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Convert to static
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent className="space-y-2">
              {!hasDb && (
                <Badge
                  variant="outline"
                  className="gap-1 text-xs font-medium text-muted-foreground no-default-active-elevate"
                  data-testid="badge-no-database"
                >
                  <Database className="h-3 w-3" />
                  No database
                </Badge>
              )}
              <p className="text-xs text-muted-foreground leading-relaxed">
                {hasDb ? (
                  <>
                    <Link
                      href={`/private/databases/${dbSlug}`}
                      className="inline-flex align-middle mr-1"
                      data-testid="link-linked-database-badge"
                    >
                      <Badge
                        variant="secondary"
                        className="gap-1 text-xs font-medium hover:bg-secondary/80 cursor-pointer no-default-active-elevate"
                      >
                        <Database className="h-3 w-3" />
                        {linkedDbLabel}
                      </Badge>
                    </Link>
                    — entries come from this database; field mapping maps columns onto this content type.
                  </>
                ) : (
                  "Entries live as static YAML. Connect a database to pull titles, slugs, and locales from an external source."
                )}
              </p>
              {hasDb && (
                <p className="text-sm font-medium" data-testid="text-linked-database-stats">
                  {cacheStatus?.exists &&
                  cacheStatus.post_count != null &&
                  cacheStatus.age_hours != null ? (
                    <>
                      <span data-testid="text-cache-age">
                        {cacheStatus.post_count} entries · Last cached {cacheStatus.age_hours}h ago
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground font-normal">
                      Cache empty — clear/refresh to fetch
                    </span>
                  )}
                </p>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setExplainLinkedDatabaseOpen(true)}
                  data-testid="button-linked-database-advanced"
                >
                  How linked databases work
                </button>
              </div>
            </CardContent>
          </Card>
          {hasSchemaOrgRequirements && (
            <Card data-testid="card-kpi-schema-org">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Schema.org
                </CardTitle>
                <Code className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="space-y-2">
                <div
                  className="rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground space-y-1"
                  data-testid="banner-schema-org-ct-education"
                >
                  <p className="text-foreground font-medium flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    Content-type requirements
                  </p>
                  <p>
                    Every location needs LocalBusiness; hubs are seeded from Miami/Madrid templates.
                    Attach binds a leading <code className="font-mono">schema_org</code> section on missing entries.
                  </p>
                </div>
                {schemaOrgCoverageLoading ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading coverage…
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Required:{" "}
                      <span className="font-mono text-foreground">
                        {(schemaOrgCoverage?.requirements?.length
                          ? schemaOrgCoverage.requirements
                          : schemaOrgRequirements
                        )
                          .map((r) => r.schema_type)
                          .join(", ")}
                      </span>
                    </p>
                    {(schemaOrgCoverage?.coverage ?? []).map((row) => {
                      const missing = row.missing_slugs ?? [];
                      return (
                        <div key={row.schema_type} className="space-y-1" data-testid={`schema-org-coverage-${row.schema_type}`}>
                          <p className="text-sm font-medium" data-testid="text-schema-org-coverage">
                            {row.schema_type}: {row.present}/{row.total}
                          </p>
                          {missing.length > 0 && (
                            <div>
                              <button
                                type="button"
                                className="text-xs text-primary hover:underline"
                                onClick={() => setSchemaOrgMissingOpen((v) => !v)}
                                data-testid="button-schema-org-missing-toggle"
                              >
                                {schemaOrgMissingOpen ? "Hide" : "Show"} {missing.length} missing slug
                                {missing.length !== 1 ? "s" : ""}
                              </button>
                              {schemaOrgMissingOpen && (
                                <ul
                                  className="mt-1 max-h-28 overflow-y-auto text-xs font-mono text-muted-foreground space-y-0.5"
                                  data-testid="list-schema-org-missing"
                                >
                                  {missing.map((slug) => (
                                    <li key={slug}>{slug}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={schemaOrgEnsuring || schemaOrgCoverageLoading}
                  onClick={handleSchemaOrgEnsure}
                  data-testid="button-schema-org-ensure"
                >
                  {schemaOrgEnsuring ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <LinkIcon className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Attach / bind
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ContentUpdateTimeline
        key={contentType}
        items={contentUpdateTimelineItems}
      />

      <div className="w-full pb-6" data-testid="content-type-entries-list">
          <div className="flex items-center gap-3 flex-wrap px-6 pt-6 pb-3">
              <div className="flex items-center gap-1" data-testid="toggle-view-mode">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`toggle-elevate ${viewMode === "static" ? "toggle-elevated" : ""}`}
                  onClick={() => setViewMode("static")}
                  data-testid="button-view-static"
                >
                  <Folder className="h-4 w-4 mr-1" />
                  Static Entries
                  <span className="ml-1.5 text-muted-foreground font-normal tabular-nums" data-testid="text-kpi-static">
                    ({staticEntryCount ?? "..."})
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`toggle-elevate ${viewMode === "db" ? "toggle-elevated" : ""}`}
                  onClick={() => setViewMode("db")}
                  data-testid="button-view-db"
                >
                  <Database className="h-4 w-4 mr-1" />
                  DB Entries
                  {hasDb && (
                    <span className="ml-1.5 text-muted-foreground font-normal tabular-nums" data-testid="text-kpi-db">
                      ({dbEntryCount ?? "..."})
                    </span>
                  )}
                </Button>
              </div>
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={`Search ${contentType} entries by title or slug...`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={`pl-9${search ? (viewMode === "db" && (semanticLoading || semanticActive) ? " pr-20" : " pr-8") : ""}`}
                  data-testid="input-search"
                />
                {search && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    {viewMode === "db" && search.trim() && (
                      semanticLoading ? (
                        <div className="h-3 w-3 animate-spin rounded-full border border-solid border-current border-r-transparent text-muted-foreground" />
                      ) : semanticActive ? (
                        <span
                          className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded"
                          title="Results ranked by semantic similarity"
                          data-testid="badge-semantic-search"
                        >
                          semantic
                        </span>
                      ) : null
                    )}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setSearch("");
                        setDebouncedSearch("");
                      }}
                      aria-label="Clear search"
                      data-testid="button-clear-search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    title="List perspective"
                    data-testid="button-list-perspective"
                  >
                    <Columns3 className="h-4 w-4" />
                    {listPerspective === "seo" ? "SEO" : "Default"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => setListPerspective("default")}
                    data-testid="menu-perspective-default"
                  >
                    <Check className={`h-4 w-4 mr-2 ${listPerspective === "default" ? "opacity-100" : "opacity-0"}`} />
                    Default
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setListPerspective("seo")}
                    data-testid="menu-perspective-seo"
                  >
                    <Check className={`h-4 w-4 mr-2 ${listPerspective === "seo" ? "opacity-100" : "opacity-0"}`} />
                    SEO
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {(() => {
                const facets = allItemsData?.facets ?? dbItemsMeta?.facets;
                if (viewMode !== "db" || !facets || Object.keys(facets).length === 0) return null;
                const activeFilterCount = Object.values(tagFilters).flat().length;
                return (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0 relative"
                        data-testid="button-open-filters"
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                        {activeFilterCount > 0 && (
                          <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center font-medium leading-none">
                            {activeFilterCount}
                          </span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent side="bottom" align="end" className="p-3 w-64" data-testid="tag-filter-bar">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium">Filters</p>
                          {activeFilterCount > 0 && (
                            <button
                              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer underline underline-offset-2"
                              onClick={() => setTagFilters({})}
                              data-testid="button-clear-tag-filters"
                            >
                              Clear all
                            </button>
                          )}
                        </div>
                        {Object.entries(facets).map(([field, values]) => {
                          const active = tagFilters[field] ?? [];
                          const available = values.filter((v) => !active.includes(v));
                          return (
                            <div key={field} className="space-y-1.5">
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{field}</p>
                              <Select
                                value=""
                                onValueChange={(v) => {
                                  setTagFilters((prev) => ({ ...prev, [field]: [...(prev[field] ?? []), v] }));
                                }}
                              >
                                <SelectTrigger className="h-7 text-xs" data-testid={`select-filter-${field}`}>
                                  <SelectValue placeholder="Add filter…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {available.length === 0 ? (
                                    <div className="px-2 py-1.5 text-xs text-muted-foreground">All selected</div>
                                  ) : (
                                    available.map((v) => (
                                      <SelectItem key={v} value={v} className="text-xs" data-testid={`chip-filter-${field}-${v}`}>
                                        {v}
                                      </SelectItem>
                                    ))
                                  )}
                                </SelectContent>
                              </Select>
                              {active.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {active.map((v) => (
                                    <span key={v} className="inline-flex items-center gap-0.5 bg-primary/10 text-primary text-[11px] rounded px-1.5 py-0.5">
                                      {v}
                                      <button
                                        className="ml-0.5 hover:text-foreground cursor-pointer"
                                        onClick={() => {
                                          setTagFilters((prev) => {
                                            const next = (prev[field] ?? []).filter((x) => x !== v);
                                            if (next.length === 0) {
                                              const { [field]: _, ...rest } = prev;
                                              return rest;
                                            }
                                            return { ...prev, [field]: next };
                                          });
                                        }}
                                      >
                                        <X className="h-2.5 w-2.5" />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                );
              })()}
            </div>
          <div>
            {listPerspective === "seo" ? (
              seoEntriesLoading || (seoEntriesFetching && !seoEntriesData) ? (
                <div className="flex items-center justify-center py-12" data-testid="loading-seo-entries">
                  <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading SEO entries...</span>
                </div>
              ) : seoEntriesData?.cache_missing ? (
                <div className="text-center py-12 text-muted-foreground space-y-3" data-testid="text-seo-cache-missing">
                  <p>Database cache missing — refresh the DB cache to load SEO entries.</p>
                </div>
              ) : filteredSeoEntries.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground" data-testid="text-no-seo-results">
                  No SEO entries found
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-seo-entries">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground w-[140px]">Image</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Meta</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground w-[160px]">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSeoEntries.map((entry) => {
                        const slug = entry.slug || "unknown";
                        const locale = entry.locale || "en";
                        const meta = entry.meta || {};
                        const issues = getMetaIssues(meta);
                        const pageTitle = typeof meta.page_title === "string" ? meta.page_title : "";
                        const description = typeof meta.description === "string" ? meta.description : "";
                        const robots = typeof meta.robots === "string" ? meta.robots : "";
                        const ogImage = typeof meta.og_image === "string" ? meta.og_image : "";
                        const canonical = typeof meta.canonical_url === "string" ? meta.canonical_url : "";
                        const priority = meta.priority != null && meta.priority !== "" ? String(meta.priority) : "";
                        const changeFreq = typeof meta.change_frequency === "string" ? meta.change_frequency : "";
                        const redirects = Array.isArray(meta.redirects) ? meta.redirects : [];
                        const rowKey = `${slug}-${locale}`;
                        const previewKey = `${slug}:${locale}`;
                        const previewRow = entryPreviewsData?.index?.[previewKey];
                        const captureSt = previewRow?.meta?.failedAt
                          ? "error"
                          : previewRow?.needsCapture && entryPreviewQueueBusyCount > 0
                            ? "capturing"
                            : previewRow?.cacheBustedUrl
                              ? "done"
                              : undefined;
                        const isUsableOg = isUsableOgImageUrl(ogImage);
                        const thumbSrc =
                          (isUsableOg ? ogImage : "") || previewRow?.cacheBustedUrl || "";
                        const displayThumbSrc = withOgThumbBust(previewKey, thumbSrc);
                        return (
                          <tr
                            key={rowKey}
                            className="border-b last:border-0 hover:bg-muted/30 transition-colors align-top"
                            data-testid={`row-seo-${rowKey}`}
                          >
                            <td className="px-4 py-3">
                              <div className="space-y-1.5">
                                <div className="relative w-[120px] h-[63px] flex-shrink-0 rounded-md overflow-hidden bg-muted">
                                  {displayThumbSrc ? (
                                    <a
                                      href={displayThumbSrc}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Open preview image"
                                      className="block w-full h-full hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                      data-testid={`link-seo-preview-thumb-${rowKey}`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <img
                                        key={ogThumbBustByKey[previewKey] ?? displayThumbSrc}
                                        src={displayThumbSrc}
                                        alt=""
                                        className="w-full h-full object-cover"
                                      />
                                    </a>
                                  ) : (
                                    <div
                                      className="w-full h-full flex items-center justify-center"
                                      data-testid={`placeholder-seo-preview-thumb-${rowKey}`}
                                    >
                                      {captureSt === "capturing" || captureSt === "queued" ? (
                                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                      ) : (
                                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                      )}
                                    </div>
                                  )}
                                </div>
                                {typeConfig?.preview?.component &&
                                  !previewRow?.fromSource &&
                                  entryPreviewsData?.captureReady !== false && (
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                      <button
                                        type="button"
                                        className={cn(
                                          "text-[10px] underline underline-offset-2 disabled:opacity-50 disabled:no-underline",
                                          captureSt === "failed"
                                            ? "text-destructive hover:text-destructive/90"
                                            : "text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300",
                                        )}
                                        disabled={captureSt === "capturing" || captureSt === "queued"}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void markEntryPreviewDirty(slug, locale);
                                        }}
                                        data-testid={`button-generate-seo-preview-${rowKey}`}
                                      >
                                        {captureSt === "capturing" || captureSt === "queued"
                                          ? "Generating…"
                                          : captureSt === "failed"
                                            ? "Retry OG"
                                            : thumbSrc
                                              ? "Regenerate OG"
                                              : "Generate OG"}
                                      </button>
                                      {ogAwaitingRefresh.has(previewKey) && (
                                        <button
                                          type="button"
                                          className="text-[10px] underline underline-offset-2 disabled:opacity-50 disabled:no-underline text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                                          disabled={captureSt === "capturing" || captureSt === "queued"}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void refreshOgPreviewRow(previewKey);
                                          }}
                                          data-testid={`button-refresh-seo-preview-${rowKey}`}
                                        >
                                          Refresh
                                        </button>
                                      )}
                                    </div>
                                  )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="space-y-1.5 text-xs min-w-0">
                                <div>
                                  <span className="text-muted-foreground mr-1.5">page_title</span>
                                  <span className={pageTitle ? "text-foreground" : "text-muted-foreground"} title={pageTitle || undefined}>
                                    {pageTitle || "—"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground mr-1.5">description</span>
                                  <span
                                    className={`inline ${description ? "text-foreground" : "text-muted-foreground"} line-clamp-2`}
                                    title={description || undefined}
                                  >
                                    {description || "—"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                                  <span>
                                    <span className="mr-1">robots</span>
                                    <span className={robots ? "text-foreground" : ""}>{robots || "—"}</span>
                                  </span>
                                  <span>
                                    <span className="mr-1">og_image</span>
                                    {(() => {
                                      const isUsableOg = isUsableOgImageUrl(ogImage);
                                      if (!isUsableOg) {
                                        return <span className="text-destructive">not set</span>;
                                      }
                                      return (
                                        <a
                                          href={ogImage}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="lowercase text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300"
                                          data-testid={`link-og-image-${rowKey}`}
                                        >
                                          open
                                        </a>
                                      );
                                    })()}
                                  </span>
                                  {canonical && (
                                    <span>
                                      <span className="mr-1">canonical</span>
                                      <span className="text-foreground truncate max-w-[200px] inline-block align-bottom" title={canonical}>
                                        {canonical}
                                      </span>
                                    </span>
                                  )}
                                  {priority && (
                                    <span>
                                      <span className="mr-1">priority</span>
                                      <span className="text-foreground">{priority}</span>
                                    </span>
                                  )}
                                  {changeFreq && (
                                    <span>
                                      <span className="mr-1">change_frequency</span>
                                      <span className="text-foreground">{changeFreq}</span>
                                    </span>
                                  )}
                                  {redirects.length > 0 && (
                                    <span>
                                      <span className="mr-1">redirects</span>
                                      <span className="text-foreground">{redirects.length}</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                {issues.length > 0 && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1.5 py-0 h-5 border-destructive/50 text-destructive bg-destructive/10"
                                    title={issues.map((i) => i.message).join("\n")}
                                    data-testid={`badge-meta-errors-${rowKey}`}
                                  >
                                    <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                                    {issues.length}
                                  </Badge>
                                )}
                                {entry.url && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs gap-1"
                                    asChild
                                  >
                                    <a href={entry.url} target="_blank" rel="noopener noreferrer" data-testid={`button-open-seo-${rowKey}`}>
                                      <ExternalLink className="h-3.5 w-3.5" />
                                      Open
                                    </a>
                                  </Button>
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs gap-1.5"
                                  data-testid={`button-edit-meta-${rowKey}`}
                                  onClick={() => {
                                    void beginEditSeo(slug, locale);
                                  }}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  Edit Meta
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            ) : viewMode === "static" ? (
              staticListLoading ? (
                <div className="flex items-center justify-center py-12" data-testid="loading-static">
                  <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading entries...</span>
                </div>
              ) : filteredStatic.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground" data-testid="text-no-results">
                  No static entries found
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-static-entries">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Locales</th>
                        <UpdatedAtSortHeader dir={updatedSortDir} onToggle={toggleUpdatedSort} />
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStatic.map((entry) => {
                        const firstUrl = entry.urls[entry.locales[0]] || Object.values(entry.urls)[0] || "";
                        return (
                          <tr
                            key={entry.slug}
                            className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                            data-testid={`row-static-${entry.slug}`}
                          >
                            <td className="px-4 py-3">
                              <div className="min-w-0">
                                <div className="font-medium truncate max-w-[300px]" title={entry.title} data-testid={`text-title-${entry.slug}`}>
                                  {entry.title}
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                  <div className="text-xs text-muted-foreground truncate max-w-[300px]">
                                    {entry.slug}
                                  </div>
                                  {entry.status === "draft" && (
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                                      data-testid={`badge-draft-${entry.slug}`}
                                    >
                                      Draft
                                    </Badge>
                                  )}
                                  {isPartialOverride(entry.slug) && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] px-1.5 py-0 h-4 cursor-pointer shrink-0 gap-0.5 border-violet-500/40 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
                                      data-testid={`badge-partial-override-${entry.slug}`}
                                      onClick={() => setPartialOverrideDialogOpen(true)}
                                    >
                                      <Info className="h-2.5 w-2.5" />
                                      Partial Override
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1 flex-wrap">
                                {entry.locales.length === 0 ? (
                                  <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400" title="Legacy format — click actions to migrate">
                                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                                    Legacy
                                  </span>
                                ) : (
                                  entry.locales.map((loc) => {
                                    const count = entry.versionCounts?.[loc];
                                    return (
                                      <Badge
                                        key={loc}
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        {loc.toUpperCase()}{count && count > 1 ? ` · ${count}` : ""}
                                      </Badge>
                                    );
                                  })
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground" data-testid={`text-updated-${entry.slug}`}>
                              {formatDate(entry.updated_at)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1">
                                {entry.status === "draft" && entry.previewPath ? (
                                  <Button variant="ghost" size="sm" className="text-xs gap-1.5" asChild data-testid={`button-open-${entry.slug}`}>
                                    <a href={entry.previewPath}>
                                      <ExternalLink className="h-3.5 w-3.5" />
                                      Preview draft
                                    </a>
                                  </Button>
                                ) : Object.keys(entry.urls).length > 0 && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="sm" className="text-xs gap-1.5" data-testid={`button-open-${entry.slug}`}>
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        Open
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      {Object.entries(entry.urls).flatMap(([loc, url]) => [
                                        <DropdownMenuItem key={`${loc}-new`} asChild>
                                          <a href={url} target="_blank" rel="noopener noreferrer" data-testid={`link-new-tab-${entry.slug}-${loc}`}>
                                            <ExternalLink className="h-4 w-4 mr-2" />
                                            Open in new tab ({loc.toUpperCase()})
                                          </a>
                                        </DropdownMenuItem>,
                                        <DropdownMenuItem key={`${loc}-same`} asChild>
                                          <a href={url} data-testid={`link-same-tab-${entry.slug}-${loc}`}>
                                            <ArrowLeft className="h-4 w-4 mr-2 rotate-180" />
                                            Open ({loc.toUpperCase()})
                                          </a>
                                        </DropdownMenuItem>,
                                      ])}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                                {entry.locales.length > 0 && (
                                  isPartialOverride(entry.slug) ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-xs gap-1.5"
                                      data-testid={`button-versions-${entry.slug}`}
                                      onClick={() => setPartialOverrideVersionsDialogOpen(true)}
                                    >
                                      <GitBranch className="h-3.5 w-3.5" />
                                      Versions
                                    </Button>
                                  ) : (
                                    <DropdownMenu onOpenChange={(open) => { if (open) fetchVersionsForEntry(entry.slug); }}>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" className="text-xs gap-1.5" data-testid={`button-versions-${entry.slug}`}>
                                          <GitBranch className="h-3.5 w-3.5" />
                                          Versions{entry.versionCounts && Object.keys(entry.versionCounts).length > 0 ? ` (${Object.values(entry.versionCounts).reduce((a, b) => a + b, 0)})` : ""}
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="min-w-[220px]">
                                        {versionsLoading.has(entry.slug) ? (
                                          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            Loading...
                                          </div>
                                        ) : !versionsData[entry.slug] || Object.keys(versionsData[entry.slug]!).length === 0 ? (
                                          <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                            No alternate versions for {Object.values(entry.urls)[0] ? new URL(Object.values(entry.urls)[0], window.location.origin).pathname : `/${entry.slug}`}, you can propose new versions here
                                          </div>
                                        ) : (
                                          Object.entries(versionsData[entry.slug]!).flatMap(([loc, localeData]) =>
                                            localeData.variants.map((variant) => (
                                              <DropdownMenuItem key={`${loc}-${variant.slug}`} asChild>
                                                <a
                                                  href={entry.urls[loc] ? `${entry.urls[loc].split("?")[0]}?force_variant=${variant.slug}` : "#"}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  data-testid={`link-variant-${entry.slug}-${loc}-${variant.slug}`}
                                                >
                                                  <GitBranch className="h-4 w-4 mr-2 flex-shrink-0" />
                                                  <span className="flex-1">{variant.slug}</span>
                                                  <span className="ml-2 text-xs text-muted-foreground">{loc.toUpperCase()} · {variant.allocation}%</span>
                                                </a>
                                              </DropdownMenuItem>
                                            ))
                                          )
                                        )}
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onClick={() => {
                                            setCreateVersionEntry(entry);
                                            setCreateVersionLocale(entry.locales[0] || "en");
                                            setCreateVersionSlug("");
                                            setCreateVersionOpen(true);
                                          }}
                                          data-testid={`button-new-version-${entry.slug}`}
                                        >
                                          <Plus className="h-4 w-4 mr-2" />
                                          New version...
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )
                                )}
                              {(Object.keys(entry.urls).length > 0 || entry.locales.length === 0) && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" data-testid={`button-actions-${entry.slug}`}>
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => copyUrl(firstUrl)}
                                      className="text-[13px]"
                                      data-testid={`menu-copy-url-${entry.slug}`}
                                    >
                                      <Clipboard className="h-4 w-4 mr-2" />
                                      Copy URL
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleDuplicate(entry)}
                                      className="text-[13px]"
                                      data-testid={`menu-duplicate-${entry.slug}`}
                                    >
                                      <Copy className="h-4 w-4 mr-2" />
                                      Duplicate
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleDownloadYml(entry.slug)}
                                      className="text-[13px]"
                                      data-testid={`menu-download-${entry.slug}`}
                                    >
                                      <Download className="h-4 w-4 mr-2" />
                                      Download YAML
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleEditYaml(entry)}
                                      className="text-[13px]"
                                      data-testid={`menu-edit-yaml-${entry.slug}`}
                                    >
                                      <Code className="h-4 w-4 mr-2" />
                                      Edit YAML
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        void beginEditSeo(
                                          entry.slug,
                                          entry.locales[0] || "en",
                                        );
                                      }}
                                      className="text-[13px]"
                                      data-testid={`menu-edit-page-meta-${entry.slug}`}
                                    >
                                      <Pencil className="h-4 w-4 mr-2" />
                                      Edit Page Meta
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        void beginEditSeo(
                                          entry.slug,
                                          entry.locales[0] || "en",
                                          "fields",
                                        );
                                      }}
                                      className="text-[13px]"
                                      data-testid={`menu-edit-fields-${entry.slug}`}
                                    >
                                      <Table2 className="h-4 w-4 mr-2" />
                                      Edit Fields & Values
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => { window.location.href = `/private/repository-sync?search=${encodeURIComponent(entry.slug)}`; }}
                                      className="text-[13px]"
                                      data-testid={`menu-changelog-${entry.slug}`}
                                    >
                                      <History className="h-4 w-4 mr-2" />
                                      View Change Log
                                    </DropdownMenuItem>
                                    {entry.locales.length === 0 && (
                                      <DropdownMenuItem
                                        onClick={async () => {
                                          try {
                                            const result = await apiRequest("POST", `/api/content-types/${contentType}/entries/${entry.slug}/migrate-legacy`);
                                            const data = await result.json();
                                            toast({ title: `Migrated — entry now uses ${data.locale}.yml` });
                                            queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "static-entries"] });
                                          } catch {
                                            toast({ title: "Migration failed", variant: "destructive" });
                                          }
                                        }}
                                        data-testid={`button-migrate-${entry.slug}`}
                                      >
                                        <Shuffle className="h-4 w-4 mr-2" />
                                        Migrate to standard format
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        try {
                                          await apiRequest("DELETE", `/api/content-types/${contentType}/cache/${entry.slug}`);
                                          toast({ title: `Cache refreshed for "${entry.slug}"` });
                                        } catch {
                                          toast({ title: "Failed to refresh cache", variant: "destructive" });
                                        }
                                      }}
                                      className="text-[13px]"
                                      data-testid={`menu-refresh-cache-${entry.slug}`}
                                    >
                                      <RefreshCw className="h-4 w-4 mr-2" />
                                      Refresh Cache
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setDeletingEntry(entry);
                                        setDeleteConfirmInput("");
                                        setDeleteModalOpen(true);
                                      }}
                                      className="text-destructive focus:text-destructive text-[13px]"
                                      data-testid={`button-delete-${entry.slug}`}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              (debouncedSearch.trim() ? semanticLoading : allLoading) ? (
                <div className="flex items-center justify-center py-12" data-testid="loading-items">
                  <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading entries...</span>
                </div>
              ) : !hasDb ? (
                <div className="text-center py-12 space-y-3" data-testid="text-no-database">
                  <Database className="h-8 w-8 mx-auto text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    You can link a database to create more {label} entries dynamically. You will be able to configure how these dynamic entries look in a template.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void openConnectDatabase()}
                    data-testid="button-link-database"
                  >
                    <Database className="h-4 w-4 mr-1" />
                    Link to Database
                  </Button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground" data-testid="text-no-results">
                  No DB entries found
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-items">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                        {hasAuthorField && <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Author</th>}
                        {allIndexFields.map((idx) => (
                          <th key={idx} className="text-left px-4 py-3 font-medium text-muted-foreground">
                            {idx === localeKey ? "Locales" : idx.charAt(0).toUpperCase() + idx.slice(1)}
                          </th>
                        ))}
                        {hasPublishedAt && <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Published</th>}
                        <UpdatedAtSortHeader
                          dir={updatedSortDir}
                          onToggle={toggleUpdatedSort}
                          className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell"
                        />
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((item) => {
                        const itemLocale = localeKey ? String(item[localeKey] || "en") : "en";
                        const pattern = itemLocale === "es" ? (urlPatterns.es || urlPatterns.en) : (urlPatterns.en || urlPatterns.default || "");
                        const itemUrl = pattern ? buildItemUrl(pattern, item, itemLocale) : "";
                        const previewKey = `${item.slug}:${itemLocale}`;
                        const previewRow = entryPreviewsData?.index?.[previewKey];
                        const captureSt = previewRow?.meta?.failedAt
                          ? "error"
                          : previewRow?.needsCapture && entryPreviewQueueBusyCount > 0
                            ? "capturing"
                            : previewRow?.cacheBustedUrl
                              ? "done"
                              : undefined;
                        const thumbSrc =
                          (typeof item.image === "string" && item.image.trim()) ||
                          (typeof item.preview === "string" && item.preview.trim()) ||
                          previewRow?.cacheBustedUrl ||
                          "";
                        const displayThumbSrc = withOgThumbBust(previewKey, thumbSrc);
                        return (
                          <tr
                            key={item.id || item.slug}
                            className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                            data-testid={`row-item-${item.id || item.slug}`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="relative w-10 h-10 flex-shrink-0 hidden sm:block">
                                  {displayThumbSrc ? (
                                    <a
                                      href={displayThumbSrc}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Open preview image"
                                      className="block w-10 h-10 rounded-md overflow-hidden hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                      data-testid={`link-entry-preview-thumb-${item.slug}`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <img
                                        key={ogThumbBustByKey[previewKey] ?? displayThumbSrc}
                                        src={displayThumbSrc}
                                        alt=""
                                        className="w-10 h-10 rounded-md object-cover"
                                      />
                                    </a>
                                  ) : (
                                    <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center">
                                      {captureSt === "capturing" || captureSt === "queued" ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                      ) : (
                                        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                      )}
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-medium truncate max-w-[300px]" title={item.title} data-testid={`text-title-${item.id || item.slug}`}>
                                    {item.title || item.slug}
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate max-w-[300px]">
                                    {item.slug}
                                  </div>
                                  {typeConfig?.preview?.component &&
                                    !previewRow?.fromSource &&
                                    entryPreviewsData?.captureReady !== false && (
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                        <button
                                          type="button"
                                          className={cn(
                                            "text-[10px] underline underline-offset-2 disabled:opacity-50 disabled:no-underline",
                                            captureSt === "failed"
                                              ? "text-destructive hover:text-destructive/90"
                                              : "text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300",
                                          )}
                                          disabled={captureSt === "capturing" || captureSt === "queued"}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void markEntryPreviewDirty(String(item.slug), itemLocale);
                                          }}
                                          data-testid={`button-generate-entry-preview-${item.id || item.slug}`}
                                        >
                                          {captureSt === "capturing" || captureSt === "queued"
                                            ? "Generating…"
                                            : captureSt === "failed"
                                              ? "Retry OG"
                                              : thumbSrc
                                                ? "Regenerate OG"
                                                : "Generate OG"}
                                        </button>
                                        {ogAwaitingRefresh.has(previewKey) && (
                                          <button
                                            type="button"
                                            className="text-[10px] underline underline-offset-2 disabled:opacity-50 disabled:no-underline text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                                            disabled={captureSt === "capturing" || captureSt === "queued"}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void refreshOgPreviewRow(previewKey);
                                            }}
                                            data-testid={`button-refresh-entry-preview-${item.id || item.slug}`}
                                          >
                                            Refresh
                                          </button>
                                        )}
                                      </div>
                                    )}
                                </div>
                              </div>
                            </td>
                            {hasAuthorField && (
                              <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                                {item.author_name
                                  ? `${item.author_name} ${item.author_last_name || ""}`.trim()
                                  : item.author
                                    ? `${item.author.first_name || ""} ${item.author.last_name || ""}`.trim()
                                    : "—"}
                              </td>
                            )}
                            {allIndexFields.map((idx) => {
                              const val = resolveItemField(item, idx);
                              const isLocale = idx === localeKey;
                              if (idx === "status") {
                                return (
                                  <td key={idx} className="px-4 py-3">
                                    <StatusBadge status={val} />
                                  </td>
                                );
                              }
                              if (isLocale) {
                                return (
                                  <td key={idx} className="px-4 py-3">
                                    <DbLangCell
                                      item={item}
                                      localeKey={localeKey}
                                      hreflangsSource={hreflangsSource}
                                      itemsBySlug={itemsBySlug}
                                    />
                                  </td>
                                );
                              }
                              return (
                                <td key={idx} className="px-4 py-3">
                                  <Badge variant="outline">
                                    {val.charAt(0).toUpperCase() + val.slice(1)}
                                  </Badge>
                                </td>
                              );
                            })}
                            {hasPublishedAt && (
                              <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                                {formatDate(item.published_at)}
                              </td>
                            )}
                            <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell" data-testid={`text-updated-${item.id || item.slug}`}>
                              {formatDate(item.updated_at as string | undefined)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" data-testid={`button-actions-${item.id || item.slug}`}>
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {itemUrl && (
                                    <>
                                      <DropdownMenuItem asChild>
                                        <a href={itemUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-new-tab-${item.id || item.slug}`}>
                                          <ExternalLink className="h-4 w-4 mr-2" />
                                          Open in new tab
                                        </a>
                                      </DropdownMenuItem>
                                      <DropdownMenuItem asChild>
                                        <a href={itemUrl} data-testid={`link-same-tab-${item.id || item.slug}`}>
                                          <ArrowLeft className="h-4 w-4 mr-2 rotate-180" />
                                          Open in this tab
                                        </a>
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                    </>
                                  )}
                                  {dbSlug && (
                                    <>
                                      <DropdownMenuItem
                                        onClick={() => openDbEntryEdit(item)}
                                        disabled={openingDbEdit}
                                        data-testid={`button-edit-db-entry-${item.id || item.slug}`}
                                      >
                                        {openingDbEdit ? (
                                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        ) : (
                                          <Pencil className="h-4 w-4 mr-2" />
                                        )}
                                        Edit database entry
                                      </DropdownMenuItem>
                                      <DropdownMenuItem asChild>
                                        <a
                                          href={`/private/databases/${dbSlug}`}
                                          data-testid={`link-open-database-${item.id || item.slug}`}
                                        >
                                          <Database className="h-4 w-4 mr-2" />
                                          Open in database
                                        </a>
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                    </>
                                  )}
                                  <DropdownMenuItem
                                    onClick={async () => {
                                      try {
                                        await apiRequest("DELETE", `/api/content-types/${contentType}/cache/${item.slug}`);
                                        toast({ title: `Cache refreshed for "${item.title || item.slug}"` });
                                      } catch {
                                        toast({ title: "Failed to refresh cache", variant: "destructive" });
                                      }
                                    }}
                                    data-testid={`button-clear-cache-${item.id || item.slug}`}
                                  >
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Refresh Cache
                                  </DropdownMenuItem>
                                  {typeConfig?.preview?.component && !previewRow?.fromSource && (
                                    <DropdownMenuItem
                                      onClick={() => markEntryPreviewDirty(String(item.slug), itemLocale)}
                                      data-testid={`button-regenerate-preview-${item.id || item.slug}`}
                                    >
                                      <ImageIcon className="h-4 w-4 mr-2" />
                                      Regenerate preview
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
            {listPerspective === "seo" && !seoEntriesLoading && filteredSeoEntries.length > 0 && (
              <div
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t"
                data-testid="text-showing-count"
              >
                <span className="text-xs text-muted-foreground tabular-nums">
                  {seoTotalPages > 1
                    ? `Page ${seoPage} of ${seoTotalPages} · ${seoTotal} SEO entries`
                    : `Showing ${filteredSeoEntries.length} of ${seoTotal} SEO entries`}
                </span>
                {seoTotalPages > 1 && (
                  <Pagination className="mx-0 w-auto justify-end" data-testid="pagination-seo-entries">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          aria-disabled={seoPage <= 1}
                          className={seoPage <= 1 ? "pointer-events-none opacity-50" : undefined}
                          onClick={(e) => {
                            e.preventDefault();
                            if (seoPage > 1) setListPage(seoPage - 1);
                          }}
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          aria-disabled={seoPage >= seoTotalPages}
                          className={seoPage >= seoTotalPages ? "pointer-events-none opacity-50" : undefined}
                          onClick={(e) => {
                            e.preventDefault();
                            if (seoPage < seoTotalPages) setListPage(seoPage + 1);
                          }}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                )}
              </div>
            )}
            {listPerspective === "default" && viewMode === "static" && !staticListLoading && filteredStatic.length > 0 && (
              <div
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t"
                data-testid="text-showing-count"
              >
                <span className="text-xs text-muted-foreground tabular-nums">
                  {staticTotalPages > 1
                    ? `Page ${staticPage} of ${staticTotalPages} · ${staticTotal} entries`
                    : `Showing ${filteredStatic.length} of ${staticTotal} entries`}
                </span>
                {staticTotalPages > 1 && (
                  <Pagination className="mx-0 w-auto justify-end" data-testid="pagination-static-entries">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          aria-disabled={staticPage <= 1}
                          className={staticPage <= 1 ? "pointer-events-none opacity-50" : undefined}
                          onClick={(e) => {
                            e.preventDefault();
                            if (staticPage > 1) setListPage(staticPage - 1);
                          }}
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          aria-disabled={staticPage >= staticTotalPages}
                          className={staticPage >= staticTotalPages ? "pointer-events-none opacity-50" : undefined}
                          onClick={(e) => {
                            e.preventDefault();
                            if (staticPage < staticTotalPages) setListPage(staticPage + 1);
                          }}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                )}
              </div>
            )}
            {listPerspective === "default" && viewMode === "db" && !(useSemanticList ? semanticLoading : allLoading) && filtered.length > 0 && (
              <div
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t"
                data-testid="text-showing-count"
              >
                <span className="text-xs text-muted-foreground tabular-nums">
                  {itemsTotalPages > 1
                    ? `Page ${itemsPage} of ${itemsTotalPages} · ${itemsTotal} entries`
                    : `Showing ${filtered.length} of ${itemsTotal} entries`}
                </span>
                {itemsTotalPages > 1 && (
                  <Pagination className="mx-0 w-auto justify-end" data-testid="pagination-db-entries">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          aria-disabled={itemsPage <= 1}
                          className={itemsPage <= 1 ? "pointer-events-none opacity-50" : undefined}
                          onClick={(e) => {
                            e.preventDefault();
                            if (itemsPage > 1) setListPage(itemsPage - 1);
                          }}
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          aria-disabled={itemsPage >= itemsTotalPages}
                          className={itemsPage >= itemsTotalPages ? "pointer-events-none opacity-50" : undefined}
                          onClick={(e) => {
                            e.preventDefault();
                            if (itemsPage < itemsTotalPages) setListPage(itemsPage + 1);
                          }}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                )}
              </div>
            )}
          </div>
      </div>

      <Dialog
        open={deleteTypeDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTypeDialogOpen(false);
            setDeleteTypeConfirmInput("");
            setDryRunResult(null);
            setUrlsExpanded(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-[480px]" data-testid="dialog-delete-content-type">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Content Type
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. The content type definition will be permanently removed from{" "}
              <span className="font-mono text-xs">content-types.yml</span> and synced to GitHub.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {dryRunLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking impact…
              </div>
            ) : dryRunResult ? (
              <div className="rounded-md border bg-muted/50 p-3 space-y-2 text-sm" data-testid="text-dry-run-result">
                <p className="text-foreground">{dryRunResult.message}</p>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1">
                  <span>
                    <span className="font-medium text-foreground">{dryRunResult.static_entry_count}</span> content file{dryRunResult.static_entry_count !== 1 ? "s" : ""} in{" "}
                    <span className="font-mono">4geeks-com/{dryRunResult.directory}/</span>
                  </span>
                  {dryRunResult.has_database && (
                    <span className="inline-flex items-center gap-1">
                      <Database className="h-3 w-3" />
                      Connected to <span className="font-mono">{dryRunResult.database_slug}</span>
                    </span>
                  )}
                </div>
                {dryRunResult.affected_urls.length > 0 && (
                  <div className="pt-1 space-y-1" data-testid="affected-urls-section">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
                      onClick={() => setUrlsExpanded(prev => !prev)}
                      data-testid="button-toggle-affected-urls"
                    >
                      {urlsExpanded
                        ? <IconChevronDown className="h-3 w-3" />
                        : <IconChevronRight className="h-3 w-3" />
                      }
                      {dryRunResult.affected_urls.length} URL{dryRunResult.affected_urls.length !== 1 ? "s" : ""} will stop working
                    </button>
                    {urlsExpanded && (
                      <ul className="pl-4 space-y-0.5 text-xs text-muted-foreground font-mono" data-testid="affected-urls-list">
                        {dryRunResult.affected_urls.slice(0, 10).map((url) => (
                          <li key={url}>
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 hover:underline text-muted-foreground hover:text-foreground transition-colors"
                              data-testid={`affected-url-link-${url}`}
                            >
                              {url}
                              <IconExternalLink className="h-3 w-3 flex-shrink-0" />
                            </a>
                          </li>
                        ))}
                        {dryRunResult.affected_urls.length > 10 && (
                          <li className="text-muted-foreground/70 font-sans" data-testid="affected-urls-overflow">
                            and {dryRunResult.affected_urls.length - 10} more…
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ) : null}
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="delete-type-confirm">
                Type <span className="font-mono font-bold">{contentType}</span> to confirm
              </label>
              <Input
                id="delete-type-confirm"
                value={deleteTypeConfirmInput}
                onChange={(e) => setDeleteTypeConfirmInput(e.target.value)}
                placeholder={contentType}
                data-testid="input-delete-type-confirm"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTypeDialogOpen(false);
                setDeleteTypeConfirmInput("");
                setDryRunResult(null);
              }}
              data-testid="button-cancel-delete-content-type"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteType}
              disabled={deleteTypeConfirmInput !== contentType || isDeletingType}
              data-testid="button-confirm-delete-content-type"
            >
              {isDeletingType ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Content Type
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={convertDialogOpen}
        onOpenChange={(open) => {
          setConvertDialogOpen(open);
          if (!open) {
            setConvertConfirmInput("");
            setConvertDryRun(null);
          }
        }}
      >
        <DialogContent className="max-w-lg" data-testid="dialog-convert-to-static">
          <DialogHeader>
            <DialogTitle>Convert to static</DialogTitle>
            <DialogDescription>
              Materialize all database entries into YAML folders and unlink the database from this content type.
              This cannot be automatically undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {convertDryRunLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="convert-dry-run-loading">
                <Loader2 className="h-4 w-4 animate-spin" />
                Previewing conversion…
              </div>
            ) : convertDryRun ? (
              <div className="space-y-3 text-sm" data-testid="convert-dry-run-result">
                <p className="text-muted-foreground">{convertDryRun.message}</p>
                <ul className="space-y-1 rounded-md border bg-muted/40 p-3 font-mono text-xs">
                  <li>Directory: {convertDryRun.directory}/</li>
                  <li>Database: {convertDryRun.database_slug}</li>
                  <li>Entries: {convertDryRun.entry_count}</li>
                  <li>Locales: {convertDryRun.locale_count}</li>
                  <li>New files: {convertDryRun.files_to_write}</li>
                  <li>Overwrite files: {convertDryRun.files_to_overwrite}</li>
                  <li>Existing overlays: {convertDryRun.existing_slug_folders.length}</li>
                  <li>Templates to delete: {convertDryRun.templates_to_delete.length}</li>
                </ul>
                <p className="text-destructive text-xs">
                  Existing per-entry overlay patches will be merged into full static YAML and overwritten.
                  Shared <code className="text-[11px]">template.*.yml</code> templates will be deleted.
                  Remote markdown bodies are inlined into the YAML.
                </p>
              </div>
            ) : null}
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="convert-type-confirm">
                Type <span className="font-mono font-bold">{contentType}</span> to confirm
              </label>
              <Input
                id="convert-type-confirm"
                value={convertConfirmInput}
                onChange={(e) => setConvertConfirmInput(e.target.value)}
                placeholder={contentType}
                data-testid="input-convert-to-static-confirm"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConvertDialogOpen(false);
                setConvertConfirmInput("");
                setConvertDryRun(null);
              }}
              data-testid="button-cancel-convert-to-static"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConvertToStatic}
              disabled={
                convertConfirmInput !== contentType ||
                isConverting ||
                convertDryRunLoading ||
                !convertDryRun
              }
              data-testid="button-confirm-convert-to-static"
            >
              {isConverting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Converting…
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  Convert to static
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClearCacheConfirmDialog
        open={clearCacheConfirmOpen}
        onOpenChange={setClearCacheConfirmOpen}
        onConfirm={handleClearCache}
        contentTypeLabel={label}
        clearing={clearing}
        cacheAgeHours={cacheStatus?.age_hours ?? null}
        postCount={cacheStatus?.post_count ?? null}
        databaseSlug={dbSlug}
        hasDatabase={hasDb}
      />
      {editingDbEntry && dbSlug && (
        <ItemEditModal
          dbName={dbSlug}
          item={editingDbEntry.item}
          title="Edit database entry"
          imageFallbackFieldKeys={(() => {
            const keys = new Set<string>(["image", "preview"]);
            const raw = typeConfig?.field_mapping?._image ?? typeConfig?.field_mapping?.image;
            const source =
              typeof raw === "string"
                ? raw
                : raw && typeof raw === "object" && "source" in raw
                  ? String((raw as { source: string }).source || "")
                  : "";
            const dbField = source.replace(/^\?/, "").trim();
            if (dbField) keys.add(dbField);
            return Array.from(keys);
          })()}
          imageFallbackPreviewSrc={(() => {
            const item = editingDbEntry.item;
            const itemLocale = localeKey ? String(item[localeKey] || "en") : "en";
            const previewKey = `${item.slug}:${itemLocale}`;
            const previewRow = entryPreviewsData?.index?.[previewKey];
            return previewRow?.cacheBustedUrl || null;
          })()}
          onSave={async (builtItem) => {
            const res = await fetch(`/api/databases/${dbSlug}/items/${editingDbEntry.index}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(builtItem),
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error((err as { error?: string }).error || "Failed to save item");
            }
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "items"] }),
              queryClient.invalidateQueries({ queryKey: ["/api/databases", dbSlug] }),
              queryClient.invalidateQueries({ queryKey: [`/api/databases/${dbSlug}/items`] }),
            ]);
          }}
          onClose={() => setEditingDbEntry(null)}
        />
      )}
      <ConnectDatabaseConfirmDialog
        open={connectDbConfirmOpen}
        onOpenChange={setConnectDbConfirmOpen}
        onConfirm={() => setDsDialogOpen(true)}
        contentType={contentType}
        contentTypeLabel={label}
        staticCount={typeof staticEntryCount === "number" ? staticEntryCount : staticEntriesData?.total ?? staticEntriesData?.count ?? 0}
        alreadyConnected={hasDb}
        needsTemplateChoice={!hasDb && !singleTemplateEnabled}
        usableTemplate={dbConnectUsableTemplate}
        divergences={dbConnectDivergences}
        bindings={dbConnectBindings}
        templatePayload={
          dbConnectTemplatePayload || {
            template_mode: dbConnectUsableTemplate ? "keep_existing" : "from_entry",
          }
        }
        onTemplatePayloadChange={(p) => setDbConnectTemplatePayload(p)}
      />
      <DataSourceDialog
        open={dsDialogOpen}
        onOpenChange={setDsDialogOpen}
        contentType={contentType}
        sharedLayoutEnablePayload={
          !hasDb && !singleTemplateEnabled ? dbConnectTemplatePayload : null
        }
      />
      <FieldMappingDialog
        open={mappingDialogOpen}
        onOpenChange={setMappingDialogOpen}
        contentType={contentType}
        onRequestStrategy={() => {
          setMappingDialogOpen(false);
          setStrategyDialogOpen(true);
        }}
      />
      <StrategyDialog
        open={strategyDialogOpen}
        onOpenChange={setStrategyDialogOpen}
        contentType={contentType}
      />
      <SeoSettingsDialog
        open={seoDialogOpen}
        onOpenChange={setSeoDialogOpen}
        contentType={contentType}
        staticCount={typeConfig?.static_entry_count ?? staticEntriesData?.total ?? staticEntriesData?.count ?? 0}
        dbCount={dbItemsMeta?.count ?? cacheStatus?.post_count ?? allItemsData?.total ?? 0}
      />
      <SharedLayoutExplainDialog
        open={explainSharedLayoutOpen}
        onClose={() => setExplainSharedLayoutOpen(false)}
        alwaysOn={hasDb}
      />
      <LinkedDatabaseExplainDialog
        open={explainLinkedDatabaseOpen}
        onClose={() => setExplainLinkedDatabaseOpen(false)}
        databaseSlug={dbSlug}
      />
      <SharedLayoutEnableDialog
        open={enableSharedLayoutOpen}
        onClose={() => {
          setEnableSharedLayoutOpen(false);
          setSharedLayoutReplacePreview(null);
          setPendingEnablePayload(null);
        }}
        onConfirm={async (payload) => {
          const merged = payload.confirm && pendingEnablePayload
            ? { ...pendingEnablePayload, confirm: true }
            : payload;
          await applySingleTemplateToggle(true, merged);
        }}
        contentType={contentType}
        usableTemplate={sharedLayoutUsableTemplate}
        divergences={sharedLayoutDivergences}
        bindings={sharedLayoutBindings}
        isLoading={singleTemplateSaving}
        replacePreview={sharedLayoutReplacePreview}
        onClearReplacePreview={() => {
          setSharedLayoutReplacePreview(null);
        }}
      />
      <DeletePageModal
        open={deleteModalOpen}
        onOpenChange={(open) => {
          setDeleteModalOpen(open);
          if (!open) {
            setDeletingEntry(null);
            setDeleteConfirmInput("");
          }
        }}
        deletingPage={deletingEntry ? { slug: deletingEntry.slug, contentType } : null}
        deleteConfirmInput={deleteConfirmInput}
        setDeleteConfirmInput={setDeleteConfirmInput}
        isDeletingPage={isDeletingEntry}
        onConfirm={handleDeleteEntry}
        availableLocales={deletingEntry?.locales}
        isPartialOverride={deletingEntry ? isPartialOverride(deletingEntry.slug) : false}
        publicUrls={deletingEntry?.urls}
      />
      <CreateContentModal
        open={createModalOpen}
        onOpenChange={(open) => {
          setCreateModalOpen(open);
          if (!open) setDuplicatingPage(null);
        }}
        duplicatingPage={duplicatingPage}
        createContentType={createContentType}
        setCreateContentType={setCreateContentType}
        createContentTitle={createContentTitle}
        setCreateContentTitle={setCreateContentTitle}
        createContentSlugEn={createContentSlugEn}
        setCreateContentSlugEn={setCreateContentSlugEn}
        createContentSlugEs={createContentSlugEs}
        setCreateContentSlugEs={setCreateContentSlugEs}
        createContentSlugEnStatus={createContentSlugEnStatus}
        setCreateContentSlugEnStatus={setCreateContentSlugEnStatus}
        createContentSlugEsStatus={createContentSlugEsStatus}
        setCreateContentSlugEsStatus={setCreateContentSlugEsStatus}
        slugEnConflictReason={slugEnConflictReason}
        setSlugEnConflictReason={setSlugEnConflictReason}
        slugEsConflictReason={slugEsConflictReason}
        setSlugEsConflictReason={setSlugEsConflictReason}
        editingSlugEn={editingSlugEn}
        setEditingSlugEn={setEditingSlugEn}
        editingSlugEs={editingSlugEs}
        setEditingSlugEs={setEditingSlugEs}
        isCreatingContent={isCreatingContent}
        setIsCreatingContent={setIsCreatingContent}
        setSitemapUrls={(_urls: SitemapUrl[]) => {
          queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "static-entries"] });
        }}
        setSitemapLoading={(_v: boolean) => {}}
        setDuplicatingPage={setDuplicatingPage}
        toast={toast}
      />
      {showYamlEditor && yamlEditorInfo && (
        <Suspense fallback={null}>
          <RawFileEditorPanel
            contentType={yamlEditorInfo.contentType}
            slug={yamlEditorInfo.slug}
            locale={yamlEditorInfo.locale}
            onClose={() => setShowYamlEditor(false)}
            onSaved={() => {
              setShowYamlEditor(false);
              if (
                yamlEditorInfo?.slug === "_common.template" ||
                yamlEditorInfo?.slug === "_common.single"
              ) {
                queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
                toast({ title: "Template saved" });
              } else {
                window.location.reload();
              }
            }}
          />
        </Suspense>
      )}

      <ManagedSeoModal
        open={seoModalOpen}
        onOpenChange={(open) => {
          setSeoModalOpen(open);
          if (!open) setSeoModalTarget(null);
        }}
        target={seoModalTarget}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "seo-entries"] });
          queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "static-entries"] });
        }}
      />

      {seoPickerPending && (
        <SeoContextPickerDialog
          open={seoPickerOpen}
          onOpenChange={(open) => {
            setSeoPickerOpen(open);
            if (!open) setSeoPickerPending(null);
          }}
          contentType={contentType}
          slug={seoPickerPending.slug}
          locale={seoPickerPending.locale}
          onConfirm={(choice) => {
            setSeoModalTarget({
              contentType,
              slug: seoPickerPending.slug,
              locale: seoPickerPending.locale,
              initialTab: seoPickerPending.initialTab,
              variant: choice.type === "variant" ? choice.variant : undefined,
            });
            setSeoPickerOpen(false);
            setSeoPickerPending(null);
            setSeoModalOpen(true);
          }}
        />
      )}

      <Dialog open={createVersionOpen} onOpenChange={(open) => {
        setCreateVersionOpen(open);
        if (!open) { setCreateVersionEntry(null); setCreateVersionSlug(""); }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Version</DialogTitle>
            <DialogDescription>
              A version is a copy of a page's content that can be A/B tested against the original.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Locale</label>
              <Select value={createVersionLocale} onValueChange={setCreateVersionLocale}>
                <SelectTrigger data-testid="select-version-locale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {createVersionEntry?.locales.map((loc) => (
                    <SelectItem key={loc} value={loc}>{loc.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Version name</label>
              <Input
                placeholder="e.g. colorful, dark-hero, new-cta"
                value={createVersionSlug}
                onChange={(e) => setCreateVersionSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                data-testid="input-version-slug"
              />
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens only.</p>
            </div>
            {createVersionEntry && createVersionSlug && (
              <div className="rounded-md bg-muted px-3 py-2 space-y-0.5">
                <p className="text-xs font-medium">File that will be created:</p>
                <p className="text-xs font-mono text-muted-foreground break-all">
                  {createVersionEntry.slug}/{createVersionSlug}.{createVersionLocale}.yml
                </p>
              </div>
            )}
            <div className="rounded-md bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">
                This version starts with <strong>0% traffic allocation</strong> — no real visitors will see it until you allocate traffic in the Versions editor. You can preview it anytime using the <code className="text-xs">?force_variant=</code> URL parameter.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateVersionOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreateVersion}
              disabled={!createVersionSlug || isCreatingVersion}
              data-testid="button-confirm-create-version"
            >
              {isCreatingVersion && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PartialOverrideDialog
        open={partialOverrideDialogOpen}
        onOpenChange={setPartialOverrideDialogOpen}
        contentTypeLabel={typeConfig?.label || label}
      />

      <PartialOverrideVersionsDialog
        open={partialOverrideVersionsDialogOpen}
        onOpenChange={setPartialOverrideVersionsDialogOpen}
      />
    </div>
  );
}
