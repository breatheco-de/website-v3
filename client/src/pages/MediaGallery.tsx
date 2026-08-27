import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {AlertTriangle, ArrowLeft, Check, CheckCheck, ChevronDown, Cloud, Copy, Eye, FileText, Film, Folder, Image, Layers, Link as LinkIcon, ListChecks, Loader2, MoreHorizontal, Replace, Search, Settings, Square, SquareCheck, Stethoscope, Tags, Terminal, Trash2, Upload, Wand2, Wrench, X} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "wouter";
import { useState, useEffect, useRef, type ChangeEvent } from "react";
import { useToast } from "@/hooks/use-toast";
import type { ImageRegistry } from "@shared/schema";
import {
  type MediaDoctype,
  acceptAttrForDoctype,
  inferDoctypeFromSrc,
} from "@shared/media-doctype";
import { ImagePickerDialog } from "@/components/editing/ImagePickerDialog";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import RunQueueSidebar, { type RunQueueItem } from "@/components/RunQueueSidebar";

interface DuplicateGroup {
  hash: string;
  ids: string[];
  canonical: string;
}

interface ScanResult {
  newImages: Array<{ id: string; src: string; filename: string }>;
  updatedImages: Array<{ id: string; oldSrc: string; newSrc: string }>;
  brokenReferences: Array<{ yamlFile: string; field: string; missingSrc: string }>;
  duplicates: DuplicateGroup[];
  hashesComputed: number;
  registeredCount: number;
  scannedImagesCount: number;
  summary: { new: number; updated: number; broken: number; duplicates: number };
}

interface BulkDeleteResult {
  id: string;
  success: boolean;
  message: string;
}

interface ValidationFixHint {
  type: "api" | "script" | "llm" | "manual";
  label: string;
  fixerName?: string;
  command?: string;
  url?: string;
}

interface ValidationIssue {
  type: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  suggestion?: string;
  fix?: ValidationFixHint;
}

interface ValidatorResult {
  name: string;
  description: string;
  status: "passed" | "failed" | "warning";
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  duration: number;
  artifacts?: Record<string, unknown>;
}

interface ValidationRunResult {
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    duration: number;
  };
  validators: ValidatorResult[];
}

interface FixerMeta {
  name: string;
  description: string;
}

interface OptimizeProgressData {
  initial: number;
  processed: number;
  failed: number;
  remaining: number;
  failedEntries: Array<{ id: string; error: string }>;
}

const IMAGE_HEALTH_VALIDATORS = ["images", "image-tags", "hero-image-tags", "image-optimization"];

/** Dedupe API fix hints from validator issues (same pattern as Diagnostics). */
function collectApiFixesFromValidator(v: ValidatorResult): Array<{ name: string; label: string; count: number }> {
  const map = new Map<string, { label: string; count: number }>();
  for (const issue of [...v.errors, ...v.warnings]) {
    if (issue.fix?.type === "api" && issue.fix.fixerName) {
      const fixerName = issue.fix.fixerName;
      const existing = map.get(fixerName);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(fixerName, { label: issue.fix.label?.trim() || fixerName, count: 1 });
      }
    }
  }
  return Array.from(map.entries()).map(([name, { label, count }]) => ({ name, label, count }));
}

type HealthIssueFixFilter = "all" | "api" | "manual" | "none" | "other";

function summarizeIssueFixKinds(v: ValidatorResult): {
  api: number;
  manual: number;
  script: number;
  llm: number;
  none: number;
} {
  const out = { api: 0, manual: 0, script: 0, llm: 0, none: 0 };
  for (const issue of [...v.errors, ...v.warnings]) {
    const t = issue.fix?.type;
    if (!t) out.none += 1;
    else if (t === "api") out.api += 1;
    else if (t === "manual") out.manual += 1;
    else if (t === "script") out.script += 1;
    else if (t === "llm") out.llm += 1;
    else out.none += 1;
  }
  return out;
}

function issueMatchesHealthFixFilter(issue: ValidationIssue, filter: HealthIssueFixFilter): boolean {
  if (filter === "all") return true;
  const t = issue.fix?.type;
  if (filter === "api") return t === "api";
  if (filter === "manual") return t === "manual";
  if (filter === "none") return !t;
  if (filter === "other") return t === "script" || t === "llm";
  return true;
}

function issueMatchesHealthSearch(issue: ValidationIssue, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [issue.code, issue.message, issue.suggestion, issue.file, issue.fix?.label]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/** Same surface colors as Image Health filter chips (primary/5, secondary, destructive/5, teal). */
function healthIssueLogBadgeClassName(issue: ValidationIssue): string {
  const t = issue.fix?.type;
  const base =
    "no-default-hover-elevate shrink-0 border font-normal text-[10px] px-1.5 py-0 shadow-none";
  if (t === "api") {
    return cn(base, "border-primary/25 bg-primary/5 text-foreground");
  }
  if (t === "manual") {
    return cn(base, "border-border bg-secondary text-secondary-foreground");
  }
  if (t === "script" || t === "llm") {
    return cn(
      base,
      "border-teal-500 bg-teal-200 text-teal-950 dark:border-teal-600 dark:bg-teal-950 dark:text-teal-100",
    );
  }
  return cn(base, "border-destructive/5 bg-destructive/5 text-destructive");
}

/** How to show each artifact key in Image Health (stats vs alert styling). */
type ArtifactShowKind = "stat" | "alert-error" | "alert-warning";

const VALIDATOR_ARTIFACT_PRESENTATION: Partial<
  Record<string, Partial<Record<string, ArtifactShowKind>>>
> = {
  images: {
    registryEntries: "stat",
    referencedIds: "stat",
    missingFromRegistry: "alert-error",
    missingFromDisk: "alert-error",
    placeholderAlts: "alert-warning",
    orphanedEntries: "alert-warning",
  },
  "image-tags": {
    totalImages: "stat",
    canonicalTagCount: "stat",
    untaggedCount: "alert-warning",
    invalidTagCount: "alert-warning",
    missingPresetCount: "alert-warning",
  },
  "image-optimization": {
    totalImages: "stat",
    optimized: "stat",
    skipped: "stat",
    needsOptimization: "alert-warning",
  },
  "hero-image-tags": {
    yamlFilesScanned: "stat",
    heroSectionsFound: "stat",
    uniqueHeroImages: "stat",
    correct: "stat",
    missingFromRegistry: "alert-warning",
    missingHeroTag: "alert-warning",
    missingHeroPreset: "alert-warning",
    parseErrors: "alert-error",
  },
};

function formatArtifactLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
}

function isZeroArtifactValue(value: unknown): boolean {
  if (typeof value === "number") return value === 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) && n === 0;
  }
  return false;
}

function partitionArtifacts(
  validatorName: string,
  artifacts: Record<string, unknown>,
): {
  stats: Array<[string, unknown]>;
  alertErrors: Array<[string, unknown]>;
  alertWarnings: Array<[string, unknown]>;
} {
  const stats: Array<[string, unknown]> = [];
  const alertErrors: Array<[string, unknown]> = [];
  const alertWarnings: Array<[string, unknown]> = [];
  const presentation = VALIDATOR_ARTIFACT_PRESENTATION[validatorName];

  for (const entry of Object.entries(artifacts)) {
    const [key, value] = entry;
    const kind = presentation?.[key];
    if (kind === "alert-error") {
      alertErrors.push(entry);
    } else if (kind === "alert-warning") {
      alertWarnings.push(entry);
    } else {
      stats.push(entry);
    }
  }

  return { stats, alertErrors, alertWarnings };
}

function OptimizationProgressPanel({
  optimizeDone,
  optimizeProgress,
  optimizeFailedOpen,
  setOptimizeFailedOpen,
  onDismiss,
}: {
  optimizeDone: boolean;
  optimizeProgress: OptimizeProgressData;
  optimizeFailedOpen: boolean;
  setOptimizeFailedOpen: (fn: (o: boolean) => boolean) => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="space-y-2" data-testid="panel-optimization-progress">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {optimizeDone
            ? "Complete"
            : optimizeProgress.processed === 0
              ? "Starting…"
              : optimizeProgress.remaining === 0
                ? "Finishing up…"
                : "Optimizing…"}
        </span>
        <div className="flex items-center gap-2">
          {optimizeProgress.failed > 0 && (
            <Badge
              variant="outline"
              className="text-amber-600 dark:text-amber-400 border-amber-400 dark:border-amber-600 text-xs"
              data-testid="badge-optimization-failed-count"
            >
              {optimizeProgress.failed} failed
            </Badge>
          )}
          <span className="text-xs text-muted-foreground" data-testid="text-optimization-count">
            {optimizeProgress.processed} of {optimizeProgress.initial} optimized
          </span>
          {optimizeDone && onDismiss && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              data-testid="button-dismiss-optimization"
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>
      <Progress
        value={optimizeProgress.initial > 0 ? (optimizeProgress.processed / optimizeProgress.initial) * 100 : 0}
        className="h-1.5"
        data-testid="progress-optimization"
      />
      {optimizeProgress.failedEntries.length > 0 && (
        <div className="space-y-1">
          <button
            type="button"
            className="text-xs text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
            onClick={() => setOptimizeFailedOpen(o => !o)}
            data-testid="button-toggle-failed-entries"
          >
            {optimizeFailedOpen ? "Hide" : "Show"} failed images ({optimizeProgress.failedEntries.length})
          </button>
          {optimizeFailedOpen && (
            <div className="max-h-32 overflow-y-auto space-y-1" data-testid="list-failed-entries">
              {optimizeProgress.failedEntries.map((entry) => (
                <div key={entry.id} className="text-xs flex gap-2 items-start">
                  <span className="font-mono text-muted-foreground shrink-0">{entry.id}</span>
                  <span className="text-destructive">{entry.error}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MediaGallery() {
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  const [doctypeFilter, setDoctypeFilter] = useState<MediaDoctype | "all">("all");
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [doctypeExpanded, setDoctypeExpanded] = useState(false);
  const [showDerived, setShowDerived] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteResults, setBulkDeleteResults] = useState<BulkDeleteResult[] | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replaceDuplicateId, setReplaceDuplicateId] = useState<string | null>(null);
  const [replacedAt, setReplacedAt] = useState<Record<string, number>>({});
  const replaceFileInputRef = useRef<HTMLInputElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsProviderView, setSettingsProviderView] = useState<string | null>(null);
  const [deduplicating, setDeduplicating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationRunResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState<OptimizeProgressData | null>(null);
  const [optimizeDone, setOptimizeDone] = useState(false);
  const [optimizeFailedOpen, setOptimizeFailedOpen] = useState(false);
  const optimizePollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [autoTagging, setAutoTagging] = useState(false);
  const [autoTagConfirmOpen, setAutoTagConfirmOpen] = useState(false);
  const [showAutoTagAdvanced, setShowAutoTagAdvanced] = useState(false);
  const [scanConfirmOpen, setScanConfirmOpen] = useState(false);
  const [showScanAdvanced, setShowScanAdvanced] = useState(false);
  const [migrateConfirmOpen, setMigrateConfirmOpen] = useState(false);
  const [migrateResults, setMigrateResults] = useState<{ message: string; migratedCount: number; totalProcessed: number; results: Array<{ id: string; oldSrc: string; newSrc: string; status: string }> } | null>(null);
  const [redundantOpen, setRedundantOpen] = useState(false);
  const [redundantResult, setRedundantResult] = useState<{ resolved: number; errors: string[] } | null>(null);
  const [redundantVisible, setRedundantVisible] = useState(10);
  const [detailImageId, setDetailImageId] = useState<string | null>(null);
  const [addMediaOpen, setAddMediaOpen] = useState(false);
  const [addMediaDoctype, setAddMediaDoctype] = useState<MediaDoctype>("image");
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const [scriptMigrateFrom, setScriptMigrateFrom] = useState("local");
  const [scriptMigrateTo, setScriptMigrateTo] = useState("gcs");
  const [scriptMigrateDryRun, setScriptMigrateDryRun] = useState(true);
  const [scriptMigrateRunning, setScriptMigrateRunning] = useState(false);
  const [scriptMigrateOutput, setScriptMigrateOutput] = useState<{ message: string; results: Array<{ id: string; oldSrc?: string; newSrc?: string; status: string }> } | null>(null);
  const [scriptRemoveUnusedDryRun, setScriptRemoveUnusedDryRun] = useState(true);
  const [scriptRemoveUnusedRunning, setScriptRemoveUnusedRunning] = useState(false);
  const [scriptRemoveUnusedOutput, setScriptRemoveUnusedOutput] = useState<{
    message: string;
    removedCount: number;
    skippedCount: number;
    cleanupErrorCount?: number;
    externalSkippedCount?: number;
    results: Array<{ id: string; src: string; status: string; reason?: string }>;
  } | null>(null);
  const [scriptRemoveUnusedProgress, setScriptRemoveUnusedProgress] = useState<{ processed: number; total: number } | null>(null);
  const [scriptRemoveUnusedStreamError, setScriptRemoveUnusedStreamError] = useState<string | null>(null);
  const [runningFixers, setRunningFixers] = useState<Record<string, boolean>>({});
  const [fixResultByFixer, setFixResultByFixer] = useState<Record<string, { ok: boolean; message: string }>>({});
  /** Per-validator row: filter issues by suggested fix type (Image Health Checks). */
  const [healthIssueFixFilter, setHealthIssueFixFilter] = useState<Record<string, HealthIssueFixFilter>>({});
  const [healthIssueSearchOpen, setHealthIssueSearchOpen] = useState<Record<string, boolean>>({});
  const [healthIssueSearchText, setHealthIssueSearchText] = useState<Record<string, string>>({});
  const [runQueueOpen, setRunQueueOpen] = useState(false);
  const [runQueueActivated, setRunQueueActivated] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  interface MediaStatus {
    defaultProvider: string;
    providers: string[];
    gcs?: { bucket: string; basePath: string; projectId?: string };
  }

  const { data: mediaStatus } = useQuery<MediaStatus>({
    queryKey: ["/api/media/status"],
  });

  const { data: registry, isLoading, error } = useQuery<ImageRegistry>({
    queryKey: ["/api/image-registry"],
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: fixerList = [] } = useQuery<FixerMeta[]>({
    queryKey: ["/api/validation/fixers"],
  });

  const hasFixerInFlight = Object.values(runningFixers).some(Boolean) || autoTagging;
  const { data: runQueueRuns = [], refetch: refetchRunQueueRuns } = useQuery<RunQueueItem[]>({
    queryKey: ["/api/validation/runs"],
    enabled: runQueueActivated || runQueueOpen,
    refetchInterval: (query) => {
      const runs = (query.state.data as RunQueueItem[] | undefined) ?? [];
      return hasFixerInFlight || runs.some((run) => run.running) ? 1500 : false;
    },
  });

  interface DbOverrideEntry {
    contentType: string;
    dbName: string;
    slug: string;
    fields: Record<string, string>;
  }

  const { data: overridesData, isLoading: overridesLoading } = useQuery<{ overrides: DbOverrideEntry[] }>({
    queryKey: ["/api/db-overrides"],
  });
  const activeOverrides = overridesData?.overrides ?? [];

  const resetOverrideMutation = useMutation({
    mutationFn: ({ contentType, slug, field }: { contentType: string; slug: string; field?: string }) => {
      const url = field
        ? `/api/content-types/${contentType}/db-overrides/${encodeURIComponent(slug)}?field=${encodeURIComponent(field)}`
        : `/api/content-types/${contentType}/db-overrides/${encodeURIComponent(slug)}`;
      return apiRequest("DELETE", url).then(r => r.json());
    },
    onSuccess: (data) => {
      toast({ title: "Override reset", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/db-overrides"] });
    },
    onError: (err: any) => {
      toast({ title: "Reset failed", description: err.message || "Could not reset override", variant: "destructive" });
    },
  });

  const [overridesOpen, setOverridesOpen] = useState(false);
  const [selectedDb, setSelectedDb] = useState<string>("all");
  const [confirmResetDb, setConfirmResetDb] = useState<string | null>(null);
  const [resettingDb, setResettingDb] = useState(false);

  const handleResetAllForDb = async (contentType: string) => {
    setResettingDb(true);
    try {
      const entries = activeOverrides.filter((e) => e.contentType === contentType);
      for (const entry of entries) {
        await apiRequest("DELETE", `/api/content-types/${entry.contentType}/db-overrides/${encodeURIComponent(entry.slug)}`);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/db-overrides"] });
      toast({ title: "Overrides cleared", description: `All overrides for "${contentType}" have been reset.` });
    } catch (err: unknown) {
      toast({ title: "Reset failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setResettingDb(false);
      setConfirmResetDb(null);
    }
  };

  interface RedundantImage { id: string; cloudUrl: string; localPath: string; }
  const { data: redundantData } = useQuery<{ count: number; images: RedundantImage[] }>({
    queryKey: ["/api/image-registry/redundant"],
  });
  const redundantCount = redundantData?.count ?? 0;

  const resolveRedundancyMutation = useMutation({
    mutationFn: (action: "delete-local" | "delete-cloud") =>
      apiRequest("POST", "/api/image-registry/redundant/resolve", { action }).then(r => r.json()),
    onSuccess: (data) => {
      setRedundantResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-registry/redundant"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to resolve redundancy", variant: "destructive" });
    },
  });

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleImageError = (id: string) => {
    setFailedImages(prev => new Set(prev).add(id));
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/image-registry/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        const usedIn = data.usedIn as string[] | undefined;
        toast({
          title: "Cannot delete",
          description: usedIn
            ? `"${id}" is used in: ${usedIn.join(", ")}`
            : data.message || data.error,
          variant: "destructive",
          duration: 8000,
        });
        return false;
      }
      toast({ title: "Deleted", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
      return true;
    } catch {
      toast({ title: "Delete failed", description: "Could not delete image from registry", variant: "destructive" });
      return false;
    }
  };

  const getChildIdsFor = (parentId: string): string[] => {
    if (!registry?.images) return [];
    return Object.entries(registry.images)
      .filter(([, img]) => (img as { parentId?: string }).parentId === parentId)
      .map(([childId]) => childId);
  };

  const openReplacePicker = (id: string) => {
    setReplaceTargetId(id);
    setReplaceFile(null);
    setReplaceDuplicateId(null);
    requestAnimationFrame(() => {
      replaceFileInputRef.current?.click();
    });
  };

  const handleReplaceFileSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file || !replaceTargetId) {
      setReplaceTargetId(null);
      return;
    }
    setReplaceFile(file);
    setReplaceConfirmOpen(true);
  };

  const cancelReplaceFlow = () => {
    if (replacing) return;
    setReplaceConfirmOpen(false);
    setReplaceFile(null);
    setReplaceTargetId(null);
  };

  const confirmReplace = async () => {
    if (!replaceTargetId || !replaceFile) return;
    setReplacing(true);
    try {
      const formData = new FormData();
      formData.append("file", replaceFile);
      const res = await fetch(
        `/api/image-registry/${encodeURIComponent(replaceTargetId)}/replace`,
        {
          method: "POST",
          credentials: "include",
          headers: getSessionHeaders(),
          body: formData,
        },
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.existingId) {
        setReplaceConfirmOpen(false);
        setReplaceFile(null);
        setReplaceDuplicateId(data.existingId as string);
        return;
      }
      if (!res.ok) {
        toast({
          title: "Replace failed",
          description: data.error || "Could not replace image",
          variant: "destructive",
        });
        return;
      }
      const id = replaceTargetId;
      setReplacedAt((prev) => ({ ...prev, [id]: Date.now() }));
      setFailedImages((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast({
        title: data.noop ? "Already up to date" : "Replaced",
        description: data.noop
          ? `"${id}" already has this file`
          : `"${id}" updated${data.srcChanged ? " (storage path changed)" : ""}. Srcsets regenerating in the background.`,
      });
      setReplaceConfirmOpen(false);
      setReplaceFile(null);
      setReplaceTargetId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
    } catch {
      toast({
        title: "Replace failed",
        description: "Could not replace image",
        variant: "destructive",
      });
    } finally {
      setReplacing(false);
    }
  };

  const confirmSingleDelete = async () => {
    if (!deleteConfirmId) return;
    setDeleting(true);
    try {
      await handleDelete(deleteConfirmId);
    } finally {
      setDeleting(false);
      setDeleteConfirmId(null);
    }
  };

  const handleScan = async () => {
    setScanConfirmOpen(false);
    setShowScanAdvanced(false);
    setScanning(true);
    setScanResult(null);
    setValidationResult(null);
    setFixResultByFixer({});
    setHealthIssueFixFilter({});
    setHealthIssueSearchOpen({});
    setHealthIssueSearchText({});
    try {
      const [scanRes, validationRes] = await Promise.all([
        apiRequest("POST", "/api/image-registry/scan"),
        apiRequest("POST", "/api/validation/run", {
          validators: IMAGE_HEALTH_VALIDATORS,
          includeArtifacts: true,
        }),
      ]);
      const scanData: ScanResult = await scanRes.json();
      setScanResult(scanData);
      const validationData: ValidationRunResult = await validationRes.json();
      setValidationResult(validationData);
    } catch {
      toast({ title: "Scan failed", description: "Could not scan image registry", variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const rerunImageHealthChecks = async () => {
    const validationRes = await apiRequest("POST", "/api/validation/run", {
      validators: IMAGE_HEALTH_VALIDATORS,
      includeArtifacts: true,
    });
    const validationData: ValidationRunResult = await validationRes.json();
    setValidationResult(validationData);
  };

  const startOptimizationPoller = (initialFallback: number) => {
    if (optimizePollerRef.current) clearInterval(optimizePollerRef.current);
    optimizePollerRef.current = setInterval(async () => {
      try {
        const statusRes = await fetch("/api/image-registry/optimize-status");
        const status = await statusRes.json();
        const initial = status.initial || initialFallback;
        setOptimizeProgress({
          initial,
          processed: status.processed,
          failed: status.failed,
          remaining: status.remaining,
          failedEntries: status.failedEntries ?? [],
        });
        if (!status.active) {
          if (optimizePollerRef.current) clearInterval(optimizePollerRef.current);
          optimizePollerRef.current = null;
          setOptimizing(false);
          setOptimizeDone(true);
          const succeeded = initial - status.failed;
          toast({
            title: "Optimization complete",
            description: status.failed > 0
              ? `${succeeded} succeeded, ${status.failed} failed`
              : `${succeeded} image(s) optimized successfully`,
            variant: status.failed > 0 ? "destructive" : "default",
          });
        }
      } catch {
        if (optimizePollerRef.current) clearInterval(optimizePollerRef.current);
        optimizePollerRef.current = null;
        setOptimizing(false);
      }
    }, 1500);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/image-registry/optimize-status");
        const status = await res.json();
        if (status.active) {
          const initialFallback = status.initial > 0
            ? status.initial
            : status.remaining + status.failed + (status.processed ?? 0);
          setOptimizing(true);
          setOptimizeDone(false);
          setOptimizeProgress({
            initial: initialFallback,
            processed: status.processed,
            failed: status.failed,
            remaining: status.remaining,
            failedEntries: status.failedEntries ?? [],
          });
          startOptimizationPoller(initialFallback);
        }
      } catch {
        // ignore — best-effort resume on page load
      }
    })();
  }, [startOptimizationPoller]);

  const handleDismissOptimization = () => {
    setOptimizing(false);
    setOptimizeDone(false);
    setOptimizeProgress(null);
  };

  const untaggedImageCount = registry
    ? Object.values(registry.images).filter((img) => !img.tags || img.tags.length === 0).length
    : 0;

  const handleAutoTag = async () => {
    setAutoTagConfirmOpen(false);
    setAutoTagging(true);
    setRunQueueActivated(true);
    setRunQueueOpen(true);
    void refetchRunQueueRuns();
    try {
      const res = await apiRequest("POST", "/api/validation/fix/image-auto-tags");
      const data = await res.json();
      toast({
        title: "Auto-tag complete",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
      queryClient.invalidateQueries({ queryKey: ["/api/validation/runs"] });
      void refetchRunQueueRuns();
    } catch {
      toast({ title: "Auto-tag failed", description: "Could not auto-tag images", variant: "destructive" });
    } finally {
      setAutoTagging(false);
    }
  };

  const handleRunApiFixer = async (fixerName: string) => {
    setRunQueueActivated(true);
    setRunQueueOpen(true);
    setRunningFixers((prev) => ({ ...prev, [fixerName]: true }));
    void refetchRunQueueRuns();
    try {
      const res = await apiRequest("POST", `/api/validation/fix/${fixerName}`);
      const data = await res.json();
      if (Array.isArray(data.runIds) && data.runIds.length > 0) {
        queryClient.setQueryData<RunQueueItem[]>(["/api/validation/runs"], (prev = []) => {
          const existingById = new Map(prev.map((run) => [run.runId, run]));
          const next = [...prev];
          data.runIds.forEach((runId: string, index: number) => {
            if (existingById.has(runId)) return;
            next.unshift({
              runId,
              pipelineRoot: fixerName,
              fixerName: Array.isArray(data.pipeline) ? (data.pipeline[index] ?? fixerName) : fixerName,
              running: false,
              total: 0,
              processed: 0,
              ok: 0,
              skipped: 0,
              failed: 0,
              startedAt: Date.now(),
              completedAt: Date.now(),
              message: data.message || "Fixer completed",
              log: [],
            });
          });
          return next;
        });
      }
      setFixResultByFixer((prev) => ({
        ...prev,
        [fixerName]: {
          ok: Boolean(data.ok),
          message: data.message || "Fixer completed",
        },
      }));
      toast({ title: data.ok ? "Fix completed" : "Fix completed with errors", description: data.message || fixerName });
      await rerunImageHealthChecks();
      await queryClient.invalidateQueries({ queryKey: ["/api/validation/runs"] });
      await refetchRunQueueRuns();
    } catch {
      setFixResultByFixer((prev) => ({
        ...prev,
        [fixerName]: { ok: false, message: "Could not run fixer" },
      }));
      toast({ title: "Fix failed", description: "Could not run fixer", variant: "destructive" });
    } finally {
      setRunningFixers((prev) => ({ ...prev, [fixerName]: false }));
    }
  };

  const handleClearRunQueue = async () => {
    try {
      const res = await apiRequest("POST", "/api/validation/runs/clear");
      const data = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/validation/runs"] });
      await refetchRunQueueRuns();
      toast({
        title: "Runs cleared",
        description: `Cleared ${data.cleared ?? 0} run(s) from memory`,
      });
    } catch {
      toast({
        title: "Could not clear runs",
        description: "Try again in a moment",
        variant: "destructive",
      });
    }
  };

  const handleApply = async (action: "add" | "update") => {
    setApplying(true);
    try {
      const res = await apiRequest("POST", `/api/image-registry/apply?action=${action}`);
      const data = await res.json();
      toast({ title: "Applied", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
      const refreshed = await apiRequest("POST", "/api/image-registry/scan");
      const freshScan: ScanResult = await refreshed.json();
      if (freshScan.summary.new === 0 && freshScan.summary.updated === 0 && freshScan.summary.broken === 0 && freshScan.summary.duplicates === 0) {
        setScanResult(null);
      } else {
        setScanResult(freshScan);
      }
    } catch {
      toast({ title: "Apply failed", description: "Could not apply changes", variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  const handleDeduplicate = async () => {
    setDeduplicating(true);
    try {
      const res = await apiRequest("POST", "/api/image-registry/deduplicate");
      const data = await res.json();
      toast({ title: "Duplicates removed", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
      const refreshed = await apiRequest("POST", "/api/image-registry/scan");
      const freshScan: ScanResult = await refreshed.json();
      if (freshScan.summary.new === 0 && freshScan.summary.updated === 0 && freshScan.summary.broken === 0 && freshScan.summary.duplicates === 0) {
        setScanResult(null);
      } else {
        setScanResult(freshScan);
      }
    } catch {
      toast({ title: "Deduplication failed", description: "Could not remove duplicates", variant: "destructive" });
    } finally {
      setDeduplicating(false);
    }
  };

  const toggleImageSelection = (id: string) => {
    setSelectedImages(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const localImageCount = registry?.images
    ? Object.values(registry.images).filter(img => !img.src.startsWith("http")).length
    : 0;

  const cloudProvider = mediaStatus?.providers.find(p => p !== "local") ?? null;
  const cloudProviderLabel = cloudProvider === "gcs" ? "Google Bucket" : cloudProvider ?? "";

  const handleMigrate = async () => {
    setMigrateConfirmOpen(false);
    setMigrating(true);
    try {
      const res = await apiRequest("POST", "/api/image-registry/migrate", {
        from: "local",
        to: cloudProvider,
      });
      const data = await res.json();
      setMigrateResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
      toast({
        title: "Migration complete",
        description: data.message,
      });
    } catch (err: any) {
      toast({
        title: "Migration failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setMigrating(false);
    }
  };

  const PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const availableTags = (() => {
    if (registry?.tagDefinitions && Object.keys(registry.tagDefinitions).length > 0) {
      return Object.entries(registry.tagDefinitions).map(([key, def]) => ({
        key,
        label: def.label || key,
      }));
    }
    const seen = new Set<string>();
    for (const img of Object.values(registry?.images ?? {})) {
      for (const t of img.tags ?? []) {
        if (t) seen.add(t);
      }
    }
    return Array.from(seen)
      .sort()
      .map((key) => ({ key, label: key }));
  })();

  const toggleTagFilter = (key: string) => {
    setActiveTagFilters((prev) =>
      prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key],
    );
  };

  const DOCTYPE_OPTIONS = [
    { key: "all" as const, label: "All" },
    { key: "image" as const, label: "Images" },
    { key: "video" as const, label: "Videos" },
    { key: "pdf" as const, label: "PDFs" },
  ];

  const filteredImages = registry?.images
    ? Object.entries(registry.images).filter(([id, img]) => {
        if (!showDerived && (img as { parentId?: string }).parentId) {
          return false;
        }
        if (doctypeFilter !== "all") {
          const dt = inferDoctypeFromSrc(img.src);
          if (dt !== doctypeFilter) return false;
        }
        if (activeTagFilters.length > 0) {
          const tagSet = new Set(activeTagFilters.map((t) => t.toLowerCase()));
          const hasMatch = img.tags?.some((t) => tagSet.has(t.toLowerCase()));
          if (!hasMatch) return false;
        }
        const searchLower = search.toLowerCase();
        return (
          id.toLowerCase().includes(searchLower) ||
          img.alt.toLowerCase().includes(searchLower) ||
          img.tags?.some((tag) => tag.toLowerCase().includes(searchLower))
        );
      })
    : [];

  const handleSelectAll = () => {
    const allIds = filteredImages.map(([id]) => id);
    setSelectedImages(new Set(allIds));
  };

  const handleClearSelection = () => {
    setSelectedImages(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedImages.size === 0) return;
    setBulkDeleting(true);
    setBulkDeleteConfirmOpen(false);
    try {
      const res = await apiRequest("POST", "/api/image-registry/bulk-delete", {
        ids: Array.from(selectedImages),
      });
      const data = await res.json();
      setBulkDeleteResults(data.results);
      if (data.deletedCount > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
      }
      setSelectedImages(new Set());
    } catch {
      toast({ title: "Bulk delete failed", description: "Could not complete bulk delete operation", variant: "destructive" });
    } finally {
      setBulkDeleting(false);
    }
  };

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, activeTagFilters, doctypeFilter]);

  const visibleImages = filteredImages.slice(0, visibleCount);
  const hasMore = visibleCount < filteredImages.length;

  const loadMore = () => {
    setVisibleCount(prev => Math.min(prev + PAGE_SIZE, filteredImages.length));
  };

  const handleRunMigrateScript = async () => {
    setScriptMigrateRunning(true);
    setScriptMigrateOutput(null);
    try {
      const res = await apiRequest("POST", "/api/image-registry/migrate", {
        from: scriptMigrateFrom,
        to: scriptMigrateTo,
        dryRun: scriptMigrateDryRun,
      });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        await res.text();
        throw new Error("Server is restarting, please try again in a moment.");
      }
      const data = await res.json();
      setScriptMigrateOutput({ message: data.message, results: data.results ?? [] });
      if (!scriptMigrateDryRun) {
        queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
      }
    } catch (err: any) {
      setScriptMigrateOutput({ message: `Error: ${err.message || "Migration failed"}`, results: [] });
    } finally {
      setScriptMigrateRunning(false);
    }
  };

  const handleRunRemoveUnusedScript = async () => {
    setScriptRemoveUnusedRunning(true);
    setScriptRemoveUnusedOutput(null);
    setScriptRemoveUnusedProgress(null);
    setScriptRemoveUnusedStreamError(null);

    if (scriptRemoveUnusedDryRun) {
      try {
        const res = await apiRequest("POST", "/api/image-registry/scripts/remove-unused", {
          dryRun: true,
        });
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          await res.text();
          throw new Error("Server is restarting, please try again in a moment.");
        }
        const data = await res.json();
        setScriptRemoveUnusedOutput(data);
      } catch (err: any) {
        setScriptRemoveUnusedOutput({ message: `Error: ${err.message || "Failed"}`, removedCount: 0, skippedCount: 0, results: [] });
      } finally {
        setScriptRemoveUnusedRunning(false);
      }
      return;
    }

    try {
      const res = await fetch("/api/image-registry/scripts/remove-unused/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getSessionHeaders() },
        credentials: "include",
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Unknown error" }));
        setScriptRemoveUnusedOutput({ message: `Error: ${errData.error || "Failed"}`, removedCount: 0, skippedCount: 0, results: [] });
        setScriptRemoveUnusedRunning(false);
        return;
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (data.done) {
          setScriptRemoveUnusedOutput({
            message: `Removed ${data.summary.removed} unused image(s), skipped ${data.summary.skipped}, failed ${data.summary.failed}`,
            removedCount: data.summary.removed,
            skippedCount: data.summary.skipped,
            results: [],
          });
        }
        setScriptRemoveUnusedRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setScriptRemoveUnusedOutput({ message: "Error: No response body", removedCount: 0, skippedCount: 0, results: [] });
        setScriptRemoveUnusedRunning(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let allResults: Array<{ id: string; src: string; status: string; reason?: string }> = [];
      let receivedCompletion = false;
      let hadRemovals = false;

      const processLine = (trimmed: string) => {
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed);

          if (event.fatalError) {
            receivedCompletion = true;
            setScriptRemoveUnusedStreamError(`Operation stopped at ${event.processed} / ${event.total} due to an error: ${event.message}`);
            setScriptRemoveUnusedProgress({ processed: event.processed, total: event.total });
            setScriptRemoveUnusedOutput((prev) => ({
              message: `Operation failed after ${event.processed} / ${event.total} — partial results below`,
              removedCount: prev?.removedCount || 0,
              skippedCount: prev?.skippedCount || 0,
              results: allResults,
            }));
            if (hadRemovals) {
              queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
            }
            return;
          }

          if (event.done) {
            receivedCompletion = true;
            setScriptRemoveUnusedProgress(null);
            setScriptRemoveUnusedOutput({
            message: `Removed ${event.summary.removed} unused image(s), skipped ${event.summary.skipped}, failed ${event.summary.failed}, cleanup warnings ${event.summary.cleanupWarnings ?? 0}, ignored external-source ${event.summary.externalSkipped ?? 0} (${event.total} total unused)`,
              removedCount: event.summary.removed,
            skippedCount: event.summary.skipped,
            cleanupErrorCount: event.summary.cleanupWarnings ?? 0,
            externalSkippedCount: event.summary.externalSkipped ?? 0,
              results: allResults,
            });
            if (event.summary.removed > 0) {
              queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
            }
            return;
          }

          if (event.batch) {
            allResults = [...allResults, ...event.batch];
            if (event.batch.some((r: { status: string }) => r.status === "removed" || r.status === "removed-with-cleanup-errors")) {
              hadRemovals = true;
            }
            setScriptRemoveUnusedProgress({ processed: event.processed, total: event.total });
            setScriptRemoveUnusedOutput((prev) => ({
              message: prev?.message || "",
              removedCount: prev?.removedCount || 0,
              skippedCount: prev?.skippedCount || 0,
              results: allResults,
            }));
          }
        } catch (parseErr) {
          console.warn("[RemoveUnused] Failed to parse stream event:", trimmed, parseErr);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          processLine(line.trim());
        }
      }

      const trailing = buffer.trim();
      if (trailing) {
        processLine(trailing);
      }

      if (!receivedCompletion) {
        setScriptRemoveUnusedStreamError("Connection lost — results may be incomplete");
        setScriptRemoveUnusedOutput((prev) => ({
          message: prev?.results?.length ? "Connection lost — partial results below" : "Connection lost before any results were received",
          removedCount: prev?.removedCount || 0,
          skippedCount: prev?.skippedCount || 0,
          results: prev?.results || allResults,
        }));
        if (hadRemovals) {
          queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
        }
      }
    } catch (err: any) {
      setScriptRemoveUnusedOutput({ message: `Error: ${err.message || "Failed"}`, removedCount: 0, skippedCount: 0, results: [] });
    } finally {
      setScriptRemoveUnusedRunning(false);
    }
  };

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          loadMore();
        }
      },
      { rootMargin: "400px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  useEffect(() => {
    return () => {
      if (optimizePollerRef.current) clearInterval(optimizePollerRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 max-w-7xl">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button variant="ghost" size="icon" data-testid="button-back-home">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <Image className="h-5 w-5 text-primary" />
                <h1 className="text-lg font-semibold" data-testid="text-page-title">Media Gallery</h1>
                <span className="text-sm text-muted-foreground hidden sm:inline">
                  ({filteredImages.length}{search ? " found" : ""})
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                {searchOpen ? (
                  <div className="relative w-64 flex items-center gap-1">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        ref={searchInputRef}
                        placeholder="Search..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-10 h-9"
                        data-testid="input-search"
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setSearch("");
                            setSearchOpen(false);
                          }
                        }}
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => { setSearch(""); setSearchOpen(false); }}
                      data-testid="button-close-search"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setSearchOpen(true);
                      setTimeout(() => searchInputRef.current?.focus(), 0);
                    }}
                    data-testid="button-open-search"
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setShowScanAdvanced(false);
                    setScanConfirmOpen(true);
                  }}
                  disabled={scanning}
                  data-testid="button-scan-registry"
                  title="Run media health diagnostic"
                >
                  {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setShowAutoTagAdvanced(false);
                    setAutoTagConfirmOpen(true);
                  }}
                  disabled={autoTagging}
                  data-testid="button-auto-tag"
                  title="Auto-tag untagged images"
                >
                  {autoTagging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setScriptsOpen(true)}
                  data-testid="button-admin-scripts"
                >
                  <Terminal className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOverridesOpen(true)}
                  data-testid="button-open-overrides"
                  className="gap-1.5"
                >
                  Overrides
                  {!overridesLoading && activeOverrides.length > 0 && (
                    <Badge variant="secondary" className="text-xs px-1.5 py-0 no-default-active-elevate" data-testid="badge-overrides-count-toolbar">
                      {activeOverrides.reduce((sum, e) => sum + Object.keys(e.fields).length, 0)}
                    </Badge>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRunQueueActivated(true);
                    setRunQueueOpen(true);
                  }}
                  data-testid="button-open-run-queue"
                  className="gap-1.5"
                >
                  <ListChecks className="h-4 w-4" />
                  Fixers runs
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setSettingsOpen(true)}
                  data-testid="button-media-settings"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-col items-end gap-2 w-full max-w-xl">
                <div className="flex flex-wrap gap-1.5 justify-end items-center">
                  <Button
                    type="button"
                    size="sm"
                    variant={doctypeExpanded || doctypeFilter !== "all" ? "secondary" : "outline"}
                    className="h-8 shrink-0 gap-1.5"
                    onClick={() => {
                      setDoctypeExpanded((v) => !v);
                      if (!doctypeExpanded) setTagsExpanded(false);
                    }}
                    data-testid="button-expand-doctype-filter"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span className="text-xs">Type</span>
                    {doctypeFilter !== "all" && (
                      <Badge
                        variant="default"
                        className="h-5 min-w-5 px-1.5 text-[10px] leading-none"
                        data-testid="badge-active-doctype-count"
                      >
                        1
                      </Badge>
                    )}
                  </Button>
                  {availableTags.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant={tagsExpanded || activeTagFilters.length > 0 ? "secondary" : "outline"}
                      className="h-8 shrink-0 gap-1.5"
                      onClick={() => {
                        setTagsExpanded((v) => !v);
                        if (!tagsExpanded) setDoctypeExpanded(false);
                      }}
                      data-testid="button-expand-tag-filter"
                    >
                      <Tags className="h-3.5 w-3.5" />
                      <span className="text-xs">Tags</span>
                      {activeTagFilters.length > 0 && (
                        <Badge
                          variant="default"
                          className="h-5 min-w-5 px-1.5 text-[10px] leading-none"
                          data-testid="badge-active-tag-count"
                        >
                          {activeTagFilters.length}
                        </Badge>
                      )}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant={showDerived ? "default" : "outline"}
                    aria-pressed={showDerived}
                    className="h-8 shrink-0 gap-1.5"
                    onClick={() => setShowDerived((v) => !v)}
                    data-testid="badge-show-derived"
                  >
                    <span className="text-xs">Derived</span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        className="h-8 shrink-0 gap-1.5"
                        data-testid="button-add-gallery-media"
                      >
                        <Upload className="h-4 w-4" />
                        Add media
                        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        data-testid="menu-add-media-image"
                        onClick={() => {
                          setAddMediaDoctype("image");
                          setAddMediaOpen(true);
                        }}
                      >
                        Image
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid="menu-add-media-video"
                        onClick={() => {
                          setAddMediaDoctype("video");
                          setAddMediaOpen(true);
                        }}
                      >
                        Video
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid="menu-add-media-pdf"
                        onClick={() => {
                          setAddMediaDoctype("pdf");
                          setAddMediaOpen(true);
                        }}
                      >
                        PDF
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {doctypeExpanded && (
                  <div className="flex flex-wrap items-center gap-1.5 justify-end" data-testid="doctype-filter-row">
                    {DOCTYPE_OPTIONS.map(({ key, label }) => (
                      <Badge
                        key={key}
                        variant={doctypeFilter === key ? "default" : "outline"}
                        className="cursor-pointer text-xs"
                        onClick={() => setDoctypeFilter(key)}
                        data-testid={`badge-doctype-${key}`}
                      >
                        {label}
                      </Badge>
                    ))}
                  </div>
                )}

                {tagsExpanded && availableTags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 justify-end" data-testid="tag-filter-row">
                    <Badge
                      variant={activeTagFilters.length === 0 ? "default" : "outline"}
                      className="cursor-pointer text-xs"
                      onClick={() => setActiveTagFilters([])}
                      data-testid="badge-tag-all"
                    >
                      All
                    </Badge>
                    {availableTags.map(({ key, label }) => {
                      const selected = activeTagFilters.includes(key);
                      return (
                        <Badge
                          key={key}
                          variant={selected ? "default" : "outline"}
                          className="cursor-pointer text-xs"
                          onClick={() => toggleTagFilter(key)}
                          data-testid={`badge-tag-${key}`}
                        >
                          {label}
                        </Badge>
                      );
                    })}
                  </div>
                )}

                {(doctypeFilter !== "all" || activeTagFilters.length > 0) && !doctypeExpanded && !tagsExpanded && (
                  <div className="flex flex-wrap items-center gap-2 justify-end">
                    <p className="text-xs text-muted-foreground" data-testid="text-gallery-filter-summary">
                      Filtered by{" "}
                      {[
                        doctypeFilter !== "all"
                          ? `type “${DOCTYPE_OPTIONS.find((o) => o.key === doctypeFilter)?.label ?? doctypeFilter}”`
                          : null,
                        activeTagFilters.length === 1
                          ? `tag “${availableTags.find((t) => t.key === activeTagFilters[0])?.label || activeTagFilters[0]}”`
                          : activeTagFilters.length > 1
                            ? `tags ${activeTagFilters
                                .map((k) => `“${availableTags.find((t) => t.key === k)?.label || k}”`)
                                .join(", ")}`
                            : null,
                      ]
                        .filter(Boolean)
                        .join(" and ")}
                      .
                    </p>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => {
                        setDoctypeFilter("all");
                        setActiveTagFilters([]);
                      }}
                      data-testid="button-clear-gallery-filters"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <p className="text-xs text-muted-foreground mb-4" data-testid="text-gallery-doctype-hint">
          Holds images, videos, and PDFs. Use Type and Tags to filter; tags work the same for all media.
          Crop and optimize apply to images only.
        </p>

        {scanResult && (
          <div className="mb-6 rounded-lg border p-4 space-y-3" data-testid="scan-results">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Scan Results</h3>
              <div className="flex items-center gap-2">
                {scanResult.summary.duplicates > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDeduplicate}
                    disabled={deduplicating}
                    data-testid="button-remove-duplicates"
                  >
                    {deduplicating ? "Removing..." : `Remove ${scanResult.duplicates.reduce((sum, g) => sum + g.ids.length - 1, 0)} duplicate(s)`}
                  </Button>
                )}
                {scanResult.summary.updated > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleApply("update")}
                    disabled={applying}
                    data-testid="button-apply-updates"
                  >
                    {applying ? "Applying..." : `Update ${scanResult.summary.updated} extension(s)`}
                  </Button>
                )}
                {scanResult.summary.new > 0 && (
                  <Button
                    size="sm"
                    onClick={() => handleApply("add")}
                    disabled={applying}
                    data-testid="button-apply-new"
                  >
                    {applying ? "Applying..." : `Add ${scanResult.summary.new} new image(s)`}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setScanResult(null)}
                  data-testid="button-dismiss-scan"
                >
                  Dismiss
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-muted-foreground">
                Registered: <strong className="text-foreground">{scanResult.registeredCount}</strong>
              </span>
              <span className="text-muted-foreground">
                Scanned files: <strong className="text-foreground">{scanResult.scannedImagesCount}</strong>
              </span>
            </div>

            {scanResult.brokenReferences.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  {scanResult.brokenReferences.length} broken reference(s)
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                  A YAML content file points to an image path that no longer exists on disk.
                </p>
                <div className="max-h-32 overflow-y-auto space-y-1 pl-6">
                  {scanResult.brokenReferences.map((ref, i) => (
                    <div key={i} className="text-xs text-muted-foreground">
                      <code className="text-foreground">{ref.yamlFile}</code>
                      <span className="mx-1">&rarr;</span>
                      <code className="text-destructive">{ref.missingSrc}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {scanResult.updatedImages.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  {scanResult.updatedImages.length} image(s) with changed extensions
                </div>
                <div className="max-h-24 overflow-y-auto space-y-1 pl-6">
                  {scanResult.updatedImages.map((img, i) => (
                    <div key={i} className="text-xs text-muted-foreground">
                      <code className="text-foreground">{img.id}</code>: {img.oldSrc.split('/').pop()} &rarr; {img.newSrc.split('/').pop()}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {scanResult.newImages.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  {scanResult.newImages.length} unregistered image(s)
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1 pl-6">
                  {scanResult.newImages.map((img, i) => (
                    <div key={i} className="text-xs text-muted-foreground">
                      <code className="text-foreground">{img.filename}</code>
                      <span className="mx-1">&rarr;</span>
                      id: <code>{img.id}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {scanResult.duplicates.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  {scanResult.duplicates.length} duplicate group(s) ({scanResult.duplicates.reduce((sum, g) => sum + g.ids.length - 1, 0)} extra image(s))
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1 pl-6">
                  {scanResult.duplicates.map((group, i) => (
                    <div key={i} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{group.ids.length} copies:</span>{" "}
                      {group.ids.map((id, j) => (
                        <span key={id}>
                          {j > 0 && ", "}
                          <code className={id === group.canonical ? "text-foreground font-semibold" : ""}>{id}</code>
                          {id === group.canonical && <span className="text-xs text-muted-foreground ml-0.5">(keep)</span>}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {scanResult.hashesComputed > 0 && (
              <div className="text-xs text-muted-foreground">
                Computed {scanResult.hashesComputed} new hash(es) during this scan
              </div>
            )}

            {scanResult.summary.new === 0 && scanResult.summary.updated === 0 && scanResult.summary.broken === 0 && scanResult.summary.duplicates === 0 && (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <Check className="h-4 w-4" />
                All image references are valid
              </div>
            )}
          </div>
        )}

        {(optimizing || optimizeDone) && optimizeProgress && !validationResult && (
          <div className="mb-6 rounded-lg border p-4" data-testid="panel-optimization-progress-standalone">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium">image-optimization</span>
            </div>
            <OptimizationProgressPanel
              optimizeDone={optimizeDone}
              optimizeProgress={optimizeProgress}
              optimizeFailedOpen={optimizeFailedOpen}
              setOptimizeFailedOpen={setOptimizeFailedOpen}
              onDismiss={handleDismissOptimization}
            />
          </div>
        )}

        {validationResult && validationResult.validators.length > 0 && (
          <div className="mb-6 rounded-lg border p-4 space-y-4" data-testid="validation-results">
            <div className="flex items-center justify-between">
              <h3
                className={cn(
                  "font-semibold text-sm",
                  validationResult.summary.failed > 0
                    ? "text-destructive"
                    : validationResult.summary.warnings > 0
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-green-600 dark:text-green-400",
                )}
              >
                Image Health Checks
              </h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{validationResult.summary.total} check(s) in {validationResult.summary.duration}ms</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setValidationResult(null);
                    setFixResultByFixer({});
                    setHealthIssueFixFilter({});
                    setHealthIssueSearchOpen({});
                    setHealthIssueSearchText({});
                  }}
                  data-testid="button-dismiss-validation"
                >
                  Dismiss
                </Button>
              </div>
            </div>

            {validationResult.validators.map((v) => {
              const issueCount = v.errors.length + v.warnings.length;
              const apiFixes = collectApiFixesFromValidator(v);
              const allIssues = [...v.errors, ...v.warnings];
              const fixKinds = summarizeIssueFixKinds(v);
              const otherCount = fixKinds.script + fixKinds.llm;
              const fixFilter = healthIssueFixFilter[v.name] ?? "all";
              const issueSearchOpen = healthIssueSearchOpen[v.name] ?? false;
              const issueSearchText = healthIssueSearchText[v.name] ?? "";
              const filteredIssues = allIssues
                .filter((issue) => issueMatchesHealthFixFilter(issue, fixFilter))
                .filter((issue) => issueMatchesHealthSearch(issue, issueSearchText));
              const statusColor =
                v.status === "passed"
                  ? "text-green-600 dark:text-green-400"
                  : v.status === "warning"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-destructive";

              return (
                <div key={v.name} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${statusColor}`}>
                        {v.status === "passed" ? <Check className="inline h-3.5 w-3.5 mr-1" /> : <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />}
                        {v.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{v.description}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{v.duration}ms</span>
                    </div>
                  </div>

                  {v.name === "image-optimization" && (optimizing || optimizeDone) && optimizeProgress && (
                    <div className="mt-2 pl-5">
                      <OptimizationProgressPanel
                        optimizeDone={optimizeDone}
                        optimizeProgress={optimizeProgress}
                        optimizeFailedOpen={optimizeFailedOpen}
                        setOptimizeFailedOpen={setOptimizeFailedOpen}
                        onDismiss={handleDismissOptimization}
                      />
                    </div>
                  )}

                  {v.artifacts && Object.keys(v.artifacts).length > 0 && (() => {
                    const { stats, alertErrors, alertWarnings } = partitionArtifacts(v.name, v.artifacts);
                    return (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 pl-5 text-xs">
                        {stats.map(([key, value]) => (
                          <span key={key} className="text-muted-foreground">
                            {formatArtifactLabel(key)}:{" "}
                            <strong className="text-foreground tabular-nums">{String(value)}</strong>
                          </span>
                        ))}
                        {alertErrors.map(([key, value]) => {
                          const isZero = isZeroArtifactValue(value);
                          return (
                          <span key={key}>
                            <span className={isZero ? "text-green-600 dark:text-green-400" : "text-destructive"}>
                              {formatArtifactLabel(key)}:
                            </span>{" "}
                            <strong className={isZero ? "text-green-700 dark:text-green-300 tabular-nums" : "text-destructive tabular-nums"}>
                              {String(value)}
                            </strong>
                          </span>
                          );
                        })}
                        {alertWarnings.map(([key, value]) => {
                          const isZero = isZeroArtifactValue(value);
                          return (
                          <span key={key}>
                            <span className={isZero ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}>
                              {formatArtifactLabel(key)}:
                            </span>{" "}
                            <strong className={isZero ? "text-green-700 dark:text-green-300 tabular-nums" : "text-amber-700 dark:text-amber-300 tabular-nums"}>
                              {String(value)}
                            </strong>
                          </span>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {issueCount > 0 && (
                    <div className="pl-5 space-y-2">
                      <ScrollArea className="max-h-96 rounded-md border">
                        <div className="sticky top-0 z-10 space-y-2 border-b bg-background/95 px-2 pb-2 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/85">
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            <span className="font-medium text-foreground">Suggested fixes in issues:</span>{" "}
                            {(() => {
                              const parts: string[] = [];
                              if (fixKinds.api > 0) parts.push(`${fixKinds.api} can run an API fix`);
                              if (fixKinds.manual > 0) parts.push(`${fixKinds.manual} need a manual fix (link or editor)`);
                              if (fixKinds.none > 0) parts.push(`${fixKinds.none} have no suggested fix`);
                              if (fixKinds.script > 0) parts.push(`${fixKinds.script} script`);
                              if (fixKinds.llm > 0) parts.push(`${fixKinds.llm} LLM prompt`);
                              return parts.length > 0 ? parts.join(" · ") : "—";
                            })()}
                          </p>

                          <div className="flex flex-wrap items-center gap-2">
                            <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className={cn(
                                  "no-default-hover-elevate no-default-active-elevate h-7 shrink-0 border px-2 text-xs font-medium shadow-none ring-offset-background",
                                  fixFilter === "all"
                                    ? "border-stone-500 bg-stone-300 text-stone-950 ring-1 ring-stone-400/40 ring-offset-1 dark:border-stone-400 dark:bg-stone-600 dark:text-stone-50 dark:ring-stone-500/30"
                                    : "border-stone-400 bg-stone-200 text-stone-900 hover:bg-stone-300 dark:border-stone-500 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700",
                                )}
                                onClick={() =>
                                  setHealthIssueFixFilter((prev) => ({ ...prev, [v.name]: "all" }))
                                }
                                data-testid={`button-health-filter-all-${v.name}`}
                              >
                                All issues ({issueCount})
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className={cn(
                                  "no-default-hover-elevate no-default-active-elevate h-7 shrink-0 border px-2 text-xs font-medium shadow-none ring-offset-background",
                                  fixFilter === "api"
                                    ? "border-primary/45 bg-primary/5 text-foreground ring-1 ring-primary/20 ring-offset-1"
                                    : "border-primary/25 bg-primary/5 text-foreground hover:bg-primary/10",
                                )}
                                onClick={() =>
                                  setHealthIssueFixFilter((prev) => ({ ...prev, [v.name]: "api" }))
                                }
                                data-testid={`button-health-filter-api-${v.name}`}
                              >
                                API fix ({fixKinds.api})
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className={cn(
                                  "no-default-hover-elevate no-default-active-elevate h-7 shrink-0 border px-2 text-xs font-medium shadow-none ring-offset-background",
                                  fixFilter === "manual"
                                    ? "border-secondary-border bg-secondary text-secondary-foreground ring-1 ring-secondary/25 ring-offset-1"
                                    : "border-border bg-secondary/80 text-secondary-foreground hover:bg-secondary",
                                )}
                                onClick={() =>
                                  setHealthIssueFixFilter((prev) => ({ ...prev, [v.name]: "manual" }))
                                }
                                data-testid={`button-health-filter-manual-${v.name}`}
                              >
                                Manual fix ({fixKinds.manual})
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className={cn(
                                  "no-default-hover-elevate no-default-active-elevate h-7 shrink-0 border px-2 text-xs font-medium shadow-none ring-offset-background",
                                  fixFilter === "none"
                                    ? "border-destructive/35 bg-5 text-destructive ring-1 ring-destructive/12 ring-offset-1"
                                    : "border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10",
                                )}
                                onClick={() =>
                                  setHealthIssueFixFilter((prev) => ({ ...prev, [v.name]: "none" }))
                                }
                                data-testid={`button-health-filter-none-${v.name}`}
                              >
                                No fix ({fixKinds.none})
                              </Button>
                              {otherCount > 0 && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className={cn(
                                    "no-default-hover-elevate no-default-active-elevate h-7 shrink-0 border px-2 text-xs font-medium shadow-none ring-offset-background",
                                    fixFilter === "other"
                                      ? "border-teal-600 bg-teal-300 text-teal-950 ring-1 ring-teal-500/35 ring-offset-1 dark:border-teal-400 dark:bg-teal-700 dark:text-teal-50 dark:ring-teal-400/25"
                                      : "border-teal-500 bg-teal-200 text-teal-950 hover:bg-teal-300 dark:border-teal-600 dark:bg-teal-950 dark:text-teal-100 dark:hover:bg-teal-900",
                                  )}
                                  onClick={() =>
                                    setHealthIssueFixFilter((prev) => ({ ...prev, [v.name]: "other" }))
                                  }
                                  data-testid={`button-health-filter-other-${v.name}`}
                                >
                                  Script / LLM ({otherCount})
                                </Button>
                              )}
                            </div>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 shrink-0"
                              onClick={() =>
                                setHealthIssueSearchOpen((prev) => ({
                                  ...prev,
                                  [v.name]: !issueSearchOpen,
                                }))
                              }
                              aria-label="Search issues"
                              data-testid={`button-health-issue-search-${v.name}`}
                            >
                              <Search className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          {issueSearchOpen && (
                            <div className="relative max-w-full pr-0.5">
                              <Search className="absolute left-2 top-1/2 z-[1] h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                              <Input
                                autoFocus
                                value={issueSearchText}
                                onChange={(e) =>
                                  setHealthIssueSearchText((prev) => ({
                                    ...prev,
                                    [v.name]: e.target.value,
                                  }))
                                }
                                placeholder="Search issues by code, message, file…"
                                className="h-8 pl-8 pr-8 text-xs"
                                data-testid={`input-health-issue-search-${v.name}`}
                              />
                              {issueSearchText.length > 0 && (
                                <button
                                  type="button"
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                  onClick={() =>
                                    setHealthIssueSearchText((prev) => ({ ...prev, [v.name]: "" }))
                                  }
                                  aria-label="Clear search"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="space-y-1.5 p-2 pb-3">
                          {filteredIssues.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2">
                              No issues match the current filter or search.
                            </p>
                          ) : (
                            filteredIssues.map((issue, i) => {
                              const fixType = issue.fix?.type;
                              const fixBadge =
                                fixType === "api"
                                  ? "API fix"
                                  : fixType === "manual"
                                    ? "Manual fix"
                                    : fixType === "script"
                                      ? "Script"
                                      : fixType === "llm"
                                        ? "LLM"
                                        : "No fix";
                              return (
                                <div
                                  key={`${v.name}-${issue.code}-${i}-${issue.message?.slice(0, 24)}`}
                                  className="flex flex-wrap items-center gap-1.5 text-xs"
                                >
                                  <Badge variant="outline" className={healthIssueLogBadgeClassName(issue)}>
                                    {fixBadge}
                                  </Badge>
                                  <span className={issue.type === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}>
                                    [{issue.code}]
                                  </span>
                                  <span className="text-muted-foreground">{issue.message}</span>
                                  {issue.fix?.type === "manual" && issue.fix.url && (
                                    <a
                                      href={issue.fix.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-0.5 text-primary hover:underline"
                                      data-testid={`link-goto-section-gallery-${v.name}-${i}`}
                                    >
                                      <LinkIcon className="h-3 w-3" />
                                      {issue.fix.label || "Go to section"}
                                    </a>
                                  )}
                                  {issue.fix?.type === "manual" && !issue.fix.url && issue.fix.label && (
                                    <span className="text-muted-foreground italic">({issue.fix.label})</span>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </ScrollArea>

                      {apiFixes.length > 0 && (
                        <div className="space-y-2">
                          {apiFixes.map((fx) => {
                            const fixerMeta = fixerList.find((fixer) => fixer.name === fx.name);
                            const isFixerRunning = runningFixers[fx.name];
                            const fixResult = fixResultByFixer[fx.name];
                            return (
                              <div key={fx.name} className="space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleRunApiFixer(fx.name)}
                                    disabled={isFixerRunning}
                                    data-testid={`button-fix-${v.name}-${fx.name}`}
                                  >
                                    {isFixerRunning ? (
                                      <>
                                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                        Running...
                                      </>
                                    ) : (
                                      <>
                                        <Wrench className="h-3.5 w-3.5 mr-1.5" />
                                        {fx.label}
                                        <Badge variant="secondary" className="ml-1.5">{fx.count}</Badge>
                                      </>
                                    )}
                                  </Button>
                                  {fixResult && (
                                    <span className={fixResult.ok ? "text-xs text-green-600 dark:text-green-400" : "text-xs text-destructive"}>
                                      {fixResult.message}
                                    </span>
                                  )}
                                </div>
                                {fixerMeta && (
                                  <p className="text-xs text-muted-foreground">{fixerMeta.description}</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {issueCount === 0 && (
                    <div className="text-xs text-green-600 dark:text-green-400 pl-5">
                      No issues found
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}


        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
              <p className="mt-4 text-muted-foreground">Loading images...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive p-6">
            <p className="text-destructive" data-testid="text-error">
              Failed to load image registry
            </p>
          </div>
        )}

        {registry && (
          <>
            <div 
              className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4"
              style={{ columnFill: 'balance' }}
            >
              {visibleImages.map(([id, img]) => {
                const isSelected = selectedImages.has(id);
                const mediaDoctype = inferDoctypeFromSrc(img.src);
                const filename = img.src.split("/").pop()?.split("?")[0] || id;
                return (
                <div 
                  key={id} 
                  className="break-inside-avoid mb-4 group"
                  data-testid={`card-image-${id}`}
                >
                  <div className={`rounded-lg overflow-hidden bg-muted border hover-elevate transition-shadow ${isSelected ? 'ring-2 ring-primary border-primary' : ''}`}>
                    <div
                      className="relative cursor-pointer"
                      onClick={() => toggleImageSelection(id)}
                      data-testid={`select-image-${id}`}
                    >
                      {failedImages.has(id) ? (
                        <div className="aspect-video flex items-center justify-center bg-muted">
                          <div className="text-center p-4">
                            <Image className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                            <p className="text-xs text-muted-foreground">Not found</p>
                          </div>
                        </div>
                      ) : mediaDoctype === "pdf" ? (
                        <div className="aspect-video flex items-center justify-center bg-muted p-4" data-testid={`preview-pdf-${id}`}>
                          <div className="text-center">
                            <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                            <p className="text-xs text-muted-foreground truncate max-w-[12rem]">{filename}</p>
                            <Badge variant="secondary" className="text-[10px] mt-1">PDF</Badge>
                          </div>
                        </div>
                      ) : mediaDoctype === "video" ? (
                        <div className="aspect-video flex items-center justify-center bg-muted p-4" data-testid={`preview-video-${id}`}>
                          <div className="text-center">
                            <Film className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                            <p className="text-xs text-muted-foreground truncate max-w-[12rem]">{filename}</p>
                            <Badge variant="secondary" className="text-[10px] mt-1">Video</Badge>
                          </div>
                        </div>
                      ) : (
                        <img
                          src={replacedAt[id] ? `${img.src}${img.src.includes("?") ? "&" : "?"}v=${replacedAt[id]}` : img.src}
                          alt={img.alt}
                          className="w-full h-auto"
                          loading="lazy"
                          onError={() => handleImageError(id)}
                        />
                      )}
                      <div className={`absolute top-2 left-2 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        {isSelected ? (
                          <SquareCheck className="h-5 w-5 text-primary drop-shadow-md" />
                        ) : (
                          <Square className="h-5 w-5 text-white drop-shadow-md" />
                        )}
                      </div>
                    </div>
                    <div className="p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <code className="text-xs font-mono truncate text-foreground" data-testid={`text-image-id-${id}`}>
                          {id}
                        </code>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              data-testid={`button-menu-${id}`}
                            >
                              {copiedId === id ? (
                                <Check className="h-3 w-3 text-green-600" />
                              ) : (
                                <MoreHorizontal className="h-3 w-3" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => setDetailImageId(id)}
                              data-testid={`button-details-${id}`}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              Details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleCopyId(id)}
                              data-testid={`button-copy-${id}`}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Copy ID
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                const url = img.src.startsWith("http") ? img.src : `${window.location.origin}${img.src}`;
                                navigator.clipboard.writeText(url);
                                setCopiedId(id);
                                setTimeout(() => setCopiedId(null), 2000);
                              }}
                              data-testid={`button-copy-url-${id}`}
                            >
                              <LinkIcon className="h-4 w-4 mr-2" />
                              Copy URL
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => openReplacePicker(id)}
                              data-testid={`button-replace-${id}`}
                            >
                              <Replace className="h-4 w-4 mr-2" />
                              Replace
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteConfirmId(id)}
                              data-testid={`button-delete-${id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 no-default-active-elevate" data-testid={`badge-storage-${id}`}>
                          {img.src.startsWith("http") ? (
                            <><Cloud className="h-3 w-3 mr-1" />Google Bucket</>
                          ) : (
                            <><Folder className="h-3 w-3 mr-1" />Local</>
                          )}
                        </Badge>
                        {img.srcset && img.srcset.length > 0 ? (
                          <Badge variant="secondary" className="text-xs px-1.5 py-0 no-default-active-elevate" data-testid={`badge-srcset-count-${id}`}>
                            {img.srcset.length} srcset{img.srcset.length !== 1 ? "s" : ""}
                          </Badge>
                        ) : (
                          <Badge className="text-xs px-1.5 py-0 no-default-active-elevate bg-destructive text-destructive-foreground" data-testid={`badge-srcset-count-${id}`}>
                            No srcsets
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2" data-testid={`text-image-alt-${id}`}>
                        {img.alt}
                      </p>
                      {img.tags && img.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {img.tags.map((tag) => (
                            <Badge 
                              key={tag} 
                              variant={activeTagFilters.includes(tag) ? "default" : "secondary"}
                              className="text-xs px-1.5 py-0 cursor-pointer"
                              onClick={() => toggleTagFilter(tag)}
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>

            {hasMore && (
              <div ref={sentinelRef} className="flex justify-center py-8" data-testid="scroll-sentinel">
                <p className="text-sm text-muted-foreground">
                  Showing {visibleCount} of {filteredImages.length} images
                </p>
              </div>
            )}

            {!hasMore && filteredImages.length > PAGE_SIZE && (
              <div className="flex justify-center py-6">
                <p className="text-sm text-muted-foreground">
                  All {filteredImages.length} images loaded
                </p>
              </div>
            )}

            {filteredImages.length === 0 && !isLoading && (
              <div className="text-center py-16">
                <Image className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground" data-testid="text-no-results">
                  {search ? "No images match your search" : "No images in registry"}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {selectedImages.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-lg" data-testid="bulk-action-toolbar">
          <div className="container mx-auto px-4 pl-20 max-w-7xl">
            <div className="flex items-center justify-between py-3 gap-4">
              <div className="flex items-center gap-3">
                <CheckCheck className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium" data-testid="text-selected-count">
                  {selectedImages.size} image{selectedImages.size !== 1 ? 's' : ''} selected
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectAll}
                  data-testid="button-select-all"
                >
                  Select all ({filteredImages.length})
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setBulkDeleteConfirmOpen(true)}
                  disabled={bulkDeleting}
                  data-testid="button-bulk-delete"
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  {bulkDeleting ? "Deleting..." : `Delete Selected`}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearSelection}
                  data-testid="button-clear-selection"
                >
                  <X className="h-4 w-4 mr-1.5" />
                  Clear
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Dialog open={settingsOpen} onOpenChange={(open) => { setSettingsOpen(open); if (!open) setSettingsProviderView(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Media Storage Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                {mediaStatus?.defaultProvider === "gcs" ? (
                  <Cloud className="h-5 w-5 text-primary" />
                ) : (
                  <Folder className="h-5 w-5 text-primary" />
                )}
                <div>
                  <p className="text-sm font-medium" data-testid="text-default-provider">
                    Default Provider: <span className="font-semibold">{mediaStatus?.defaultProvider === "gcs" ? "Google Cloud Storage" : "Local"}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    New uploads will use this provider
                  </p>
                </div>
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">Storage Providers</p>
                <div className="flex flex-wrap gap-2">
                  {(mediaStatus?.providers.includes("gcs")
                    ? mediaStatus.providers
                    : [...(mediaStatus?.providers ?? []), "gcs"]
                  ).map((p) => {
                    const isActive = mediaStatus?.providers.includes(p);
                    return (
                      <button
                        key={p}
                        onClick={() => setSettingsProviderView(settingsProviderView === p ? null : p)}
                        data-testid={`badge-provider-${p}`}
                      >
                        <Badge variant={settingsProviderView === p ? "default" : "outline"} className={`cursor-pointer gap-1.5 ${!isActive ? "opacity-60" : ""}`}>
                          {isActive && <span className="inline-block h-2 w-2 rounded-full bg-green-500 flex-shrink-0" />}
                          {p === "gcs" ? "Cloud Storage" : p === "local" ? "Local Filesystem" : p}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </div>

              {settingsProviderView === "local" && (
                <div className="rounded-md border p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Folder className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium">Local Filesystem</p>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-2">
                    <p>Images stored locally are served from the <code className="bg-muted px-1 rounded text-foreground">4geeks-com/images/</code> folder.</p>
                    <div className="space-y-1.5">
                      <p className="font-medium text-foreground text-xs">How to add media:</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Place files (images, videos, or PDFs) into <code className="bg-muted px-1 rounded text-foreground">4geeks-com/images/</code></li>
                        <li>Click the scan button in the gallery toolbar to detect new files</li>
                        <li>Review the scan results and click Apply to register them</li>
                      </ol>
                    </div>
                    <div className="space-y-1.5">
                      <p className="font-medium text-foreground text-xs">How they appear in the gallery:</p>
                      <p>Each registered file gets a unique ID derived from its filename. The ID, alt text, tags, and (for images) focal point are stored in <code className="bg-muted px-1 rounded text-foreground">image-registry.json</code>. Filter by type or tag; crop/optimize apply to images only. Advanced: <code className="bg-muted px-1 rounded text-foreground">shared/media-doctype.ts</code>, <code className="bg-muted px-1 rounded text-foreground">server/media-gallery.ts</code>.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-2 rounded bg-muted/50 border border-dashed">
                    <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      Always delete images through the gallery (not manually from the filesystem). Manual deletion can leave broken references in YAML content files and the image registry.
                    </p>
                  </div>
                  {cloudProvider && localImageCount > 0 && (
                    <div className="border-t pt-3 space-y-2">
                      <p className="text-xs font-medium text-foreground">Migrate to {cloudProviderLabel}</p>
                      <p className="text-xs text-muted-foreground">
                        Upload all <span className="font-semibold text-foreground">{localImageCount}</span> local image{localImageCount !== 1 ? "s" : ""} to <span className="font-semibold text-foreground">{cloudProviderLabel}</span>. All YAML content references will be updated automatically.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setMigrateConfirmOpen(true)}
                        disabled={migrating}
                        data-testid="button-migrate-to-cloud"
                      >
                        <Cloud className="h-4 w-4 mr-2" />
                        {migrating ? "Migrating..." : `Migrate ${localImageCount} image${localImageCount !== 1 ? "s" : ""} to ${cloudProviderLabel}`}
                      </Button>
                    </div>
                  )}
                  {cloudProvider && localImageCount === 0 && (
                    <div className="border-t pt-3 flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-xs text-muted-foreground">All images are already stored in {cloudProviderLabel}.</p>
                      {redundantCount > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setRedundantOpen(true); setRedundantResult(null); }}
                          data-testid="button-redundant-images"
                        >
                          <AlertTriangle className="h-3.5 w-3.5 mr-1.5 text-amber-500" />
                          {redundantCount} Redundant {redundantCount === 1 ? "image" : "images"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {settingsProviderView === "gcs" && !mediaStatus?.gcs && (
                <div className="rounded-md border border-dashed p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Cloud className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium">Google Cloud Storage</p>
                    <Badge variant="outline" className="text-xs">Not configured</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Cloud storage is not active. Set the environment variables below to enable it.
                  </p>
                </div>
              )}

              {settingsProviderView === "gcs" && mediaStatus?.gcs && (
                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Cloud className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium">Google Cloud Storage</p>
                    <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">Active</Badge>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Bucket</span>
                      <code className="text-xs bg-muted px-2 py-0.5 rounded" data-testid="text-gcs-bucket">{mediaStatus.gcs.bucket}</code>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Base Path</span>
                      <code className="text-xs bg-muted px-2 py-0.5 rounded" data-testid="text-gcs-base-path">{mediaStatus.gcs.basePath}/</code>
                    </div>
                    {mediaStatus.gcs.projectId && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Project ID</span>
                        <code className="text-xs bg-muted px-2 py-0.5 rounded" data-testid="text-gcs-project">{mediaStatus.gcs.projectId}</code>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {settingsProviderView === "gcs" && (
                <div className="rounded-md border p-3 space-y-2">
                  <p className="text-sm font-medium">{mediaStatus?.gcs ? "Configuration Reference" : "Setup Guide"}</p>
                  <div className="text-xs text-muted-foreground space-y-1.5">
                    <p>{mediaStatus?.gcs ? "Cloud storage is configured with these environment variables:" : "Configure these environment variables to enable cloud storage:"}</p>
                    <div className="space-y-1 font-mono bg-muted p-2 rounded">
                      <p><span className="text-foreground">GCS_BUCKET_NAME</span> - Bucket name</p>
                      <p><span className="text-foreground">GCS_PROJECT_ID</span> - GCP project ID</p>
                      <p><span className="text-foreground">GCS_CREDENTIALS_JSON</span> - Service account key JSON</p>
                      <p><span className="text-foreground">GCS_BASE_PATH</span> - Folder prefix (default: media)</p>
                      <p><span className="text-foreground">MEDIA_DEFAULT_PROVIDER</span> - Set to "gcs" for cloud default</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setSettingsOpen(false); setSettingsProviderView(null); }} data-testid="button-close-settings">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteResults !== null} onOpenChange={(open) => { if (!open) setBulkDeleteResults(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Delete Results</DialogTitle>
          </DialogHeader>
          {bulkDeleteResults && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-green-600 dark:text-green-400">
                  {bulkDeleteResults.filter(r => r.success).length} deleted
                </span>
                {bulkDeleteResults.some(r => !r.success) && (
                  <span className="text-destructive">
                    {bulkDeleteResults.filter(r => !r.success).length} failed
                  </span>
                )}
              </div>
              <ScrollArea className="max-h-[400px]">
                <div className="border rounded-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium">Image ID</th>
                        <th className="text-left px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkDeleteResults.map((result) => (
                        <tr
                          key={result.id}
                          className={result.success
                            ? "bg-green-50 dark:bg-green-950/30"
                            : "bg-red-50 dark:bg-red-950/30"
                          }
                        >
                          <td className="px-3 py-2 font-mono text-xs truncate max-w-[200px]" data-testid={`text-result-id-${result.id}`}>
                            {result.id}
                          </td>
                          <td className={`px-3 py-2 text-xs ${result.success ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`} data-testid={`text-result-status-${result.id}`}>
                            {result.message}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ScrollArea>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setBulkDeleteResults(null)} data-testid="button-close-results">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={scanConfirmOpen}
        onOpenChange={(open) => {
          setScanConfirmOpen(open);
          if (!open) setShowScanAdvanced(false);
        }}
      >
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] flex flex-col overflow-hidden" data-testid="dialog-scan-confirm">
          <DialogHeader>
            <DialogTitle>Run media health diagnostic?</DialogTitle>
            <DialogDescription>
              This checks the image registry and content files for problems — new files, broken
              references, duplicates, missing tags, and optimization gaps — then shows results for
              you to review.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 text-sm text-muted-foreground pr-1">
            <p>
              Think of this as a checkup, not a fixer. It reports what it finds so you can decide
              what to apply next. Adding new images, updating paths, or removing duplicates only
              happens when you click those actions in the results panel.
            </p>
            <div>
              <p className="font-medium text-foreground mb-1">Why this is useful</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Finds unregistered files sitting in the images folder</li>
                <li>Surfaces broken image URLs in YAML and the registry</li>
                <li>Detects duplicate files (same content, different IDs)</li>
                <li>Runs image health validators (tags, hero tags, optimization)</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">What will happen</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Scans local image files and image references in content YAML</li>
                <li>Runs validators: <code className="text-[11px]">images</code>, <code className="text-[11px]">image-tags</code>, <code className="text-[11px]">hero-image-tags</code>, <code className="text-[11px]">image-optimization</code></li>
                <li>Shows a results panel with counts and suggested next actions</li>
                <li>Does <span className="font-medium text-foreground">not</span> auto-register images, rewrite YAML, or delete duplicates</li>
                <li>May fill in missing content hashes on registry entries (small write)</li>
              </ul>
            </div>

            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
              onClick={() => setShowScanAdvanced((v) => !v)}
              data-testid="button-toggle-scan-advanced"
            >
              {showScanAdvanced ? "Hide advanced details" : "Read more (advanced)"}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showScanAdvanced ? "rotate-180" : ""}`}
              />
            </button>

            {showScanAdvanced && (
              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3 text-xs">
                <div>
                  <p className="font-medium text-foreground mb-1">How it works under the hood</p>
                  <p>
                    Calls <code className="text-[11px]">mediaGallery.scan()</code> to compare disk
                    files against the registry and YAML refs, then runs the image health validators
                    via the validation runner. Apply / dedupe / fix actions are separate endpoints
                    you trigger from the UI after reviewing results.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-1">API &amp; side effects</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      Endpoints: <code className="text-[11px]">POST /api/image-registry/scan</code> and{" "}
                      <code className="text-[11px]">POST /api/validation/run</code>
                    </li>
                    <li>
                      Registry write only when local images are missing a{" "}
                      <code className="text-[11px]">hash</code> — those hashes are computed and saved
                    </li>
                    <li>YAML content files are not modified by the scan itself</li>
                    <li>
                      Paths: <code className="text-[11px]">server/media-gallery.ts</code> (
                      <code className="text-[11px]">scan()</code>),{" "}
                      <code className="text-[11px]">server/routes/media.ts</code>
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="border-t pt-4 gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setScanConfirmOpen(false)}
              disabled={scanning}
              data-testid="button-cancel-scan"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleScan()}
              disabled={scanning}
              data-testid="button-confirm-scan"
            >
              {scanning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Running…
                </>
              ) : (
                <>
                  <Stethoscope className="h-4 w-4 mr-2" />
                  Run diagnostic
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={autoTagConfirmOpen}
        onOpenChange={(open) => {
          setAutoTagConfirmOpen(open);
          if (!open) setShowAutoTagAdvanced(false);
        }}
      >
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] flex flex-col overflow-hidden" data-testid="dialog-auto-tag-confirm">
          <DialogHeader>
            <DialogTitle>Auto-tag untagged images?</DialogTitle>
            <DialogDescription>
              {untaggedImageCount === 0
                ? "Every image in the gallery already has tags — running this now will find nothing to do."
                : `This will automatically label ${untaggedImageCount} image${untaggedImageCount === 1 ? "" : "s"} that don't have tags yet.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 text-sm text-muted-foreground pr-1">
            <p>
              Tags help the gallery stay organized and make it easier to find the right image for a
              component — for example hero backgrounds vs logos vs avatars. Images that already have
              tags are left alone.
            </p>
            <div>
              <p className="font-medium text-foreground mb-1">Why this is useful</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Fills in missing tags so new uploads don't stay unlabeled</li>
                <li>Improves search and filtering in the media gallery</li>
                <li>Helps validation catch images used in the wrong context</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">What will happen</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Only images with no tags are processed</li>
                <li>Suggested tags are saved to the image registry</li>
                <li>Progress shows in the run queue while it works</li>
                <li>Already-tagged images are never changed</li>
              </ul>
            </div>

            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
              onClick={() => setShowAutoTagAdvanced((v) => !v)}
              data-testid="button-toggle-auto-tag-advanced"
            >
              {showAutoTagAdvanced ? "Hide advanced details" : "Read more (advanced)"}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showAutoTagAdvanced ? "rotate-180" : ""}`}
              />
            </button>

            {showAutoTagAdvanced && (
              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3 text-xs">
                <div>
                  <p className="font-medium text-foreground mb-1">How it works under the hood</p>
                  <p>
                    Runs the <code className="text-[11px]">image-auto-tags</code> validation fixer,
                    which calls <code className="text-[11px]">classifyAndApply()</code> for each
                    untagged image. Classification uses filename/YAML heuristics first, then AI
                    vision when needed, against the registry&apos;s{" "}
                    <code className="text-[11px]">tagDefinitions</code>.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-1">API &amp; side effects</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      Endpoint: <code className="text-[11px]">POST /api/validation/fix/image-auto-tags</code>
                    </li>
                    <li>Writes tags into the image registry (not YAML content files)</li>
                    <li>May call the configured vision model (uses AI credits when heuristics aren&apos;t enough)</li>
                    <li>Images with no suggested tags are skipped; failures are reported per image in the run queue</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="border-t pt-4 gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setAutoTagConfirmOpen(false)}
              disabled={autoTagging}
              data-testid="button-cancel-auto-tag"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleAutoTag()}
              disabled={autoTagging || untaggedImageCount === 0}
              data-testid="button-confirm-auto-tag"
            >
              {autoTagging ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Running…
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  {untaggedImageCount === 0 ? "Nothing to tag" : "Auto-tag images"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={migrateConfirmOpen} onOpenChange={setMigrateConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Migrate Local Images to {cloudProviderLabel}</DialogTitle>
            <DialogDescription>
              This will upload {localImageCount} local image{localImageCount !== 1 ? "s" : ""} to {cloudProviderLabel}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded bg-destructive/10 border border-destructive/20">
              <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
              <div className="text-xs space-y-1.5">
                <p className="font-medium text-destructive">This action is not reversible</p>
                <p className="text-muted-foreground">
                  All {localImageCount} local image{localImageCount !== 1 ? "s" : ""} will be uploaded to {cloudProviderLabel}. Image references in YAML content files and the image registry will be permanently updated to point to the cloud URLs.
                </p>
                <p className="text-muted-foreground">
                  The updated YAML files will <span className="font-medium text-foreground">not</span> be automatically committed to GitHub. You will need to commit and push the changes manually after migration.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setMigrateConfirmOpen(false)} data-testid="button-cancel-migrate">
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleMigrate} data-testid="button-confirm-migrate">
              <Cloud className="h-4 w-4 mr-2" />
              Migrate {localImageCount} image{localImageCount !== 1 ? "s" : ""} to {cloudProviderLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={migrateResults !== null} onOpenChange={(open) => { if (!open) setMigrateResults(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Migration Results</DialogTitle>
          </DialogHeader>
          {migrateResults && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{migrateResults.message}</p>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-green-600 dark:text-green-400">
                  {migrateResults.migratedCount} migrated
                </span>
                {migrateResults.totalProcessed - migrateResults.migratedCount > 0 && (
                  <span className="text-muted-foreground">
                    {migrateResults.totalProcessed - migrateResults.migratedCount} skipped/failed
                  </span>
                )}
              </div>
              <ScrollArea className="max-h-[300px]">
                <div className="border rounded-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium">Image ID</th>
                        <th className="text-left px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {migrateResults.results.map((result) => (
                        <tr
                          key={result.id}
                          className={result.status === "migrated"
                            ? "bg-green-50 dark:bg-green-950/30"
                            : "bg-muted/30"
                          }
                        >
                          <td className="px-3 py-2 font-mono text-xs truncate max-w-[200px]" data-testid={`text-migrate-id-${result.id}`}>
                            {result.id}
                          </td>
                          <td className={`px-3 py-2 text-xs ${result.status === "migrated" ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`} data-testid={`text-migrate-status-${result.id}`}>
                            {result.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ScrollArea>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setMigrateResults(null)} data-testid="button-close-migrate-results">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={redundantOpen} onOpenChange={(open) => { if (!open) { setRedundantOpen(false); setRedundantResult(null); setRedundantVisible(10); } }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Redundant Images Found</DialogTitle>
            <DialogDescription>
              There {redundantCount === 1 ? "is" : "are"} <span className="font-semibold text-foreground">{redundantCount}</span> {redundantCount === 1 ? "image" : "images"} that {redundantCount === 1 ? "has a copy" : "have copies"} in the cloud but also in the local filesystem. What do you want to do?
            </DialogDescription>
          </DialogHeader>

          {!redundantResult ? (
            <div className="space-y-3">
              <ScrollArea className="max-h-72 rounded-md border">
                <div className="divide-y">
                  {(redundantData?.images ?? []).slice(0, redundantVisible).map((img) => (
                    <div key={img.id} className="px-3 py-2.5 space-y-1.5">
                      <p className="text-xs font-mono font-medium text-foreground truncate" data-testid={`text-redundant-id-${img.id}`}>{img.id}</p>
                      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-start">
                        <div className="flex items-center gap-1 pt-px">
                          <Cloud className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-xs text-muted-foreground">Cloud</span>
                        </div>
                        <a href={img.cloudUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-muted-foreground break-all leading-relaxed hover:underline" data-testid={`link-cloud-${img.id}`}>{img.cloudUrl}</a>
                        <div className="flex items-center gap-1 pt-px">
                          <Folder className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-xs text-muted-foreground">Local</span>
                        </div>
                        <a href={img.localPath} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-muted-foreground break-all leading-relaxed hover:underline" data-testid={`link-local-${img.id}`}>{img.localPath}</a>
                      </div>
                    </div>
                  ))}
                </div>
                {redundantVisible < redundantCount && (
                  <div className="p-3 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => setRedundantVisible(v => v + 10)}
                      data-testid="button-load-more-redundant"
                    >
                      Load 10 more ({redundantCount - redundantVisible} remaining)
                    </Button>
                  </div>
                )}
              </ScrollArea>

              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">Choose an action to apply to all {redundantCount} {redundantCount === 1 ? "image" : "images"}:</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    className="justify-start gap-2"
                    disabled={resolveRedundancyMutation.isPending}
                    onClick={() => resolveRedundancyMutation.mutate("delete-local")}
                    data-testid="button-delete-local-redundant"
                  >
                    {resolveRedundancyMutation.isPending && resolveRedundancyMutation.variables === "delete-local"
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Folder className="h-4 w-4 text-muted-foreground" />
                    }
                    <span className="flex flex-col items-start text-left">
                      <span className="text-xs font-medium">Delete local</span>
                      <span className="text-xs text-muted-foreground font-normal">Keep cloud copy</span>
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start gap-2"
                    disabled={resolveRedundancyMutation.isPending}
                    onClick={() => resolveRedundancyMutation.mutate("delete-cloud")}
                    data-testid="button-delete-cloud-redundant"
                  >
                    {resolveRedundancyMutation.isPending && resolveRedundancyMutation.variables === "delete-cloud"
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Cloud className="h-4 w-4 text-muted-foreground" />
                    }
                    <span className="flex flex-col items-start text-left">
                      <span className="text-xs font-medium">Delete cloud</span>
                      <span className="text-xs text-muted-foreground font-normal">Keep local copy</span>
                    </span>
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2 py-1">
              <p className="text-sm text-muted-foreground">
                {redundantResult.resolved} {redundantResult.resolved === 1 ? "image" : "images"} resolved successfully.
                {redundantResult.errors.length > 0 && ` ${redundantResult.errors.length} error(s) occurred.`}
              </p>
              {redundantResult.errors.length > 0 && (
                <ScrollArea className="max-h-48 rounded-md border p-2">
                  <div className="space-y-1">
                    {redundantResult.errors.map((e, i) => (
                      <p key={i} className="text-xs text-destructive font-mono">{e}</p>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setRedundantOpen(false); setRedundantResult(null); setRedundantVisible(10); }}
              data-testid="button-close-redundant"
            >
              {redundantResult ? "Close" : "Cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={detailImageId !== null} onOpenChange={(open) => { if (!open) setDetailImageId(null); }}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Image className="h-5 w-5" />
              Media Details
            </SheetTitle>
            <SheetDescription>
              {detailImageId || ""}
            </SheetDescription>
          </SheetHeader>
          {detailImageId && registry?.images[detailImageId] && (() => {
            const img = registry.images[detailImageId];
            const mediaDoctype = inferDoctypeFromSrc(img.src);
            const filename = img.src.split("/").pop()?.split("?")[0] || detailImageId;
            const openUrl = img.src.startsWith("http") ? img.src : `${typeof window !== "undefined" ? window.location.origin : ""}${img.src}`;
            return (
              <div className="space-y-4 py-4">
                <div className="rounded-lg overflow-hidden border bg-muted">
                  {failedImages.has(detailImageId) ? (
                    <div className="aspect-video flex items-center justify-center">
                      <Image className="h-12 w-12 text-muted-foreground" />
                    </div>
                  ) : mediaDoctype === "pdf" ? (
                    <div className="aspect-video flex flex-col items-center justify-center gap-2 p-6">
                      <FileText className="h-12 w-12 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground text-center break-all">{filename}</p>
                      <a
                        href={openUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary underline"
                        data-testid="link-detail-open-pdf"
                      >
                        Open / download PDF
                      </a>
                    </div>
                  ) : mediaDoctype === "video" ? (
                    <div className="aspect-video flex flex-col items-center justify-center gap-2 p-6">
                      <Film className="h-12 w-12 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground text-center break-all">{filename}</p>
                      <a
                        href={openUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary underline"
                        data-testid="link-detail-open-video"
                      >
                        Open video
                      </a>
                    </div>
                  ) : (
                    <img
                      src={replacedAt[detailImageId] ? `${img.src}${img.src.includes("?") ? "&" : "?"}v=${replacedAt[detailImageId]}` : img.src}
                      alt={img.alt}
                      className="w-full h-auto"
                      onError={() => handleImageError(detailImageId)}
                    />
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Type</p>
                    <Badge variant="secondary" className="text-xs" data-testid="badge-detail-doctype">
                      {mediaDoctype ?? "unknown"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">ID</p>
                    <code className="text-sm font-mono" data-testid="text-detail-id">{detailImageId}</code>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Alt Text</p>
                    <p className="text-sm" data-testid="text-detail-alt">{img.alt}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Source</p>
                    <p className="text-xs font-mono break-all" data-testid="text-detail-src">{img.src}</p>
                  </div>
                  {img.tags && img.tags.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Tags</p>
                      <div className="flex flex-wrap gap-1">
                        {img.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {img.width && img.height && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Dimensions</p>
                      <p className="text-sm">{img.width} x {img.height}</p>
                    </div>
                  )}
                  {img.srcset && img.srcset.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">
                        Srcsets <span className="text-foreground font-medium">({img.srcset.length})</span>
                      </p>
                      <div className="flex flex-wrap gap-1" data-testid="list-detail-srcsets">
                        {img.srcset.map((s) => (
                          <Badge key={s.w} variant="secondary" className="text-xs font-mono" data-testid={`badge-srcset-${s.w}`}>
                            {s.w}w
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      <Sheet open={overridesOpen} onOpenChange={setOverridesOpen}>
        <SheetContent side="right" className="sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              DB Image Overrides
              {activeOverrides.length > 0 && (
                <Badge variant="secondary" className="text-xs" data-testid="badge-overrides-count">
                  {activeOverrides.reduce((sum, e) => sum + Object.keys(e.fields).length, 0)} active
                </Badge>
              )}
            </SheetTitle>
            <SheetDescription>
              Custom images set on individual database-backed entries (blog posts, programs, courses).
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto py-4 space-y-4" data-testid="panel-db-overrides">
            {overridesLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!overridesLoading && activeOverrides.length === 0 && (
              <div className="space-y-3 text-sm text-muted-foreground" data-testid="overrides-empty-state">
                <p>
                  <span className="font-medium text-foreground">No active overrides.</span>{" "}
                  All DB-backed entries are currently using their default images.
                </p>
                <p>
                  <span className="font-medium text-foreground">What are overrides?</span>{" "}
                  Some pages (blog posts, programs, courses) are powered by a database. When an editor replaces an image on one of those pages, the new image is saved as an <em>override</em> — a small record that says "for this slug, use this image instead."
                </p>
                <p>
                  <span className="font-medium text-foreground">What this panel does.</span>{" "}
                  Active overrides appear here with a thumbnail, content type, slug, and field name. You can reset any field — or all overrides for an entry — at any time.
                </p>
              </div>
            )}

            {!overridesLoading && activeOverrides.length > 0 && (() => {
              const uniqueDbs = [...new Set(activeOverrides.map((e) => e.contentType))];
              const filteredOverrides = selectedDb === "all"
                ? activeOverrides
                : activeOverrides.filter((e) => e.contentType === selectedDb);
              return (
                <>
                  <div className="flex items-center gap-2" data-testid="overrides-db-filter-row">
                    <Select value={selectedDb} onValueChange={setSelectedDb}>
                      <SelectTrigger className="flex-1" data-testid="select-db-filter">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All databases</SelectItem>
                        {uniqueDbs.map((db) => (
                          <SelectItem key={db} value={db}>{db}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resettingDb || selectedDb === "all"}
                      onClick={() => setConfirmResetDb(selectedDb)}
                      data-testid="button-reset-all-db"
                    >
                      Reset all
                    </Button>
                  </div>

                  <div className="space-y-3" data-testid="list-overrides">
                    {filteredOverrides.map((entry) => {
                  const fieldKeys = Object.keys(entry.fields);
                  return (
                    <div key={`${entry.contentType}-${entry.slug}`} className="rounded-md border p-3 space-y-2" data-testid={`override-entry-${entry.contentType}-${entry.slug}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs capitalize" data-testid={`badge-override-type-${entry.contentType}`}>
                            {entry.contentType}
                          </Badge>
                          <span className="text-sm font-mono text-foreground" data-testid={`text-override-slug-${entry.slug}`}>
                            {entry.slug}
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {fieldKeys.map((field) => {
                          const url = entry.fields[field];
                          return (
                            <div key={field} className="flex items-center gap-3" data-testid={`override-field-${entry.contentType}-${entry.slug}-${field}`}>
                              <img
                                src={url}
                                alt={`Override for ${field}`}
                                className="h-10 w-16 object-cover rounded-md border shrink-0"
                                data-testid={`img-override-${entry.contentType}-${entry.slug}-${field}`}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-mono text-muted-foreground truncate" data-testid={`text-override-field-${field}`}>
                                  {field}
                                </div>
                                <div className="text-xs text-muted-foreground truncate" title={url} data-testid={`text-override-url-${field}`}>
                                  {url}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => resetOverrideMutation.mutate({ contentType: entry.contentType, slug: entry.slug, field })}
                                disabled={resetOverrideMutation.isPending}
                                data-testid={`button-reset-field-${entry.contentType}-${entry.slug}-${field}`}
                              >
                                Reset
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                    })}
                  </div>
                </>
              );
            })()}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmResetDb !== null} onOpenChange={(open) => { if (!open) setConfirmResetDb(null); }}>
        <AlertDialogContent data-testid="dialog-confirm-reset-db">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all overrides?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reset all image overrides for{" "}
              <span className="font-semibold text-foreground">{confirmResetDb}</span>?{" "}
              All entries in this database will revert to their original images. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-confirm-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmResetDb && handleResetAllForDb(confirmResetDb)}
              disabled={resettingDb}
              data-testid="button-confirm-reset-db"
            >
              {resettingDb ? "Resetting…" : "Reset all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteConfirmId(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-confirm-delete-image">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this image?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Permanently remove{" "}
                  <span className="font-mono font-semibold text-foreground">{deleteConfirmId}</span>{" "}
                  from the Media Gallery.
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Removes the entry from <code className="text-xs">image-registry.json</code></li>
                  <li>Deletes the file and any optimized srcset variants from storage</li>
                  <li>Blocked if the image is still referenced in content YAML</li>
                </ul>
                <p>
                  Content fields that only store this URL are not auto-cleared — fix those separately
                  if needed.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} data-testid="button-delete-image-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void confirmSingleDelete();
              }}
              data-testid="button-delete-image-confirm"
            >
              {deleting ? "Deleting…" : "Delete image"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <input
        ref={replaceFileInputRef}
        type="file"
        className="hidden"
        accept={
          replaceTargetId && registry?.images[replaceTargetId]
            ? acceptAttrForDoctype(
                inferDoctypeFromSrc(registry.images[replaceTargetId].src) ?? "image",
              )
            : "image/*"
        }
        onChange={handleReplaceFileSelected}
        data-testid="input-replace-file"
      />

      <AlertDialog
        open={replaceConfirmOpen}
        onOpenChange={(open) => {
          if (!open) cancelReplaceFlow();
        }}
      >
        <AlertDialogContent data-testid="dialog-confirm-replace-image">
          <AlertDialogHeader>
            <AlertDialogTitle>Replace this asset?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Overwrite{" "}
                  <span className="font-mono font-semibold text-foreground">{replaceTargetId}</span>{" "}
                  with{" "}
                  <span className="font-semibold text-foreground">{replaceFile?.name}</span>.
                  The gallery ID stays the same, so pages that reference it will show the new file.
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Images are converted to WebP before storage</li>
                  <li>Alt text, tags, and other metadata are kept</li>
                  <li>Srcset variants are regenerated in the background</li>
                  <li>Public pages may need a hard refresh if the URL was cached</li>
                </ul>
                {replaceTargetId && getChildIdsFor(replaceTargetId).length > 0 && (
                  <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
                    <p className="font-medium text-foreground">
                      Crop / resize variants still use the old image
                    </p>
                    <p>
                      These child IDs will keep showing the previous file until you replace or
                      re-crop them manually:
                    </p>
                    <ul className="list-disc pl-5 font-mono text-xs text-foreground space-y-0.5">
                      {getChildIdsFor(replaceTargetId).map((childId) => (
                        <li key={childId}>{childId}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={replacing} data-testid="button-replace-image-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={replacing || !replaceFile}
              onClick={(e) => {
                e.preventDefault();
                void confirmReplace();
              }}
              data-testid="button-replace-image-confirm"
            >
              {replacing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Replacing…
                </>
              ) : (
                "Replace"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={replaceDuplicateId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReplaceDuplicateId(null);
            setReplaceTargetId(null);
          }
        }}
      >
        <AlertDialogContent data-testid="dialog-replace-duplicate">
          <AlertDialogHeader>
            <AlertDialogTitle>File already in gallery</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  This file is already registered as{" "}
                  <span className="font-mono font-semibold text-foreground">{replaceDuplicateId}</span>.
                  Replace was cancelled so the gallery stays deduplicated.
                </p>
                <p>Use the existing ID in content instead of overwriting another entry.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-replace-duplicate-dismiss">
              Dismiss
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (replaceDuplicateId) {
                  navigator.clipboard.writeText(replaceDuplicateId);
                  setCopiedId(replaceDuplicateId);
                  setTimeout(() => setCopiedId(null), 2000);
                  toast({
                    title: "Copied",
                    description: `Existing ID "${replaceDuplicateId}" copied to clipboard`,
                  });
                }
                setReplaceDuplicateId(null);
                setReplaceTargetId(null);
              }}
              data-testid="button-replace-duplicate-copy"
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy existing ID
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open && !bulkDeleting) setBulkDeleteConfirmOpen(false);
        }}
      >
        <AlertDialogContent data-testid="dialog-confirm-bulk-delete">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedImages.size} image{selectedImages.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Permanently remove the selected images from the Media Gallery.
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Removes each entry from <code className="text-xs">image-registry.json</code></li>
                  <li>Deletes files and optimized srcset variants from storage</li>
                  <li>Skips any image still referenced in content YAML (reported in results)</li>
                </ul>
                <p>
                  URL fields on database entries or pages are not auto-cleared.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting} data-testid="button-bulk-delete-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void handleBulkDelete();
              }}
              data-testid="button-bulk-delete-confirm"
            >
              {bulkDeleting ? "Deleting…" : "Delete selected"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={scriptsOpen} onOpenChange={(open) => { if (!open) setScriptsOpen(false); }}>
        <SheetContent side="right" className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Admin Scripts
            </SheetTitle>
            <SheetDescription>
              Run admin scripts for image registry maintenance.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 py-4">
            <div className="rounded-md border p-4 space-y-3" data-testid="script-card-migrate">
              <div>
                <h4 className="text-sm font-semibold" data-testid="text-script-migrate-title">Migrate to Cloud</h4>
                <p className="text-xs text-muted-foreground">Migrate images between providers (e.g. local to GCS or vice versa).</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">From:</span>
                  <select
                    value={scriptMigrateFrom}
                    onChange={(e) => setScriptMigrateFrom(e.target.value)}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    data-testid="select-migrate-from"
                  >
                    <option value="local">local</option>
                    <option value="gcs">gcs</option>
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">To:</span>
                  <select
                    value={scriptMigrateTo}
                    onChange={(e) => setScriptMigrateTo(e.target.value)}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    data-testid="select-migrate-to"
                  >
                    <option value="local">local</option>
                    <option value="gcs">gcs</option>
                  </select>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer" data-testid="label-migrate-dryrun">
                  <input
                    type="checkbox"
                    checked={scriptMigrateDryRun}
                    onChange={(e) => setScriptMigrateDryRun(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-xs">Dry run</span>
                </label>
                <Button
                  size="sm"
                  onClick={handleRunMigrateScript}
                  disabled={scriptMigrateRunning || scriptMigrateFrom === scriptMigrateTo}
                  data-testid="button-run-migrate"
                >
                  {scriptMigrateRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                  {scriptMigrateRunning ? "Running..." : "Run"}
                </Button>
              </div>
              {scriptMigrateOutput && (
                <div className="space-y-2" data-testid="output-migrate">
                  <p className="text-xs font-medium">{scriptMigrateOutput.message}</p>
                  {scriptMigrateOutput.results.length > 0 && (
                    <ScrollArea className="max-h-48 rounded-md border bg-muted/30 p-2">
                      <pre className="text-xs font-mono whitespace-pre-wrap">
                        {scriptMigrateOutput.results.map(r =>
                          `[${r.status}] ${r.id}: ${r.oldSrc || ""} → ${r.newSrc || ""}`
                        ).join("\n")}
                      </pre>
                    </ScrollArea>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-md border p-4 space-y-3" data-testid="script-card-remove-unused">
              <div>
                <h4 className="text-sm font-semibold" data-testid="text-script-remove-unused-title">Remove Unused Images</h4>
                <p className="text-xs text-muted-foreground">Scans all YAML files for image_id references and removes registry entries (and files) for images not referenced anywhere.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer" data-testid="label-remove-unused-dryrun">
                  <input
                    type="checkbox"
                    checked={scriptRemoveUnusedDryRun}
                    onChange={(e) => setScriptRemoveUnusedDryRun(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-xs">Dry run</span>
                </label>
                <Button
                  size="sm"
                  onClick={handleRunRemoveUnusedScript}
                  disabled={scriptRemoveUnusedRunning}
                  data-testid="button-run-remove-unused"
                >
                  {scriptRemoveUnusedRunning && !scriptRemoveUnusedProgress ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                  {scriptRemoveUnusedRunning
                    ? scriptRemoveUnusedProgress
                      ? `${scriptRemoveUnusedProgress.processed} / ${scriptRemoveUnusedProgress.total} processed`
                      : "Scanning..."
                    : "Run"}
                </Button>
              </div>
              {scriptRemoveUnusedRunning && scriptRemoveUnusedProgress && (
                <div className="space-y-1" data-testid="progress-remove-unused">
                  <Progress
                    value={(scriptRemoveUnusedProgress.processed / scriptRemoveUnusedProgress.total) * 100}
                    className="h-2"
                    data-testid="progressbar-remove-unused"
                  />
                  <p className="text-xs text-muted-foreground" data-testid="text-progress-remove-unused">
                    {scriptRemoveUnusedProgress.processed} / {scriptRemoveUnusedProgress.total} processed
                  </p>
                </div>
              )}
              {scriptRemoveUnusedStreamError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2" data-testid="error-banner-remove-unused">
                  <p className="text-xs font-medium text-destructive">{scriptRemoveUnusedStreamError}</p>
                </div>
              )}
              {scriptRemoveUnusedOutput && !scriptRemoveUnusedRunning && (
                <div className="space-y-2" data-testid="output-remove-unused">
                  <p className="text-xs font-medium">{scriptRemoveUnusedOutput.message}</p>
                  {scriptRemoveUnusedOutput.results.length > 0 && (
                    <ScrollArea className="max-h-48 rounded-md border bg-muted/30 p-2">
                      <div className="text-xs font-mono space-y-0.5">
                        {scriptRemoveUnusedOutput.results.map((r, i) => (
                          <div
                            key={i}
                            className={
                              r.status === "error"
                                ? "text-destructive"
                                : r.status === "removed-with-cleanup-errors"
                                  ? "text-amber-700 dark:text-amber-300"
                                  : r.status === "skipped-external-source"
                                    ? "text-muted-foreground"
                                    : ""
                            }
                            data-testid={`result-row-${i}`}
                          >
                            [{r.status}] {r.id}: {(r.reason || r.src)}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              )}
              {scriptRemoveUnusedRunning && scriptRemoveUnusedOutput && scriptRemoveUnusedOutput.results.length > 0 && (
                <div className="space-y-2" data-testid="output-remove-unused-streaming">
                  <ScrollArea className="max-h-48 rounded-md border bg-muted/30 p-2">
                    <div className="text-xs font-mono space-y-0.5">
                      {scriptRemoveUnusedOutput.results.map((r, i) => (
                        <div
                          key={i}
                          className={
                            r.status === "error"
                              ? "text-destructive"
                              : r.status === "removed-with-cleanup-errors"
                                ? "text-amber-700 dark:text-amber-300"
                                : r.status === "skipped-external-source"
                                  ? "text-muted-foreground"
                                  : ""
                          }
                          data-testid={`result-row-streaming-${i}`}
                        >
                          [{r.status}] {r.id}: {(r.reason || r.src)}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          </div>

          <SheetFooter>
            <Button
              variant="outline"
              onClick={() => {
                setScriptsOpen(false);
                setScriptMigrateOutput(null);
                setScriptRemoveUnusedOutput(null);
                setScriptRemoveUnusedProgress(null);
                setScriptRemoveUnusedStreamError(null);
              }}
              data-testid="button-close-scripts"
            >
              Close
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ImagePickerDialog
        open={addMediaOpen}
        onOpenChange={setAddMediaOpen}
        title={
          addMediaDoctype === "video"
            ? "Add video"
            : addMediaDoctype === "pdf"
              ? "Add PDF"
              : "Add image"
        }
        doctype={addMediaDoctype}
        initialMode="upload"
        uploadOnly
        closeOnSuccessfulUpload
        onSave={async () => {}}
      />

      <RunQueueSidebar
        open={runQueueOpen}
        onOpenChange={setRunQueueOpen}
        runs={runQueueRuns}
        onClearRuns={handleClearRunQueue}
      />
    </div>
  );
}
