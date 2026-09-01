import { useState, useEffect, useRef } from "react";
import {AlertTriangle, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpDown, Check, ChevronDown, ChevronUp, CircleCheck, CircleX, Clock, CloudUpload, Code, Copy, Database, Download, ExternalLink, Eye, File, HeartPulse, HelpCircle, Image, Info, Link as LinkIcon, Loader2, Network, Pencil, Play, Plus, RefreshCw, Save, Search, Server, Settings, SlidersHorizontal, Sparkles, Table, Tags, TestTube, Trash2, Upload, Wand2, Webhook, X} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { reloadDatabaseList } from "@/lib/reloadDatabaseList";
import { useToast } from "@/hooks/use-toast";
import { ItemEditModal } from "@/components/databases/ItemEditModal";
import { EditorTypeDialog, type EditorHint } from "@/components/editing/EditorTypeDialog";
import JsonViewer from "@/components/editing/JsonViewer";
import { WebhookUrlPopover } from "@/components/WebhookUrlPopover";

interface DatabaseSummary {
  name: string;
  label: string;
  description: string | null;
  source_type: string;
  field_count: number;
}

type SourceType = "api" | "local" | "remote";

interface DatabaseValidationIssue {
  code?: string;
  message: string;
  file?: string;
  suggestion?: string;
  type?: string;
}

interface DatabaseDetail {
  name: string;
  config: {
    name: string;
    description?: string;
    source: {
      type: string;
      api?: {
        endpoint: string;
        params?: Record<string, unknown>;
        results_path?: string;
        auth?: { token_env_var?: string; prefix?: string };
        headers?: Record<string, string>;
      };
      local?: {
        filename: string;
        results_path?: string;
      };
      remote?: {
        url: string;
        results_path?: string;
      };
    };
    cache?: { ttl_hours?: number };
    field_mapping?: Record<string, string>;
    filter_by_locale?: boolean;
    editor?: Record<string, { type?: string; options?: (string | { value: string; label: string })[]; populate_options?: boolean; allow_custom_values?: boolean; split_comma_values?: boolean; cache_images?: boolean; description?: string }>;
    vector_search?: { enabled: boolean; fields: string[] };
  };
  cache_status?: {
    fetched_at: string;
    item_count: number;
  } | null;
  error_count?: number;
  error_summary?: string;
  validation_errors?: DatabaseValidationIssue[];
  validation_warnings?: DatabaseValidationIssue[];
}

type DatabaseUsageQueryKind =
  | "direct_database"
  | "via_content_type"
  | "form_source"
  | "field_editor";

interface DatabaseUsageReport {
  content_types: Array<{ name: string; label: string }>;
  queries: Array<{
    kind: DatabaseUsageQueryKind;
    content_type: string;
    slug?: string;
    locale?: string;
    file?: string;
    section_type?: string;
    source_name?: string;
  }>;
  notes?: string[];
}

const USAGE_KIND_LABELS: Record<DatabaseUsageQueryKind, string> = {
  direct_database: "Direct",
  via_content_type: "Via content type",
  form_source: "Form",
  field_editor: "Editor",
};

function groupUsageCounts(
  queries: DatabaseUsageReport["queries"],
  keyFn: (q: DatabaseUsageReport["queries"][number]) => string,
): Array<{ key: string; count: number }> {
  const map = new Map<string, number>();
  for (const q of queries) {
    const key = keyFn(q);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function UsageGroupKpis({
  title,
  items,
  testId,
  selectedKey,
  onSelect,
}: {
  title: string;
  items: Array<{ key: string; count: number }>;
  testId: string;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
}) {
  if (items.length === 0) return null;
  const selectable = typeof onSelect === "function";
  return (
    <div className="space-y-2" data-testid={testId}>
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {title}
      </h4>
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {items.map(({ key, count }) => {
          const selected = selectedKey === key;
          return (
            <button
              key={key}
              type="button"
              disabled={!selectable}
              onClick={() => onSelect?.(key)}
              className={`rounded-md border px-3 py-2 space-y-0.5 text-left transition-colors ${
                selectable ? "cursor-pointer hover-elevate" : "cursor-default"
              } ${
                selected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-muted/40"
              }`}
              data-testid={`${testId}-item-${key}`}
              aria-pressed={selectable ? selected : undefined}
            >
              <p className="text-lg font-semibold tabular-nums text-foreground leading-none">
                {count}
              </p>
              <p className="text-xs text-muted-foreground truncate" title={key}>
                {key}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface DatasetFile {
  id: string;
  filename: string;
  dbSlug: string;
  provider: "local";
  path: string;
}

interface DatabaseItems {
  items: Record<string, unknown>[];
  total_count: number;
  page: number;
  limit: number;
  raw_count?: number;
  fetched_at?: string;
  from_cache?: boolean;
  facets?: Record<string, string[]>;
}

interface KeyValuePair {
  key: string;
  value: string;
}

interface FieldEntry {
  sourcePath: string;
  normalizedKey: string;
  enabled: boolean;
}

function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return [];
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...flattenKeys(value, fullPath));
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function parseDatabaseApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    const message = body.error ?? body.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  } catch {
    // response body was not JSON
  }
  return fallback;
}

function DatasetPickerDialog({
  open,
  onOpenChange,
  slug,
  onSelected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  onSelected: (result: { provider: "local"; filename: string; path: string }) => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"browse" | "upload">("browse");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DatasetFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: datasetsData, isLoading: loadingDatasets } = useQuery<{ datasets: DatasetFile[] }>({
    queryKey: ["/api/databases/datasets"],
    enabled: open && mode === "browse",
  });

  const datasets = datasetsData?.datasets || [];
  const filtered = datasets.filter(
    (d) =>
      !search ||
      d.filename.toLowerCase().includes(search.toLowerCase()) ||
      d.dbSlug.toLowerCase().includes(search.toLowerCase())
  );

  const handleUpload = async (files: FileList) => {
    const file = files[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("slug", slug || "datasets");
      const res = await fetch("/api/databases/upload-dataset", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast({ title: "File uploaded", description: data.filename });
      onSelected({ provider: "local", filename: data.filename, path: data.path });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setSearch("");
          setSelected(null);
          setMode("browse");
        }
      }}
    >
      <DialogContent className="sm:max-w-xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Pick Dataset File</DialogTitle>
          <DialogDescription>
            Browse existing dataset files or upload a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 py-2">
          <div className="flex rounded-md border overflow-visible">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={`flex-1 rounded-none toggle-elevate ${mode === "browse" ? "toggle-elevated bg-muted" : ""}`}
              onClick={() => setMode("browse")}
              data-testid="button-dataset-picker-browse"
            >
              <Search className="h-4 w-4 mr-1.5" />
              Browse
            </Button>
            <div className="w-px bg-border" />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={`flex-1 rounded-none toggle-elevate ${mode === "upload" ? "toggle-elevated bg-muted" : ""}`}
              onClick={() => setMode("upload")}
              data-testid="button-dataset-picker-upload"
            >
              <Upload className="h-4 w-4 mr-1.5" />
              Upload
            </Button>
          </div>

          {mode === "browse" ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search files..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                  data-testid="input-dataset-search"
                />
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                {loadingDatasets ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-8 space-y-2">
                    <File className="h-8 w-8 mx-auto text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">No dataset files found</p>
                    <p className="text-xs text-muted-foreground">
                      Switch to Upload to add a new file, or place files in{" "}
                      <code className="bg-muted px-1 rounded">4geeks-com/db/</code>
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filtered.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setSelected(d)}
                        className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-md border-2 transition-colors ${
                          selected?.id === d.id
                            ? "border-primary bg-primary/5"
                            : "border-transparent hover:border-muted-foreground/30 hover:bg-muted/50"
                        }`}
                        data-testid={`dataset-file-${d.id}`}
                      >
                        <File className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{d.filename}</p>
                          <p className="text-xs text-muted-foreground truncate">{d.path}</p>
                        </div>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          <Server className="h-3 w-3 mr-1" />
                          local
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center min-h-[200px]">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.csv,.yaml,.yml"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) handleUpload(e.target.files);
                  e.target.value = "";
                }}
                data-testid="input-dataset-file-upload"
              />
              <div
                className={`w-full rounded-md border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/30 hover:border-muted-foreground/50"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                data-testid="dropzone-dataset-upload"
              >
                {uploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Uploading...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <CloudUpload className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium">Drop a file here or click to browse</p>
                    <p className="text-xs text-muted-foreground">JSON, CSV, YAML (max 50 MB)</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Saves to 4geeks-com/db/{slug || "<slug>"}/
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-dataset-picker-cancel"
          >
            Cancel
          </Button>
          {mode === "browse" && (
            <Button
              type="button"
              disabled={!selected}
              onClick={() => {
                if (selected) {
                  onSelected({ provider: "local", filename: selected.filename, path: selected.path });
                  onOpenChange(false);
                }
              }}
              data-testid="button-dataset-picker-select"
            >
              <Check className="h-4 w-4 mr-2" />
              Select
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function lastSegment(dotPath: string): string {
  const parts = dotPath.split(".");
  return parts[parts.length - 1];
}

function CreateDatabaseDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (slug: string) => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [ttlHours, setTtlHours] = useState("24");

  const [sourceType, setSourceType] = useState<SourceType>("api");
  const [endpoint, setEndpoint] = useState("");
  const [resultsPath, setResultsPath] = useState("");
  const [tokenEnvVar, setTokenEnvVar] = useState("");
  const [authPrefix, setAuthPrefix] = useState("Bearer");
  const [params, setParams] = useState<KeyValuePair[]>([]);
  const [headers, setHeaders] = useState<KeyValuePair[]>([]);
  const [localFilename, setLocalFilename] = useState("");
  const [localFileStatus, setLocalFileStatus] = useState<"idle" | "checking" | "found" | "not-found">("idle");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [datasetPickerOpen, setDatasetPickerOpen] = useState(false);

  useEffect(() => {
    if (sourceType !== "local" || !localFilename.trim() || !slug.trim()) {
      setLocalFileStatus("idle");
      return;
    }
    setLocalFileStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/databases/check-file?slug=${encodeURIComponent(slug)}&filename=${encodeURIComponent(localFilename.trim())}`);
        const data = await res.json();
        setLocalFileStatus(data.exists ? "found" : "not-found");
      } catch {
        setLocalFileStatus("idle");
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [localFilename, slug, sourceType]);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    item_count?: number;
    sample?: unknown;
    error?: string;
  } | null>(null);
  const [fields, setFields] = useState<FieldEntry[]>([]);

  const resetForm = () => {
    setStep(1);
    setDisplayName("");
    setSlug("");
    setSlugTouched(false);
    setDescription("");
    setTtlHours("24");
    setSourceType("api");
    setEndpoint("");
    setResultsPath("");
    setTokenEnvVar("");
    setAuthPrefix("Bearer");
    setParams([]);
    setHeaders([]);
    setLocalFilename("");
    setRemoteUrl("");
    setDatasetPickerOpen(false);
    setTesting(false);
    setTestResult(null);
    setFields([]);
    setSaving(false);
  };

  const handleNameChange = (val: string) => {
    setDisplayName(val);
    if (!slugTouched) {
      setSlug(slugify(val));
    }
  };

  const buildSourceConfig = () => {
    if (sourceType === "local") {
      return {
        type: "local",
        local: {
          filename: localFilename,
          ...(resultsPath ? { results_path: resultsPath } : {}),
        },
      };
    }
    if (sourceType === "remote") {
      return {
        type: "remote",
        remote: {
          url: remoteUrl,
          ...(resultsPath ? { results_path: resultsPath } : {}),
        },
      };
    }
    const source: Record<string, unknown> = { type: "api" };
    const api: Record<string, unknown> = { endpoint };
    if (resultsPath) api.results_path = resultsPath;
    if (tokenEnvVar) {
      api.auth = { token_env_var: tokenEnvVar, prefix: authPrefix || "Bearer" };
    }
    const filteredParams = params.filter((p) => p.key.trim());
    if (filteredParams.length > 0) {
      api.params = Object.fromEntries(filteredParams.map((p) => [p.key, p.value]));
    }
    const filteredHeaders = headers.filter((h) => h.key.trim());
    if (filteredHeaders.length > 0) {
      api.headers = Object.fromEntries(filteredHeaders.map((h) => [h.key, h.value]));
    }
    source.api = api;
    return source;
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/databases/_test/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: buildSourceConfig(), slug }),
      });
      const data = await res.json();
      setTestResult(data);
      if (data.success && data.sample) {
        const paths = flattenKeys(data.sample);
        setFields(
          paths.map((p) => ({
            sourcePath: p,
            normalizedKey: lastSegment(p),
            enabled: true,
          }))
        );
      }
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const fieldMapping: Record<string, string> = {};
      for (const f of fields) {
        if (f.enabled && f.normalizedKey.trim()) {
          fieldMapping[f.normalizedKey] = f.sourcePath;
        }
      }

      const config = {
        name: displayName,
        description: description || undefined,
        source: buildSourceConfig(),
        cache: { ttl_hours: ttlHours !== "" && Number.isFinite(Number(ttlHours)) ? Number(ttlHours) : 24 },
        field_mapping: Object.keys(fieldMapping).length > 0 ? fieldMapping : undefined,
      };

      const res = await fetch("/api/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, config }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create database");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/databases"] });
      toast({ title: "Database created", description: `"${displayName}" is ready.` });
      onOpenChange(false);
      resetForm();
      onCreated(slug);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const slugValid = /^[a-z0-9_-]+$/.test(slug);
  const canProceedStep1 = displayName.trim() && slug.trim() && slugValid;
  const canProceedStep2 =
    sourceType === "api"
      ? endpoint.trim().length > 0
      : sourceType === "local"
      ? localFilename.trim().length > 0
      : remoteUrl.trim().length > 0;
  const canCreate = fields.some((f) => f.enabled) || fields.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Create Database
          </DialogTitle>
          <DialogDescription>
            Step {step} of 3 —{" "}
            {step === 1 ? "Basics" : step === 2 ? "Data Source" : "Test & Map Fields"}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="db-name">Display Name</Label>
              <Input
                id="db-name"
                placeholder="e.g. Upcoming Cohorts"
                value={displayName}
                onChange={(e) => handleNameChange(e.target.value)}
                data-testid="input-db-display-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-slug">Slug</Label>
              <Input
                id="db-slug"
                placeholder="e.g. upcoming_cohorts"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                }}
                data-testid="input-db-slug"
              />
              {slug && !slugValid && (
                <p className="text-xs text-destructive">
                  Only lowercase letters, digits, hyphens, and underscores allowed.
                </p>
              )}
              {(!slug || slugValid) && (
                <p className="text-xs text-muted-foreground">
                  Lowercase letters, digits, hyphens, and underscores only.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-desc">Description (optional)</Label>
              <Textarea
                id="db-desc"
                placeholder="What data does this database contain?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="resize-none text-sm"
                rows={2}
                data-testid="input-db-description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-ttl">Cache TTL (hours)</Label>
              <Input
                id="db-ttl"
                type="number"
                min="0"
                value={ttlHours}
                onChange={(e) => setTtlHours(e.target.value)}
                className="w-24"
                data-testid="input-db-ttl"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="db-source-type">Source Type</Label>
              <Select value={sourceType} onValueChange={(v) => { setSourceType(v as SourceType); setResultsPath(""); }}>
                <SelectTrigger id="db-source-type" data-testid="select-db-source-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="api">
                    <div className="flex items-center gap-2">
                      <Webhook className="h-4 w-4" />
                      API Endpoint
                    </div>
                  </SelectItem>
                  <SelectItem value="local">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4" />
                      Local File
                    </div>
                  </SelectItem>
                  <SelectItem value="remote">
                    <div className="flex items-center gap-2">
                      <LinkIcon className="h-4 w-4" />
                      Remote File
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {sourceType === "api" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="db-endpoint">Endpoint URL</Label>
                  <Input
                    id="db-endpoint"
                    placeholder="https://api.example.com/v1/items"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    data-testid="input-db-endpoint"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="db-results-path">Results Path (optional)</Label>
                  <Input
                    id="db-results-path"
                    placeholder="e.g. results, data.items"
                    value={resultsPath}
                    onChange={(e) => setResultsPath(e.target.value)}
                    data-testid="input-db-results-path"
                  />
                  <p className="text-xs text-muted-foreground">
                    Dot-notation path to the array in the API response. Leave empty if the response is already an array.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Authentication (optional)</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="ENV var name"
                      value={tokenEnvVar}
                      onChange={(e) => setTokenEnvVar(e.target.value)}
                      data-testid="input-db-token-env"
                    />
                    <Input
                      placeholder="Prefix (Bearer, Token...)"
                      value={authPrefix}
                      onChange={(e) => setAuthPrefix(e.target.value)}
                      data-testid="input-db-auth-prefix"
                    />
                  </div>
                </div>
                <KeyValueEditor
                  label="Query Parameters"
                  pairs={params}
                  onChange={setParams}
                  keyPlaceholder="param name"
                  valuePlaceholder="value"
                  testIdPrefix="param"
                />
                <KeyValueEditor
                  label="Headers"
                  pairs={headers}
                  onChange={setHeaders}
                  keyPlaceholder="header name"
                  valuePlaceholder="value"
                  testIdPrefix="header"
                />
              </>
            )}

            {sourceType === "local" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="db-local-filename">Filename</Label>
                  <div className="relative">
                    <Input
                      id="db-local-filename"
                      placeholder="e.g. products.json, data.csv"
                      value={localFilename}
                      onChange={(e) => setLocalFilename(e.target.value)}
                      data-testid="input-db-local-filename"
                      className="pr-8"
                    />
                    {localFileStatus === "checking" && (
                      <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {localFileStatus === "found" && (
                      <Check className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                    )}
                    {localFileStatus === "not-found" && (
                      <X className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive" />
                    )}
                  </div>
                  <div className="rounded-md bg-muted/50 border px-3 py-2 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground">Where to place the file</p>
                    <p>
                      Put your file at{" "}
                      <code className="bg-muted px-1 rounded">
                        4geeks-com/db/{slug || "<slug>"}/<span className="text-foreground">{localFilename || "your-file.json"}</span>
                      </code>{" "}
                      before syncing.
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="db-local-results-path">Results Path (optional)</Label>
                  <Input
                    id="db-local-results-path"
                    placeholder="e.g. results, data.items"
                    value={resultsPath}
                    onChange={(e) => setResultsPath(e.target.value)}
                    data-testid="input-db-local-results-path"
                  />
                  <p className="text-xs text-muted-foreground">
                    For JSON files: dot-notation path to the array. Leave empty if the file is already an array.
                  </p>
                </div>
              </>
            )}

            {sourceType === "remote" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="db-remote-url">Remote URL</Label>
                  <div className="flex gap-2">
                    <Input
                      id="db-remote-url"
                      placeholder="https://example.com/data.json"
                      value={remoteUrl}
                      onChange={(e) => setRemoteUrl(e.target.value)}
                      data-testid="input-db-remote-url"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDatasetPickerOpen(true)}
                      data-testid="button-db-pick-file-remote"
                    >
                      <File className="h-4 w-4 mr-1.5" />
                      Pick File
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Direct URL to a JSON, CSV, or YAML file. Use "Pick File" to browse or upload a file from storage.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="db-remote-results-path">Results Path (optional)</Label>
                  <Input
                    id="db-remote-results-path"
                    placeholder="e.g. results, data.items"
                    value={resultsPath}
                    onChange={(e) => setResultsPath(e.target.value)}
                    data-testid="input-db-remote-results-path"
                  />
                  <p className="text-xs text-muted-foreground">
                    Dot-notation path to the array. Leave empty if the response is already an array.
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing}
                data-testid="button-test-connection"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <TestTube className="h-3.5 w-3.5 mr-1" />
                )}
                Test Connection
              </Button>
              {testResult && (
                <Badge variant={testResult.success ? "secondary" : "destructive"}>
                  {testResult.success ? (
                    <>
                      <Check className="h-3 w-3 mr-1" />
                      {testResult.item_count} items found
                    </>
                  ) : (
                    <>
                      <X className="h-3 w-3 mr-1" />
                      Failed
                    </>
                  )}
                </Badge>
              )}
            </div>

            {testResult?.error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 text-xs text-destructive">
                {testResult.error}
              </div>
            )}

            {testResult?.success && fields.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm">Field Mapping</Label>
                  <p className="text-xs text-muted-foreground">
                    {fields.filter((f) => f.enabled).length} of {fields.length} fields selected
                  </p>
                </div>
                <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
                  {fields.map((field, i) => (
                    <div
                      key={field.sourcePath}
                      className="flex items-center gap-2 px-3 py-2"
                      data-testid={`field-mapping-${i}`}
                    >
                      <Switch
                        checked={field.enabled}
                        onCheckedChange={(checked) => {
                          const updated = [...fields];
                          updated[i] = { ...updated[i], enabled: checked };
                          setFields(updated);
                        }}
                        data-testid={`switch-field-${i}`}
                      />
                      <Input
                        value={field.normalizedKey}
                        onChange={(e) => {
                          const updated = [...fields];
                          updated[i] = { ...updated[i], normalizedKey: e.target.value };
                          setFields(updated);
                        }}
                        className="h-7 text-xs flex-1"
                        disabled={!field.enabled}
                        data-testid={`input-field-key-${i}`}
                      />
                      <code className="text-xs text-muted-foreground shrink-0 max-w-[200px] truncate" title={field.sourcePath}>
                        {field.sourcePath}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {testResult?.success && fields.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No fields detected in sample. The database will store raw items without field mapping.
              </p>
            )}

            {!testResult && (
              <div className="text-center py-8">
                <TestTube className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">
                  Test the connection to preview the data and configure field mappings.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <div>
            {step > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(step - 1)}
                data-testid="button-step-back"
              >
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step < 3 && (
              <Button
                size="sm"
                onClick={() => setStep(step + 1)}
                disabled={step === 1 ? !canProceedStep1 : !canProceedStep2}
                data-testid="button-step-next"
              >
                Next
              </Button>
            )}
            {step === 3 && (
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={saving || !canCreate}
                data-testid="button-create-database"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5 mr-1" />
                )}
                Create Database
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>

      <DatasetPickerDialog
        open={datasetPickerOpen}
        onOpenChange={setDatasetPickerOpen}
        slug={slug}
        onSelected={(result) => {
          setLocalFilename(result.filename);
          setSourceType("local");
        }}
      />
    </Dialog>
  );
}

function KeyValueEditor({
  label,
  addLabel = "Add",
  pairs,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  testIdPrefix,
}: {
  label: string;
  addLabel?: string;
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  testIdPrefix: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm">{label}</Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([...pairs, { key: "", value: "" }])}
          data-testid={`button-add-${testIdPrefix}`}
        >
          <Plus className="h-3 w-3 mr-1" />
          {addLabel}
        </Button>
      </div>
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            placeholder={keyPlaceholder}
            value={pair.key}
            onChange={(e) => {
              const updated = [...pairs];
              updated[i] = { ...updated[i], key: e.target.value };
              onChange(updated);
            }}
            className="h-8 text-xs flex-1"
            data-testid={`input-${testIdPrefix}-key-${i}`}
          />
          <Input
            placeholder={valuePlaceholder}
            value={pair.value}
            onChange={(e) => {
              const updated = [...pairs];
              updated[i] = { ...updated[i], value: e.target.value };
              onChange(updated);
            }}
            className="h-8 text-xs flex-1"
            data-testid={`input-${testIdPrefix}-value-${i}`}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
            data-testid={`button-remove-${testIdPrefix}-${i}`}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function DatabaseList() {
  const [createOpen, setCreateOpen] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("create") === "true") {
        params.delete("create");
        const newUrl = params.toString()
          ? `${window.location.pathname}?${params.toString()}`
          : window.location.pathname;
        window.history.replaceState({}, "", newUrl);
        return true;
      }
    }
    return false;
  });
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const { data: databases, isLoading } = useQuery<DatabaseSummary[]>({
    queryKey: ["/api/databases"],
  });

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const { count } = await reloadDatabaseList();
      toast({
        title: "Databases refreshed",
        description: `${count} database${count !== 1 ? "s" : ""} loaded from disk`,
      });
    } catch (err) {
      toast({
        title: "Refresh failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <Database className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Databases</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshing}
            data-testid="button-refresh-databases-page"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-new-database">
            <Plus className="h-4 w-4 mr-1" />
            New Database
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !databases || databases.length === 0 ? (
        <div className="text-center py-20">
          <Database className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground">No databases configured yet.</p>
          <p className="text-xs text-muted-foreground mt-2">
            Click "New Database" to create your first one.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {databases.map((db) => (
            <Link key={db.name} href={`/private/databases/${db.name}`}>
              <Card className="hover-elevate cursor-pointer h-full" data-testid={`card-database-${db.name}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-primary flex-shrink-0" />
                    <CardTitle className="text-base truncate">{db.label}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {db.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{db.description}</p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-xs">
                      {db.source_type === "local" ? (
                        <Server className="h-3 w-3 mr-1" />
                      ) : db.source_type === "remote" ? (
                        <LinkIcon className="h-3 w-3 mr-1" />
                      ) : (
                        <Webhook className="h-3 w-3 mr-1" />
                      )}
                      {db.source_type}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {db.field_count} fields
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <CreateDatabaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(slug) => navigate(`/private/databases/${slug}`)}
      />
    </>
  );
}

function DatabaseConfigEditor({
  dbName,
  config,
  onSaved,
}: {
  dbName: string;
  config: DatabaseDetail["config"];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [sourceType, setSourceType] = useState<SourceType>(() => {
    const t = config.source.type;
    if (t === "local" || t === "remote") return t;
    return "api";
  });
  const [endpoint, setEndpoint] = useState(config.source.api?.endpoint || "");
  const [resultsPath, setResultsPath] = useState(
    config.source.api?.results_path ||
    config.source.local?.results_path ||
    config.source.remote?.results_path ||
    ""
  );
  const [tokenEnvVar, setTokenEnvVar] = useState(config.source.api?.auth?.token_env_var || "");
  const [authPrefix, setAuthPrefix] = useState(config.source.api?.auth?.prefix || "Bearer");
  const [ttlHours, setTtlHours] = useState(String(config.cache?.ttl_hours ?? 24));
  const [filterByLocale, setFilterByLocale] = useState(config.filter_by_locale !== false);
  const [params, setParams] = useState<KeyValuePair[]>(() => {
    const p = config.source.api?.params;
    if (!p || Object.keys(p).length === 0) return [];
    return Object.entries(p).map(([key, value]) => ({ key, value: String(value) }));
  });
  const [headers, setHeaders] = useState<KeyValuePair[]>(() => {
    const h = config.source.api?.headers;
    if (!h || Object.keys(h).length === 0) return [];
    return Object.entries(h).map(([key, value]) => ({ key, value }));
  });
  const [localFilename, setLocalFilename] = useState(config.source.local?.filename || "");
  const [localFileStatus, setLocalFileStatus] = useState<"idle" | "checking" | "found" | "not-found">("idle");
  const [remoteUrl, setRemoteUrl] = useState(config.source.remote?.url || "");
  const [datasetPickerOpen, setDatasetPickerOpen] = useState(false);

  useEffect(() => {
    if (sourceType !== "local" || !localFilename.trim()) {
      setLocalFileStatus("idle");
      return;
    }
    setLocalFileStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/databases/check-file?slug=${encodeURIComponent(dbName)}&filename=${encodeURIComponent(localFilename.trim())}`);
        const data = await res.json();
        setLocalFileStatus(data.exists ? "found" : "not-found");
      } catch {
        setLocalFileStatus("idle");
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [localFilename, dbName, sourceType]);

  const [testResult, setTestResult] = useState<{
    success: boolean;
    item_count?: number;
    samples?: unknown[];
    error?: string;
  } | null>(null);
  const [sampleOpen, setSampleOpen] = useState(false);
  const [sampleData, setSampleData] = useState<{ items: Record<string, unknown>[]; count: number } | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [showCurl, setShowCurl] = useState(false);
  const [curlCopied, setCurlCopied] = useState(false);
  const [webhookCopied, setWebhookCopied] = useState(false);

  const { data: webhookData } = useQuery<{ configured: boolean; url?: string }>({
    queryKey: ["/api/webhooks/clear-cache/url"],
    staleTime: 60_000,
  });

  const webhookFullUrl = webhookData?.configured && webhookData.url
    ? `${webhookData.url}&type=${encodeURIComponent(dbName)}`
    : null;

  const handleCopyWebhook = () => {
    if (!webhookFullUrl) return;
    navigator.clipboard.writeText(webhookFullUrl);
    setWebhookCopied(true);
    setTimeout(() => setWebhookCopied(false), 2000);
  };

  const curlCommand = (() => {
    if (sourceType !== "api" || !endpoint.trim()) return null;
    const filteredParams = params.filter((p) => p.key.trim());
    const filteredHeaders = headers.filter((h) => h.key.trim());
    let url = endpoint.trim();
    if (filteredParams.length > 0) {
      const qs = filteredParams.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join("&");
      url += (url.includes("?") ? "&" : "?") + qs;
    }
    const parts = [`curl -X GET "${url}"`];
    if (tokenEnvVar) {
      parts.push(`  -H "Authorization: ${authPrefix || "Bearer"} $\{${tokenEnvVar}\}"`);
    }
    for (const h of filteredHeaders) {
      parts.push(`  -H "${h.key}: ${h.value}"`);
    }
    return parts.join(" \\\n");
  })();

  const handleViewSample = async () => {
    setSampleOpen(true);
    if (sampleData) return;
    // If we just ran a test, use the live samples it already fetched — no cache read needed
    if (testResult?.success && testResult.samples && testResult.samples.length > 0) {
      setSampleData({
        items: testResult.samples as Record<string, unknown>[],
        count: testResult.item_count ?? testResult.samples.length,
      });
      return;
    }
    setSampleLoading(true);
    try {
      const res = await fetch(`/api/databases/${dbName}/raw-sample?limit=3`);
      const data = await res.json();
      setSampleData(data);
    } catch {
      toast({ title: "Failed to load sample data", variant: "destructive" });
    } finally {
      setSampleLoading(false);
    }
  };

  const handleRefreshSample = async () => {
    setSampleLoading(true);
    try {
      const res = await fetch(`/api/databases/${dbName}/raw-sample?limit=3`);
      const data = await res.json();
      setSampleData(data);
    } catch {
      toast({ title: "Failed to load sample data", variant: "destructive" });
    } finally {
      setSampleLoading(false);
    }
  };

  const canSave =
    sourceType === "api"
      ? endpoint.trim().length > 0
      : sourceType === "local"
      ? localFilename.trim().length > 0
      : remoteUrl.trim().length > 0;

  const isDirty = (() => {
    const origType = config.source.type === "local" || config.source.type === "remote" ? config.source.type : "api";
    if (sourceType !== origType) return true;
    const origResultsPath =
      config.source.api?.results_path ||
      config.source.local?.results_path ||
      config.source.remote?.results_path ||
      "";
    if (resultsPath !== origResultsPath) return true;
    if (String(config.cache?.ttl_hours ?? 24) !== ttlHours) return true;
    if (sourceType === "api") {
      if (endpoint !== (config.source.api?.endpoint || "")) return true;
      if (tokenEnvVar !== (config.source.api?.auth?.token_env_var || "")) return true;
      if (authPrefix !== (config.source.api?.auth?.prefix || "Bearer")) return true;
      const origParams = config.source.api?.params ?? {};
      const origParamPairs = Object.entries(origParams).map(([key, value]) => ({ key, value: String(value) }));
      const filteredParams = params.filter((p) => p.key.trim());
      if (JSON.stringify(filteredParams) !== JSON.stringify(origParamPairs)) return true;
      const origHeaders = config.source.api?.headers ?? {};
      const origHeaderPairs = Object.entries(origHeaders).map(([key, value]) => ({ key, value }));
      const filteredHeaders = headers.filter((h) => h.key.trim());
      if (JSON.stringify(filteredHeaders) !== JSON.stringify(origHeaderPairs)) return true;
    }
    if (sourceType === "local") {
      if (localFilename !== (config.source.local?.filename || "")) return true;
    }
    if (sourceType === "remote") {
      if (remoteUrl !== (config.source.remote?.url || "")) return true;
    }
    return false;
  })();

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const buildSourceConfig = () => {
    if (sourceType === "local") {
      return {
        type: "local",
        local: {
          filename: localFilename,
          ...(resultsPath ? { results_path: resultsPath } : {}),
        },
      };
    }
    if (sourceType === "remote") {
      return {
        type: "remote",
        remote: {
          url: remoteUrl,
          ...(resultsPath ? { results_path: resultsPath } : {}),
        },
      };
    }
    const source: Record<string, unknown> = { type: "api" };
    const api: Record<string, unknown> = { endpoint };
    if (resultsPath) api.results_path = resultsPath;
    if (tokenEnvVar) {
      api.auth = { token_env_var: tokenEnvVar, prefix: authPrefix || "Bearer" };
    }
    const filteredParams = params.filter((p) => p.key.trim());
    if (filteredParams.length > 0) {
      api.params = Object.fromEntries(filteredParams.map((p) => [p.key, p.value]));
    }
    const filteredHeaders = headers.filter((h) => h.key.trim());
    if (filteredHeaders.length > 0) {
      api.headers = Object.fromEntries(filteredHeaders.map((h) => [h.key, h.value]));
    }
    source.api = api;
    return source;
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setSampleData(null);
    try {
      const res = await fetch(`/api/databases/${dbName}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: buildSourceConfig() }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updatedConfig = {
        name: config.name,
        description: config.description || undefined,
        source: buildSourceConfig(),
        cache: { ttl_hours: ttlHours !== "" && Number.isFinite(Number(ttlHours)) ? Number(ttlHours) : 24 },
        field_mapping: config.field_mapping || undefined,
        ...(filterByLocale ? {} : { filter_by_locale: false }),
      };

      const res = await fetch(`/api/databases/${dbName}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedConfig),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save config");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/databases", dbName] });
      queryClient.invalidateQueries({ queryKey: ["/api/databases"] });
      toast({ title: "Configuration saved" });
      onSaved();
    } catch (err) {
      toast({
        title: "Error saving",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/databases/${dbName}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/databases"] });
      toast({ title: "Database deleted" });
      navigate("/private/databases");
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="edit-source-type">Source Type</Label>
          <Select value={sourceType} onValueChange={(v) => { setSourceType(v as SourceType); setResultsPath(""); }}>
            <SelectTrigger id="edit-source-type" data-testid="select-edit-source-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="api">
                <div className="flex items-center gap-2">
                  <Webhook className="h-4 w-4" />
                  API Endpoint
                </div>
              </SelectItem>
              <SelectItem value="local">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  Local File
                </div>
              </SelectItem>
              <SelectItem value="remote">
                <div className="flex items-center gap-2">
                  <LinkIcon className="h-4 w-4" />
                  Remote File
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="edit-ttl">Cache TTL (hours)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-pointer" />
              </PopoverTrigger>
              <PopoverContent side="right" className="w-64 text-xs p-3">
                The entire database will be re-fetched every <strong>{ttlHours || "24"} hour{Number(ttlHours) === 1 ? "" : "s"}</strong> to keep the data up to date. Set to <strong>0</strong> to disable automatic refresh.
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="edit-ttl"
              type="number"
              min="0"
              value={ttlHours}
              onChange={(e) => setTtlHours(e.target.value)}
              className="w-24"
              data-testid="input-edit-ttl"
            />
            {sourceType === "api" && webhookData && (
              webhookFullUrl ? (
                <div className="flex items-center gap-1.5 flex-1 min-w-0 rounded-md bg-muted/50 border px-2 py-1.5 text-xs">
                  <Webhook className="h-3 w-3 text-muted-foreground shrink-0" />
                  <input
                    readOnly
                    value={webhookFullUrl}
                    className="flex-1 font-mono bg-transparent outline-none text-foreground min-w-0 truncate cursor-text"
                    onFocus={(e) => e.target.select()}
                    data-testid="input-webhook-url-settings"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5 shrink-0"
                    onClick={handleCopyWebhook}
                    title={webhookCopied ? "Copied!" : "Copy webhook URL"}
                    data-testid="button-copy-webhook-settings"
                  >
                    {webhookCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">Webhook not configured</p>
              )
            )}
          </div>
        </div>
      </div>
      <div className="flex items-start gap-3 pt-1">
        <input
          id="edit-filter-by-locale"
          type="checkbox"
          checked={filterByLocale}
          onChange={(e) => setFilterByLocale(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
          data-testid="checkbox-filter-by-locale"
        />
        <div className="space-y-0.5">
          <Label htmlFor="edit-filter-by-locale" className="cursor-pointer">
            Filter by locale
          </Label>
          <p className="text-xs text-muted-foreground">
            When used as a section data source (<code>dynamic_entries</code>), only entries matching the current page&apos;s locale will be shown. Requires a <code>locale</code> field defined in the field mapping.
          </p>
        </div>
      </div>

      {sourceType === "api" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="edit-endpoint">Endpoint URL</Label>
            <Input
              id="edit-endpoint"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              data-testid="input-edit-endpoint"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-results-path">Results Path (optional)</Label>
            <Input
              id="edit-results-path"
              placeholder="e.g. results, data.items"
              value={resultsPath}
              onChange={(e) => setResultsPath(e.target.value)}
              data-testid="input-edit-results-path"
            />
            <p className="text-xs text-muted-foreground">
              Dot-notation path to the array in the API response. Leave empty if the response is already an array.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Authentication</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="ENV var name"
                value={tokenEnvVar}
                onChange={(e) => setTokenEnvVar(e.target.value)}
                data-testid="input-edit-token-env"
              />
              <Input
                placeholder="Prefix (Bearer, Token...)"
                value={authPrefix}
                onChange={(e) => setAuthPrefix(e.target.value)}
                data-testid="input-edit-auth-prefix"
              />
            </div>
          </div>
          <KeyValueEditor
            label="Query Parameters"
            addLabel="Add parameter"
            pairs={params}
            onChange={setParams}
            keyPlaceholder="param name"
            valuePlaceholder="value"
            testIdPrefix="edit-param"
          />
          <KeyValueEditor
            label="Headers"
            addLabel="Add header"
            pairs={headers}
            onChange={setHeaders}
            keyPlaceholder="header name"
            valuePlaceholder="value"
            testIdPrefix="edit-header"
          />
        </>
      )}

      {sourceType === "local" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="edit-local-filename">Filename</Label>
            <div className="relative">
              <Input
                id="edit-local-filename"
                placeholder="e.g. products.json, data.csv"
                value={localFilename}
                onChange={(e) => setLocalFilename(e.target.value)}
                data-testid="input-edit-local-filename"
                className="pr-8"
              />
              {localFileStatus === "checking" && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {localFileStatus === "found" && (
                <Check className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
              )}
              {localFileStatus === "not-found" && (
                <X className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive" />
              )}
            </div>
            <div className="rounded-md bg-muted/50 border px-3 py-2 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Where to place the file</p>
              <p>
                Put your file at{" "}
                <code className="bg-muted px-1 rounded">
                  4geeks-com/db/{dbName}/{localFilename || "your-file.json"}
                </code>{" "}
                before syncing.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-local-results-path">Results Path (optional)</Label>
            <Input
              id="edit-local-results-path"
              placeholder="e.g. results, data.items"
              value={resultsPath}
              onChange={(e) => setResultsPath(e.target.value)}
              data-testid="input-edit-local-results-path"
            />
            <p className="text-xs text-muted-foreground">
              For JSON files: dot-notation path to the array. Leave empty if the file is already an array.
            </p>
          </div>
        </>
      )}

      {sourceType === "remote" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="edit-remote-url">Remote URL</Label>
            <div className="flex gap-2">
              <Input
                id="edit-remote-url"
                placeholder="https://example.com/data.json"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                data-testid="input-edit-remote-url"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDatasetPickerOpen(true)}
                data-testid="button-edit-pick-file-remote"
              >
                <File className="h-4 w-4 mr-1.5" />
                Pick File
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-remote-results-path">Results Path (optional)</Label>
            <Input
              id="edit-remote-results-path"
              placeholder="e.g. results, data.items"
              value={resultsPath}
              onChange={(e) => setResultsPath(e.target.value)}
              data-testid="input-edit-remote-results-path"
            />
            <p className="text-xs text-muted-foreground">
              Dot-notation path to the array. Leave empty if the response is already an array.
            </p>
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testing || !canSave}
            data-testid="button-test-config"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <TestTube className="h-3.5 w-3.5 mr-1" />
            )}
            Test Connection
          </Button>
          {testResult && (
            testResult.success ? (
              <button
                type="button"
                onClick={handleViewSample}
                data-testid="badge-test-result-success"
                className="inline-flex items-center"
              >
                <Badge variant="secondary" className="cursor-pointer">
                  <Check className="h-3 w-3 mr-1" />
                  {testResult.item_count} items found
                </Badge>
              </button>
            ) : (
              <Badge variant="destructive">
                <X className="h-3 w-3 mr-1" />
                Failed
              </Badge>
            )
          )}
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="text-unsaved-changes">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              Unsaved changes
            </span>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            data-testid="button-delete-database"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !canSave}
            data-testid="button-save-config"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>

      {testResult?.error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 text-xs text-destructive">
          {testResult.error}
        </div>
      )}

      <DatasetPickerDialog
        open={datasetPickerOpen}
        onOpenChange={setDatasetPickerOpen}
        slug={dbName}
        onSelected={(result) => {
          setLocalFilename(result.filename);
          setSourceType("local");
        }}
      />

      <Dialog open={sampleOpen} onOpenChange={(v) => { setSampleOpen(v); if (!v) setShowCurl(false); }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-2 pr-8">
              <div>
                <DialogTitle>Raw API Sample Data</DialogTitle>
                <DialogDescription className="mt-1 space-y-0.5">
                  <span className="block">{sampleData ? `Showing ${sampleData.items.length} of ${sampleData.count} total raw items` : "Loading sample data..."}</span>
                  {sampleData && testResult?.success && testResult.samples && sampleData.items === (testResult.samples as Record<string, unknown>[]) ? (
                    <span className="block text-[11px] text-muted-foreground/70">Live data from the test connection — not from cache.</span>
                  ) : (
                    <span className="block text-[11px] text-muted-foreground/70">Reflects the last cached fetch. If you recently changed query params, save and Force Refresh first.</span>
                  )}
                </DialogDescription>
              </div>
              <div className="flex items-center gap-1">
                {curlCommand && (
                  <Button
                    size="icon"
                    variant={showCurl ? "secondary" : "ghost"}
                    onClick={() => setShowCurl((v) => !v)}
                    data-testid="button-toggle-curl"
                    title={showCurl ? "Hide curl command" : "Show curl command"}
                  >
                    <Code className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleRefreshSample}
                  disabled={sampleLoading}
                  data-testid="button-refresh-sample-config"
                  title="Refresh sample data"
                >
                  {sampleLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </DialogHeader>
          {showCurl && curlCommand && (
            <div className="border rounded-md overflow-hidden flex-shrink-0">
              <div className="px-3 py-1.5 bg-muted text-xs font-medium text-muted-foreground border-b flex items-center justify-between">
                <span>curl</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5"
                  title={curlCopied ? "Copied!" : "Copy to clipboard"}
                  data-testid="button-copy-curl"
                  onClick={() => {
                    navigator.clipboard.writeText(curlCommand);
                    setCurlCopied(true);
                    setTimeout(() => setCurlCopied(false), 2000);
                  }}
                >
                  {curlCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
              <pre className="px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all bg-background text-foreground overflow-x-auto">
                {curlCommand}
              </pre>
            </div>
          )}
          <div className="flex-1 overflow-auto">
            {sampleLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : sampleData && sampleData.items.length > 0 ? (
              <div className="space-y-3">
                {sampleData.items.map((item, idx) => (
                  <div key={idx} className="border rounded-md overflow-hidden">
                    <div className="px-3 py-1.5 bg-muted text-xs font-medium text-muted-foreground border-b">
                      Item {idx + 1}
                    </div>
                    <JsonViewer value={JSON.stringify(item, null, 2)} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No raw data available. Save your config and fetch data first.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Database</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{config.name}"? This will remove the configuration and cached data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              data-testid="button-confirm-delete"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FieldMappingEditor({
  dbName,
  config,
  onSaved,
}: {
  dbName: string;
  config: DatabaseDetail["config"];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiNotes, setAiNotes] = useState<string | null>(null);
  const [newFieldKey, setNewFieldKey] = useState("");
  const [sampleOpen, setSampleOpen] = useState(false);
  const [sampleData, setSampleData] = useState<{ items: Record<string, unknown>[]; count: number } | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);

  type EditorHint = { type?: string; options?: (string | { value: string; label: string })[]; populate_options?: boolean; allow_custom_values?: boolean; split_comma_values?: boolean; cache_images?: boolean; description?: string; schema?: Record<string, unknown> };

  const normalizeEditorHints = (editor: Record<string, EditorHint> | undefined): Record<string, EditorHint> => {
    if (!editor) return {};
    const out: Record<string, EditorHint> = {};
    for (const [key, hint] of Object.entries(editor)) {
      out[key] =
        hint?.cache_images === true && hint.type !== "image"
          ? { ...hint, type: "image" }
          : { ...hint };
    }
    return out;
  };

  const [editorHints, setEditorHints] = useState<Record<string, EditorHint>>(() =>
    normalizeEditorHints(config.editor)
  );
  useEffect(() => {
    setEditorHints(normalizeEditorHints(config.editor));
  }, [config.editor]);

  const [vectorSearchFields, setVectorSearchFields] = useState<string[]>(config.vector_search?.fields ?? []);
  useEffect(() => {
    setVectorSearchFields(config.vector_search?.fields ?? []);
  }, [config.vector_search]);

  const [keywordSearchFields, setKeywordSearchFields] = useState<string[]>((config as any).search_fields ?? []);
  useEffect(() => {
    setKeywordSearchFields((config as any).search_fields ?? []);
  }, [(config as any).search_fields]);

  const [imageCacheModalField, setImageCacheModalField] = useState<string | null>(null);
  const [vectorSearchModalField, setVectorSearchModalField] = useState<string | null>(null);

  const [hintDialogField, setHintDialogField] = useState<string | null>(null);

  const { data: hintPreviewData, isLoading: hintPreviewLoading } = useQuery<{
    items: Record<string, unknown>[];
  }>({
    queryKey: [`/api/databases/${dbName}/items`, "hint-preview"],
    queryFn: () =>
      fetch(`/api/databases/${dbName}/items?page=1&limit=100`).then((r) => r.json()),
    enabled: hintDialogField !== null,
    staleTime: 60_000,
  });

  const openHintDialog = (field: string) => {
    setHintDialogField(field);
  };

  const handleViewSample = async () => {
    setSampleOpen(true);
    if (sampleData) return;
    setSampleLoading(true);
    try {
      const res = await fetch(`/api/databases/${dbName}/raw-sample?limit=3`);
      const data = await res.json();
      setSampleData(data);
    } catch {
      toast({ title: "Failed to load sample data", variant: "destructive" });
    } finally {
      setSampleLoading(false);
    }
  };

  const handleRefreshSample = async () => {
    setSampleLoading(true);
    try {
      const res = await fetch(`/api/databases/${dbName}/raw-sample?limit=3`);
      const data = await res.json();
      setSampleData(data);
    } catch {
      toast({ title: "Failed to load sample data", variant: "destructive" });
    } finally {
      setSampleLoading(false);
    }
  };

  const [fieldMappingEntries, setFieldMappingEntries] = useState<Record<string, string | null>>(() => {
    const fm = config.field_mapping;
    if (!fm || Object.keys(fm).length === 0) return {};
    return { ...fm };
  });

  useEffect(() => {
    const fm = config.field_mapping;
    setFieldMappingEntries(!fm || Object.keys(fm).length === 0 ? {} : { ...fm });
  }, [config.field_mapping]);

  const { data: rawFieldsData } = useQuery<{ fields: string[] }>({
    queryKey: [`/api/databases/${dbName}/raw-fields`],
  });
  const rawFields = rawFieldsData?.fields || [];

  const handleAnalyzeFields = async () => {
    setAiAnalyzing(true);
    setAiNotes(null);
    try {
      const res = await fetch(`/api/databases/${dbName}/analyze-fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.error) {
        toast({ title: "AI analysis failed", description: data.error, variant: "destructive" });
        return;
      }
      if (data.field_mapping) {
        setFieldMappingEntries(data.field_mapping);
      }
      if (data.notes) {
        setAiNotes(data.notes);
      }
      toast({ title: "AI field mapping generated", description: `${Object.keys(data.field_mapping || {}).length} fields mapped` });
    } catch (err) {
      toast({ title: "AI analysis failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setAiAnalyzing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const fieldMapping: Record<string, string> = {};
      for (const [key, value] of Object.entries(fieldMappingEntries)) {
        if (key.trim() && value != null) {
          fieldMapping[key] = value;
        }
      }

      const updatedConfig = {
        ...config,
        field_mapping: Object.keys(fieldMapping).length > 0 ? fieldMapping : undefined,
        editor: Object.keys(editorHints).length > 0 ? editorHints : undefined,
        vector_search: vectorSearchFields.length > 0
          ? { enabled: true, fields: vectorSearchFields }
          : undefined,
        search_fields: keywordSearchFields.length > 0 ? keywordSearchFields : undefined,
      };

      const res = await fetch(`/api/databases/${dbName}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedConfig),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save mappings");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/databases", dbName] });
      queryClient.invalidateQueries({ queryKey: ["/api/databases"] });
      toast({ title: "Field mapping saved" });
      onSaved();
    } catch (err) {
      toast({
        title: "Error saving",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={handleViewSample}
          disabled={rawFields.length === 0}
          data-testid="button-view-sample-data"
        >
          <Eye className="h-3.5 w-3.5 mr-1" />
          Sample Data
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAnalyzeFields}
          disabled={aiAnalyzing || rawFields.length === 0}
          data-testid="button-ai-analyze-fields"
        >
          {aiAnalyzing ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Wand2 className="h-3.5 w-3.5 mr-1" />
          )}
          {aiAnalyzing ? "Analyzing..." : "Auto-detect"}
        </Button>
      </div>

      {aiNotes && (
        <p className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2" data-testid="text-ai-notes">
          {aiNotes}
        </p>
      )}

      {Object.keys(fieldMappingEntries).length > 0 && (
        <div className="space-y-2">
          {Object.entries(fieldMappingEntries).map(([normalizedKey, sourcePath]) => {
            const isFunction = sourcePath != null && sourcePath.startsWith("function:");
            const isCustom = !isFunction && sourcePath != null && !rawFields.includes(sourcePath);
            const selectValue = isFunction ? "__function__" : isCustom ? "__custom__" : (sourcePath || "__none__");
            const decodedFn = isFunction ? (() => { try { return atob(sourcePath.slice("function:".length)); } catch { return sourcePath; } })() : "";
            return (
              <div key={normalizedKey} className="space-y-1">
                <div className="flex items-center gap-2">
                  <code className="text-xs font-medium w-28 flex-shrink-0 text-right text-muted-foreground truncate" title={normalizedKey}>
                    {normalizedKey}
                  </code>
                  <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  {isFunction ? (
                    <div className="flex-1 space-y-1">
                      <p className="text-[10px] text-muted-foreground font-mono">(value, item) =&gt; ...</p>
                      <Textarea
                        value={decodedFn}
                        onChange={(e) => {
                          const encoded = "function:" + btoa(e.target.value);
                          setFieldMappingEntries((prev) => ({ ...prev, [normalizedKey]: encoded }));
                        }}
                        placeholder="(value, item) => value"
                        className="text-xs font-mono min-h-[3rem] resize-y"
                        data-testid={`textarea-transform-${normalizedKey}`}
                      />
                    </div>
                  ) : isCustom ? (
                    <>
                      <Input
                        value={sourcePath || ""}
                        onChange={(e) => setFieldMappingEntries((prev) => ({ ...prev, [normalizedKey]: e.target.value }))}
                        placeholder="e.g. author.details.name"
                        className="h-8 text-xs font-mono flex-1"
                        data-testid={`input-custom-path-${normalizedKey}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setFieldMappingEntries((prev) => ({ ...prev, [normalizedKey]: null }))}
                        data-testid={`button-clear-custom-${normalizedKey}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <Select
                      value={selectValue}
                      onValueChange={(v) => {
                        if (v === "__function__") {
                          setFieldMappingEntries((prev) => ({ ...prev, [normalizedKey]: "function:" + btoa("(value, item) => value") }));
                        } else if (v === "__custom__") {
                          setFieldMappingEntries((prev) => ({ ...prev, [normalizedKey]: "" }));
                        } else {
                          setFieldMappingEntries((prev) => ({ ...prev, [normalizedKey]: v === "__none__" ? null : v }));
                        }
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs font-mono flex-1" data-testid={`select-field-${normalizedKey}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">(not mapped)</SelectItem>
                        {rawFields.map((f) => (
                          <SelectItem key={f} value={f}>{f}</SelectItem>
                        ))}
                        <SelectItem value="__custom__">Custom path...</SelectItem>
                        <SelectItem value="__function__">Compute with function...</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setFieldMappingEntries((prev) => {
                        const next = { ...prev };
                        delete next[normalizedKey];
                        return next;
                      });
                    }}
                    data-testid={`button-delete-field-${normalizedKey}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openHintDialog(normalizedKey)}
                    title="Configure editor type"
                    data-testid={`button-hint-field-${normalizedKey}`}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setImageCacheModalField(normalizedKey)}
                    title={editorHints[normalizedKey]?.cache_images ? "Image caching enabled" : "Configure image caching"}
                    data-testid={`button-cache-images-${normalizedKey}`}
                  >
                    <Image className={`h-3.5 w-3.5 ${editorHints[normalizedKey]?.cache_images ? "text-blue-500" : "text-muted-foreground"}`} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setVectorSearchModalField(normalizedKey)}
                    title={
                      vectorSearchFields.includes(normalizedKey) && keywordSearchFields.includes(normalizedKey)
                        ? "Semantic + keyword search configured"
                        : vectorSearchFields.includes(normalizedKey)
                          ? "Included in semantic search"
                          : keywordSearchFields.includes(normalizedKey)
                            ? "Included in keyword search"
                            : "Configure search settings"
                    }
                    data-testid={`button-vector-search-${normalizedKey}`}
                  >
                    <Sparkles className={`h-3.5 w-3.5 ${vectorSearchFields.includes(normalizedKey) ? "text-orange-500 drop-shadow-[0_0_4px_rgba(249,115,22,0.8)]" : keywordSearchFields.includes(normalizedKey) ? "text-primary" : "text-muted-foreground"}`} />
                  </Button>
                </div>
                {((editorHints[normalizedKey]?.type && editorHints[normalizedKey].type !== "text") || editorHints[normalizedKey]?.cache_images || vectorSearchFields.includes(normalizedKey) || keywordSearchFields.includes(normalizedKey)) ? (
                  <p className="text-[10px] text-muted-foreground ml-[6.5rem] flex items-center gap-2">
                    {editorHints[normalizedKey]?.type && editorHints[normalizedKey].type !== "text" && (
                      <span>editor: <code>{editorHints[normalizedKey].type}</code>{editorHints[normalizedKey].options?.length ? ` (${editorHints[normalizedKey].options!.length} options)` : ""}</span>
                    )}
                    {editorHints[normalizedKey]?.cache_images && (
                      <span className="text-blue-500">cached</span>
                    )}
                    {keywordSearchFields.includes(normalizedKey) && (
                      <span className="text-foreground">keyword</span>
                    )}
                    {vectorSearchFields.includes(normalizedKey) && (
                      <span className="text-orange-500">semantic</span>
                    )}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={newFieldKey}
          onChange={(e) => setNewFieldKey(e.target.value)}
          placeholder="Add field (e.g. author_name)"
          className="h-8 text-xs font-mono flex-1"
          data-testid="input-new-field-key"
          onKeyDown={(e) => {
            if (e.key === "Enter" && newFieldKey.trim()) {
              setFieldMappingEntries((prev) => ({ ...prev, [newFieldKey.trim()]: null }));
              setNewFieldKey("");
            }
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!newFieldKey.trim()}
          onClick={() => {
            setFieldMappingEntries((prev) => ({ ...prev, [newFieldKey.trim()]: null }));
            setNewFieldKey("");
          }}
          data-testid="button-add-field"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>

      {rawFields.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No raw field data available. Fetch data first to populate source field dropdowns.
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t flex-wrap">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          data-testid="button-save-mappings"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5 mr-1" />
          )}
          Save Mappings
        </Button>
      </div>

      <Dialog open={sampleOpen} onOpenChange={setSampleOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-2 pr-8">
              <div>
                <DialogTitle>Raw API Sample Data</DialogTitle>
                <DialogDescription className="mt-1">
                  {sampleData ? `Showing ${sampleData.items.length} of ${sampleData.count} total raw items` : "Loading sample data..."}
                </DialogDescription>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleRefreshSample}
                disabled={sampleLoading}
                data-testid="button-refresh-sample"
                title="Refresh sample data"
              >
                {sampleLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {sampleLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : sampleData && sampleData.items.length > 0 ? (
              <div className="space-y-3">
                {sampleData.items.map((item, idx) => (
                  <div key={idx} className="border rounded-md overflow-hidden">
                    <div className="px-3 py-1.5 bg-muted text-xs font-medium text-muted-foreground border-b">
                      Item {idx + 1}
                    </div>
                    <JsonViewer
                      value={JSON.stringify(item, null, 2)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-sample-data">
                No raw data available. Fetch data first.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <EditorTypeDialog
        open={hintDialogField !== null}
        fieldName={hintDialogField}
        initialHint={hintDialogField ? editorHints[hintDialogField] : undefined}
        lockImageType={
          !!(hintDialogField && editorHints[hintDialogField]?.cache_images)
        }
        existingItems={hintPreviewData?.items}
        existingItemsLoading={hintPreviewLoading}
        onClose={() => setHintDialogField(null)}
        onApply={(hint) => {
          const field = hintDialogField;
          if (!field) return;
          setEditorHints((prev) => {
            const existing = prev[field] || {};
            return {
              ...prev,
              [field]: {
                ...hint,
                cache_images: existing.cache_images,
              },
            };
          });
          setHintDialogField(null);
        }}
      />

      <Dialog open={imageCacheModalField !== null} onOpenChange={(v) => { if (!v) setImageCacheModalField(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Image className="h-4 w-4 text-blue-500" />
              Image Caching
            </DialogTitle>
            <DialogDescription className="pt-1">
              for <code className="font-mono text-xs bg-muted px-1 rounded">{imageCacheModalField}</code>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              When enabled, any image URLs found in this field are automatically downloaded and re-hosted on the local media server. This prevents broken images if the original source changes or goes offline, and improves page load performance.
            </p>
            <p className="text-xs text-muted-foreground">
              Caching runs in the background after each data fetch. Original URLs are preserved in the raw data. Enabling caching also switches this field to the image editor (preview + URL + cache status) and locks the editor type.
            </p>
            <label className="flex items-center gap-3 cursor-pointer pt-1" data-testid="label-cache-images-toggle">
              <Switch
                checked={imageCacheModalField ? (editorHints[imageCacheModalField]?.cache_images ?? false) : false}
                onCheckedChange={(checked) => {
                  if (!imageCacheModalField) return;
                  setEditorHints((prev) => {
                    const current = prev[imageCacheModalField] || {};
                    if (checked) {
                      return {
                        ...prev,
                        [imageCacheModalField]: { ...current, cache_images: true, type: "image" },
                      };
                    }
                    return {
                      ...prev,
                      [imageCacheModalField]: { ...current, cache_images: false },
                    };
                  });
                }}
                data-testid="switch-cache-images"
              />
              <span className="text-sm">
                {imageCacheModalField && editorHints[imageCacheModalField]?.cache_images
                  ? "Image caching enabled"
                  : "Image caching disabled"}
              </span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditorHints((prev) => {
                  if (!imageCacheModalField) return prev;
                  const originalHint = config.editor?.[imageCacheModalField];
                  if (originalHint) {
                    return {
                      ...prev,
                      [imageCacheModalField]: normalizeEditorHints({
                        [imageCacheModalField]: originalHint,
                      })[imageCacheModalField],
                    };
                  }
                  const current = { ...(prev[imageCacheModalField] || {}) };
                  delete current.cache_images;
                  return { ...prev, [imageCacheModalField]: current };
                });
                setImageCacheModalField(null);
              }}
              data-testid="button-cancel-cache-modal"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving}
              onClick={async () => {
                setImageCacheModalField(null);
                await handleSave();
              }}
              data-testid="button-save-cache-modal"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={vectorSearchModalField !== null} onOpenChange={(v) => { if (!v) setVectorSearchModalField(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Search Settings
            </DialogTitle>
            <DialogDescription className="pt-1">
              for <code className="font-mono text-xs bg-muted px-1 rounded">{vectorSearchModalField}</code>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer" data-testid="label-keyword-search-field-toggle">
                <Switch
                  checked={vectorSearchModalField ? keywordSearchFields.includes(vectorSearchModalField) : false}
                  onCheckedChange={(checked) => {
                    if (!vectorSearchModalField) return;
                    setKeywordSearchFields((prev) =>
                      checked
                        ? prev.includes(vectorSearchModalField) ? prev : [...prev, vectorSearchModalField]
                        : prev.filter((f) => f !== vectorSearchModalField)
                    );
                  }}
                  data-testid="switch-keyword-search-field"
                />
                <div>
                  <p className="text-sm font-medium">Keyword search</p>
                  <p className="text-xs text-muted-foreground">Include in text-based search across this database.</p>
                </div>
              </label>
            </div>
            <div className="border-t pt-4 space-y-2">
              <label className="flex items-center gap-3 cursor-pointer" data-testid="label-vector-search-field-toggle">
                <Switch
                  checked={vectorSearchModalField ? vectorSearchFields.includes(vectorSearchModalField) : false}
                  onCheckedChange={(checked) => {
                    if (!vectorSearchModalField) return;
                    setVectorSearchFields((prev) =>
                      checked
                        ? prev.includes(vectorSearchModalField) ? prev : [...prev, vectorSearchModalField]
                        : prev.filter((f) => f !== vectorSearchModalField)
                    );
                  }}
                  data-testid="switch-vector-search-field"
                />
                <div>
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-orange-500" />
                    Semantic search
                  </p>
                  <p className="text-xs text-muted-foreground">Embed this field into the AI vector index for meaning-based search. Best for free-form text — avoid IDs or short codes.</p>
                </div>
              </label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (vectorSearchModalField) {
                  setVectorSearchFields(config.vector_search?.fields ?? []);
                  setKeywordSearchFields((config as any).search_fields ?? []);
                }
                setVectorSearchModalField(null);
              }}
              data-testid="button-cancel-vector-modal"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving}
              onClick={async () => {
                setVectorSearchModalField(null);
                await handleSave();
              }}
              data-testid="button-save-vector-modal"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function _DeprecatedItemEditModal({
  dbName,
  config,
  item,
  itemIndex,
  isNew,
  allItems,
  onClose,
  onSaved,
}: {
  dbName: string;
  config: DatabaseDetail["config"];
  item: Record<string, unknown> | null;
  itemIndex: number | null;
  isNew: boolean;
  allItems?: Record<string, unknown>[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState<Record<string, string>>({});
  const [expandedTagFields, setExpandedTagFields] = useState<Record<string, boolean>>({});

  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    if (isNew) {
      const defaults: Record<string, unknown> = {};
      if (config.field_mapping) {
        for (const key of Object.keys(config.field_mapping)) {
          const editorType = config.editor?.[key]?.type;
          defaults[key] = editorType === "tags" ? [] : editorType === "boolean" ? false : "";
        }
      }
      return defaults;
    }
    return item ? { ...item } : {};
  });

  const fields = config.field_mapping ? Object.keys(config.field_mapping) : [];

  const setValue = (key: string, v: unknown) =>
    setFormData((prev) => ({ ...prev, [key]: v }));

  const buildItem = (omitEmpty: boolean): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of fields) {
      const value = formData[key];
      const editorType = config.editor?.[key]?.type;
      if (editorType === "boolean") {
        out[key] = Boolean(value);
      } else if (editorType === "tags") {
        const arr = Array.isArray(value) ? value : [];
        if (arr.length > 0) {
          out[key] = arr;
        } else if (!omitEmpty) {
          out[key] = [];
        }
      } else if (editorType === "number") {
        if (value !== "" && value !== null && value !== undefined) {
          const n = Number(value);
          out[key] = isNaN(n) ? value : n;
        } else if (!omitEmpty) {
          out[key] = null;
        }
      } else {
        if (value !== "" && value !== null && value !== undefined) {
          out[key] = value;
        } else if (!omitEmpty) {
          out[key] = "";
        }
      }
    }
    return out;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let res: Response;
      if (isNew) {
        const payload = buildItem(true);
        res = await fetch(`/api/databases/${dbName}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item: payload }),
        });
      } else {
        const payload = buildItem(false);
        res = await fetch(`/api/databases/${dbName}/items/${itemIndex}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save item");
      }

      onSaved();
      onClose();
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const renderField = (key: string) => {
    const editorConfig = config.editor?.[key];
    const type = editorConfig?.type || "text";
    const manualOptions = editorConfig?.options || [];
    const dataOptions: string[] = editorConfig?.populate_options
      ? Array.from(
          new Set(
            (allItems ?? [])
              .flatMap((it) => {
                const v = it[key];
                if (type === "tags" && typeof v === "string") {
                  return v.split(",").map((t: string) => t.trim()).filter(Boolean);
                }
                return Array.isArray(v) ? v : [v];
              })
              .filter((v): v is string => typeof v === "string" && v.trim() !== "")
          )
        ).sort()
      : [];
    const options = Array.from(new Set([...manualOptions, ...dataOptions]));
    const value = formData[key];

    switch (type) {
      case "textarea":
        return (
          <Textarea
            value={String(value ?? "")}
            onChange={(e) => setValue(key, e.target.value)}
            className="text-sm min-h-[6rem] resize-y"
            data-testid={`input-edit-${key}`}
          />
        );
      case "boolean":
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={Boolean(value)}
              onCheckedChange={(v) => setValue(key, v)}
              data-testid={`switch-edit-${key}`}
            />
            <span className="text-sm text-muted-foreground">
              {Boolean(value) ? "Yes" : "No"}
            </span>
          </div>
        );
      case "number":
        return (
          <Input
            type="number"
            value={String(value ?? "")}
            onChange={(e) => setValue(key, e.target.value)}
            className="text-sm"
            data-testid={`input-edit-${key}`}
          />
        );
      case "select":
        return (
          <Select
            value={String(value ?? "")}
            onValueChange={(v) => setValue(key, v)}
          >
            <SelectTrigger className="text-sm" data-testid={`select-edit-${key}`}>
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt} value={String(opt)}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "tags": {
        const tags = Array.isArray(value)
          ? (value as string[])
          : typeof value === "string" && value.trim()
          ? value.split(",").map((t) => t.trim()).filter(Boolean)
          : [];
        const inputVal = tagInput[key] || "";
        const addTag = () => {
          const trimmed = inputVal.trim();
          if (!trimmed) return;
          if (!tags.includes(trimmed)) setValue(key, [...tags, trimmed]);
          setTagInput((prev) => ({ ...prev, [key]: "" }));
        };
        if (options.length > 0) {
          const COLLAPSE_THRESHOLD = 8;
          const isExpanded = !!expandedTagFields[key];
          const visibleOptions = isExpanded ? options : options.slice(0, COLLAPSE_THRESHOLD);
          const customTags = tags.filter((t) => !options.includes(t));
          const toggle = (opt: string) => {
            if (tags.includes(opt)) {
              setValue(key, tags.filter((t) => t !== opt));
            } else {
              setValue(key, [...tags, opt]);
            }
          };
          return (
            <div className="space-y-2" data-testid={`tags-${key}`}>
              <div className="flex flex-wrap gap-1.5">
                {visibleOptions.map((opt) => {
                  const selected = tags.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggle(opt)}
                      data-testid={`button-tag-${key}-${opt}`}
                      className="inline-flex"
                    >
                      <Badge
                        variant={selected ? "default" : "outline"}
                        className={selected ? "" : "text-muted-foreground"}
                      >
                        {selected && <Check className="h-3 w-3 mr-1" />}
                        {opt}
                      </Badge>
                    </button>
                  );
                })}
                {options.length > COLLAPSE_THRESHOLD && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedTagFields((prev) => ({ ...prev, [key]: !prev[key] }))
                    }
                    data-testid={`button-tag-expand-${key}`}
                    className="inline-flex"
                  >
                    <Badge variant="outline" className="text-muted-foreground">
                      {isExpanded ? "Show less" : `Show all (${options.length})`}
                    </Badge>
                  </button>
                )}
              </div>
              {customTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {customTags.map((tag, ti) => (
                    <Badge key={ti} variant="secondary" className="gap-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => setValue(key, tags.filter((t) => t !== tag))}
                        data-testid={`button-remove-custom-tag-${key}-${ti}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              {editorConfig?.populate_options && (
                <div className="flex gap-2">
                  <Input
                    value={inputVal}
                    onChange={(e) =>
                      setTagInput((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder="Add new tag..."
                    className="h-8 text-sm flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    data-testid={`input-tag-${key}`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!inputVal.trim()}
                    onClick={addTag}
                    data-testid={`button-add-tag-${key}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          );
        }
        return (
          <div className="space-y-2">
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag, ti) => (
                  <Badge key={ti} variant="secondary" className="gap-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => setValue(key, tags.filter((_, i) => i !== ti))}
                      data-testid={`button-remove-tag-${key}-${ti}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={inputVal}
                onChange={(e) =>
                  setTagInput((prev) => ({ ...prev, [key]: e.target.value }))
                }
                placeholder="Add tag..."
                className="h-8 text-sm flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                data-testid={`input-tag-${key}`}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!inputVal.trim()}
                onClick={addTag}
                data-testid={`button-add-tag-${key}`}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        );
      }
      default:
        return (
          <Input
            value={String(value ?? "")}
            onChange={(e) => setValue(key, e.target.value)}
            className="text-sm"
            data-testid={`input-edit-${key}`}
          />
        );
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add Item" : "Edit Item"}</DialogTitle>
          <DialogDescription>
            {isNew
              ? "Fill in the fields to create a new entry."
              : `Editing item ${itemIndex !== null ? itemIndex + 1 : ""}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1 min-h-0">
          {fields.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
              <p className="text-sm font-medium">No fields configured</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Go to database settings → Field Mappings to add fields before editing items.
              </p>
            </div>
          ) : (
            fields.map((key) => (
              <div key={key} className="space-y-1.5">
                <Label className="text-xs font-medium capitalize">
                  {key.replace(/_/g, " ")}
                </Label>
                {renderField(key)}
              </div>
            ))
          )}
        </div>
        <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t mt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={saving}
            data-testid="button-cancel-edit-item"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || fields.length === 0}
            data-testid="button-save-edit-item"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CachedImagesKpiCard({ dbName }: { dbName: string }) {
  const { toast } = useToast();
  const [failedOpen, setFailedOpen] = useState(false);
  const [confirmRefreshOpen, setConfirmRefreshOpen] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery<{ cached: number; failed: number }>({
    queryKey: ["/api/image-registry/stats", dbName],
    queryFn: () =>
      fetch(`/api/image-registry/stats?tag=${encodeURIComponent(dbName)}`).then((r) => r.json()),
  });

  const { data: failedData, isLoading: failedLoading, refetch: refetchFailed } = useQuery<{
    entries: { id: string; source_url: string; failed_at: string; source_item?: string }[];
  }>({
    queryKey: ["/api/image-registry/failed", dbName],
    queryFn: () =>
      fetch(`/api/image-registry/failed?tag=${encodeURIComponent(dbName)}`).then((r) => r.json()),
    enabled: failedOpen,
  });

  const retryMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/image-registry/retry-failed", { tag: dbName }).then((r) => r.json()),
    onSuccess: (result: { retried: number }) => {
      toast({ title: "Retry queued", description: `${result.retried} image(s) re-queued for caching` });
      setFailedOpen(false);
      refetch();
    },
    onError: () => {
      toast({ title: "Retry failed", variant: "destructive" });
    },
  });

  return (
    <>
      <Card>
        <CardContent className="pt-4 pb-3 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Image className="h-3.5 w-3.5" />
              <span>Cached Images</span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setConfirmRefreshOpen(true)}
              disabled={isFetching}
              data-testid="button-refresh-cached-stats"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <p className="text-sm font-medium" data-testid="text-cached-images-count">
            {isLoading ? "..." : (data?.cached ?? "\u2014")}
          </p>
          {!isLoading && data && data.failed > 0 && (
            <button
              className="text-xs text-red-500 hover:underline cursor-pointer text-left"
              onClick={() => setFailedOpen(true)}
              data-testid="button-show-failed-images"
            >
              {data.failed} failed
            </button>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmRefreshOpen} onOpenChange={setConfirmRefreshOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Refresh image cache stats?</DialogTitle>
            <DialogDescription>
              This will re-query the image registry to get the latest count of cached and failed images for <strong>{dbName}</strong>. No images will be downloaded or re-processed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmRefreshOpen(false)}
              data-testid="button-cancel-refresh-stats"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => { setConfirmRefreshOpen(false); refetch(); }}
              data-testid="button-confirm-refresh-stats"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Refresh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={failedOpen} onOpenChange={setFailedOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Failed Image Caches</DialogTitle>
            <DialogDescription>
              These images failed to download and cache. Retry to re-queue them for the next worker tick.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-1 py-1">
            {failedLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : failedData?.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No failed entries.</p>
            ) : (
              failedData?.entries.map((entry) => (
                <div key={entry.id} className="rounded-md border bg-muted/30 px-3 py-2 space-y-0.5" data-testid={`row-failed-${entry.id}`}>
                  <a
                    href={entry.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono truncate text-foreground hover:underline block"
                    title={entry.source_url}
                    data-testid={`link-failed-url-${entry.id}`}
                  >
                    {entry.source_url}
                  </a>
                  {entry.source_item && (
                    <p className="text-[10px] text-muted-foreground" data-testid={`text-source-item-${entry.id}`}>
                      from: {entry.source_item}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    Failed {new Date(entry.failed_at).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { refetchFailed(); }}
              disabled={failedLoading}
              data-testid="button-refresh-failed-list"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${failedLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setFailedOpen(false)} data-testid="button-close-failed-modal">
                Close
              </Button>
              <Button
                size="sm"
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending || failedLoading || !failedData?.entries.length}
                data-testid="button-retry-all-failed"
              >
                {retryMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                )}
                Retry All
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ErrorsKpiCard({
  errorCount,
  errorSummary,
  errors,
  warnings,
  onCheckHealth,
  checkHealthPending,
}: {
  errorCount: number;
  errorSummary?: string;
  errors: DatabaseValidationIssue[];
  warnings: DatabaseValidationIssue[];
  onCheckHealth: () => void;
  checkHealthPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasIssues = errorCount > 0 || warnings.length > 0;

  return (
    <>
      <Card
        className={hasIssues ? "cursor-pointer hover-elevate" : undefined}
        onClick={() => setOpen(true)}
        data-testid="card-errors-kpi"
      >
        <CardContent className="pt-4 pb-3 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Errors</span>
          </div>
          <p
            className={`text-sm font-medium ${errorCount > 0 ? "text-destructive" : ""}`}
            data-testid="text-error-count"
          >
            {errorCount}
          </p>
          <p className="text-xs text-muted-foreground truncate" title={errorSummary}>
            {errorCount > 0
              ? errorSummary || "Cached validation issues"
              : "No cached issues"}
          </p>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col" data-testid="dialog-database-errors">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {errorCount > 0 ? (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              ) : (
                <CircleCheck className="h-5 w-5 text-chart-3" />
              )}
              Cached validation issues
            </DialogTitle>
            <DialogDescription>
              Results from the last diagnostics run stored in the validation cache. Run Check Health for a fresh pass.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 py-1">
            {!hasIssues && (
              <div className="p-3 rounded-md bg-chart-3/10 border border-chart-3/30 text-sm text-foreground">
                No cached errors or warnings for this database.
              </div>
            )}
            {errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-destructive">Errors ({errorCount})</p>
                {errors.map((issue, i) => (
                  <div
                    key={`err-${i}`}
                    className="p-2 rounded-md bg-destructive/10 border border-destructive/30 text-sm"
                    data-testid={`cached-error-${i}`}
                  >
                    <div className="flex items-start gap-2">
                      <CircleX className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-foreground">{issue.message}</p>
                        {issue.code && (
                          <p className="text-xs text-muted-foreground mt-0.5">{issue.code}</p>
                        )}
                        {issue.suggestion && (
                          <p className="text-xs text-muted-foreground mt-1">{issue.suggestion}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {warnings.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-chart-2">Warnings ({warnings.length})</p>
                {warnings.map((issue, i) => (
                  <div
                    key={`warn-${i}`}
                    className="p-2 rounded-md bg-chart-2/10 border border-chart-2/30 text-sm"
                    data-testid={`cached-warning-${i}`}
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-foreground">{issue.message}</p>
                        {issue.code && (
                          <p className="text-xs text-muted-foreground mt-0.5">{issue.code}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setOpen(false);
                onCheckHealth();
              }}
              disabled={checkHealthPending}
              data-testid="button-errors-kpi-check-health"
            >
              {checkHealthPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <HeartPulse className="h-3.5 w-3.5 mr-1" />
              )}
              Check Health
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DatabaseUsagePanel({ dbName }: { dbName: string }) {
  const [contentTypeFilter, setContentTypeFilter] = useState<string | null>(null);
  const [componentFilter, setComponentFilter] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<DatabaseUsageReport>({
    queryKey: ["/api/databases", dbName, "usage"],
    queryFn: async () => {
      const res = await fetch(`/api/databases/${dbName}/usage`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Failed to load usage");
      }
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center" data-testid="usage-loading">
        <Loader2 className="h-4 w-4 animate-spin" />
        Scanning content for dependencies…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-start gap-2 text-sm text-destructive py-2" data-testid="usage-error">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>{error instanceof Error ? error.message : "Failed to load usage"}</span>
      </div>
    );
  }

  const { content_types: contentTypes, queries, notes } = data;
  const empty = contentTypes.length === 0 && queries.length === 0;

  const componentKey = (q: DatabaseUsageReport["queries"][number]) =>
    q.section_type?.trim() || "unknown";

  // Each KPI row reflects the other dimension's filter so counts stay meaningful when combined.
  const queriesForContentTypeKpis = componentFilter
    ? queries.filter((q) => componentKey(q) === componentFilter)
    : queries;
  const queriesForComponentKpis = contentTypeFilter
    ? queries.filter((q) => q.content_type === contentTypeFilter)
    : queries;

  const byContentType = groupUsageCounts(queriesForContentTypeKpis, (q) => q.content_type);
  const byComponent = groupUsageCounts(queriesForComponentKpis, componentKey);

  const filteredQueries = queries.filter((q) => {
    if (contentTypeFilter && q.content_type !== contentTypeFilter) return false;
    if (componentFilter && componentKey(q) !== componentFilter) return false;
    return true;
  });

  const hasFilter = !!(contentTypeFilter || componentFilter);
  const filterLabels = [
    contentTypeFilter ? `type:${contentTypeFilter}` : null,
    componentFilter ? `component:${componentFilter}` : null,
  ].filter(Boolean);

  const clearFilters = () => {
    setContentTypeFilter(null);
    setComponentFilter(null);
  };

  return (
    <div className="space-y-4" data-testid="usage-panel">
      {notes && notes.length > 0 && (
        <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            {notes.map((note, i) => (
              <p key={i}>{note}</p>
            ))}
          </div>
        </div>
      )}

      {empty ? (
        <div className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="usage-empty">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>No content types or sections currently reference this database.</span>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              DB linked content types ({contentTypes.length})
            </h4>
            {contentTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No content types linked via content-types.yml.</p>
            ) : (
              <ul className="space-y-1" data-testid="usage-content-types">
                {contentTypes.map((ct) => (
                  <li key={ct.name}>
                    <Link
                      href={`/private/type/${ct.name}`}
                      className="text-sm text-primary underline underline-offset-2 hover:text-primary/80"
                      data-testid={`usage-content-type-${ct.name}`}
                    >
                      {ct.label || ct.name}
                    </Link>
                    <span className="text-xs text-muted-foreground ml-2 font-mono">{ct.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {queries.length > 0 && (
            <div className="space-y-4" data-testid="usage-query-summaries">
              <UsageGroupKpis
                title="By content type"
                testId="usage-by-content-type"
                items={byContentType}
                selectedKey={contentTypeFilter}
                onSelect={(key) =>
                  setContentTypeFilter((prev) => (prev === key ? null : key))
                }
              />
              <UsageGroupKpis
                title="By components within content types"
                testId="usage-by-component"
                items={byComponent}
                selectedKey={componentFilter}
                onSelect={(key) =>
                  setComponentFilter((prev) => (prev === key ? null : key))
                }
              />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Queries ({filteredQueries.length}
                {hasFilter ? ` of ${queries.length}` : ""})
              </h4>
              {hasFilter && (
                <button
                  type="button"
                  className="text-xs text-primary underline underline-offset-2 hover:text-primary/80"
                  onClick={clearFilters}
                  data-testid="button-clear-usage-filters"
                >
                  Clear filters ({filterLabels.join(" · ")})
                </button>
              )}
            </div>
            {filteredQueries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {hasFilter
                  ? `No queries match ${filterLabels.join(" and ")}.`
                  : "No section or form queries found."}
              </p>
            ) : (
              <ul className="space-y-2 max-h-80 overflow-y-auto" data-testid="usage-queries">
                {filteredQueries.map((q, i) => {
                  const location = [q.content_type, q.slug, q.locale].filter(Boolean).join(" / ");
                  const previewHref = q.slug
                    ? `/private/preview/${encodeURIComponent(q.content_type)}/${encodeURIComponent(q.slug)}${
                        q.locale ? `?locale=${encodeURIComponent(q.locale)}` : ""
                      }`
                    : `/private/type/${encodeURIComponent(q.content_type)}`;
                  return (
                    <li
                      key={`${q.kind}-${q.file}-${q.section_type}-${i}`}
                      className="flex items-start gap-2 text-sm border border-border rounded-md p-2"
                      data-testid={`usage-query-${i}`}
                    >
                      <Badge variant="secondary" className="text-[10px] shrink-0 mt-0.5">
                        {USAGE_KIND_LABELS[q.kind]}
                      </Badge>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-medium text-foreground truncate">
                          {q.section_type ? `${q.section_type}` : "section"}
                          {q.source_name ? (
                            <span className="text-muted-foreground font-normal">
                              {" "}
                              ← {q.source_name}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground truncate" title={q.file}>
                          {location}
                          {q.file ? ` · ${q.file}` : ""}
                        </p>
                      </div>
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 text-xs px-2"
                      >
                        <Link
                          href={previewHref}
                          data-testid={`usage-query-open-${i}`}
                          title={q.slug ? "Open page preview" : "Open content type"}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          {q.slug ? "Open" : "Manage"}
                        </Link>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SemanticIndexKpiCard({ dbName, jobStatus, onForceRefresh, onReindex }: {
  dbName: string;
  jobStatus?: {
    fetch: { status: string };
    index: { status: string; fetched?: number; total?: number | null; finishedAt?: string; error?: string };
    search_cache?: { memoryEntries?: number; lastWrittenAt?: string | null };
  } | null;
  onForceRefresh?: () => void;
  onReindex?: () => void;
}) {
  const index = jobStatus?.index;
  const isRunning = index?.status === "running";
  const isError = index?.status === "error";
  const isDone = index?.status === "done";
  const neverRun = !isRunning && !isError && !isDone;
  const memoryEntries = jobStatus?.search_cache?.memoryEntries ?? 0;
  const [gcsEntries, setGcsEntries] = useState<number | null>(null);
  const [gcsLoading, setGcsLoading] = useState(false);

  const checkGcsCache = async () => {
    setGcsLoading(true);
    try {
      const res = await fetch(`/api/databases/${dbName}/search-cache-stats?includeGcs=1`);
      const data = await res.json();
      setGcsEntries(typeof data.gcsEntries === "number" ? data.gcsEntries : 0);
    } catch {
      setGcsEntries(null);
    } finally {
      setGcsLoading(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-4 pb-3 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Semantic Index</span>
        </div>
        <p className="text-sm font-medium" data-testid="text-semantic-index-count">
          {index?.fetched !== undefined ? index.fetched : "\u2014"}
          {index?.total !== undefined && index.total !== null ? ` / ${index.total}` : ""}
        </p>
        <p className="text-xs text-muted-foreground" data-testid="text-search-cache-memory">
          Search cache: {memoryEntries} in memory
          {jobStatus?.search_cache?.lastWrittenAt
            ? ` · last ${new Date(jobStatus.search_cache.lastWrittenAt).toLocaleString()}`
            : ""}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] px-1.5 text-muted-foreground"
            onClick={checkGcsCache}
            disabled={gcsLoading}
            data-testid="button-check-gcs-search-cache"
          >
            {gcsLoading ? (
              <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Checking GCS…</>
            ) : (
              "Check GCS cache"
            )}
          </Button>
          {gcsEntries !== null && (
            <span className="text-[10px] text-muted-foreground" data-testid="text-search-cache-gcs">
              {gcsEntries} object{gcsEntries === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {isRunning ? (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
            <span>Indexing{index?.fetched !== undefined && index?.total ? ` ${index.fetched} of ${index.total}` : "\u2026"}</span>
          </div>
        ) : isError ? (
          <div className="space-y-1">
            <p className="text-xs text-destructive truncate" title={index?.error}>Error: {index?.error ?? "unknown"}</p>
            {onReindex && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs px-2"
                onClick={onReindex}
                data-testid="button-reindex"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Re-index
              </Button>
            )}
          </div>
        ) : isDone ? (
          <p className="text-xs text-muted-foreground">
            {index?.finishedAt ? new Date(index.finishedAt).toLocaleString() : "Done"}
          </p>
        ) : neverRun ? (
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-left"
            onClick={onForceRefresh}
            data-testid="button-semantic-index-refresh-hint"
          >
            Force Refresh to build index
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DatabaseDetailView({ dbName }: { dbName: string }) {
  const { toast } = useToast();
  const PAGE_SIZE = 100;
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [activePanel, setActivePanel] = useState<"settings" | "mappings" | "usage" | null>(null);
  const [dataView, setDataView] = useState<"mapped" | "raw">("mapped");
  const [page, setPage] = useState(1);
  const [tagFilters, setTagFilters] = useState<Record<string, string[]>>({});

  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDescValue, setEditDescValue] = useState("");
  const [inlineSaving, setInlineSaving] = useState(false);
  const [sourceEndpointCopied, setSourceEndpointCopied] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [editingItem, setEditingItem] = useState<Record<string, unknown> | null>(null);
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [deleteConfirmIndex, setDeleteConfirmIndex] = useState<number | null>(null);
  const [confirmForceRefreshOpen, setConfirmForceRefreshOpen] = useState(false);
  const [healthDialogOpen, setHealthDialogOpen] = useState(false);
  const [healthResult, setHealthResult] = useState<{
    errors: Array<{ code?: string; message: string; file?: string; suggestion?: string; type: string }>;
    warnings: Array<{ code?: string; message: string; file?: string; suggestion?: string; type: string }>;
    status: string;
  } | null>(null);
  const [savingItems, setSavingItems] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const checkHealthMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/validation/run", {
        validators: ["database-health"],
        scope: { database: dbName },
      });
      return res.json() as Promise<{
        validators: Array<{
          name: string;
          status: string;
          errors: Array<{ code?: string; message: string; file?: string; suggestion?: string; type: string }>;
          warnings: Array<{ code?: string; message: string; file?: string; suggestion?: string; type: string }>;
        }>;
      }>;
    },
    onSuccess: (data) => {
      const v = data.validators?.find((x) => x.name === "database-health");
      const unknown = v?.errors?.some((e) => e.code === "UNKNOWN_VALIDATOR");
      if (unknown) {
        toast({
          title: "Health check unavailable",
          description: "Restart the dev server (npm run dev) so the database-health validator can load.",
          variant: "destructive",
        });
        return;
      }
      setHealthResult(
        v
          ? { errors: v.errors, warnings: v.warnings, status: v.status }
          : { errors: [], warnings: [], status: "passed" },
      );
      setHealthDialogOpen(true);
      queryClient.invalidateQueries({ queryKey: ["/api/databases"] });
      queryClient.invalidateQueries({ queryKey: [`/api/databases/${dbName}/job-status`] });
    },
    onError: (err) => {
      toast({
        title: "Health check failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const { data: detail, refetch: refetchDetail } = useQuery<DatabaseDetail>({
    queryKey: ["/api/databases", dbName],
  });

  const {
    data: itemsData,
    isLoading: itemsLoading,
    isFetching: itemsFetching,
    refetch: refetchItems,
  } = useQuery<DatabaseItems>({
    queryKey: [`/api/databases/${dbName}/items`, page, PAGE_SIZE, tagFilters],
    queryFn: () => {
      const parts: string[] = [`page=${page}`, `limit=${PAGE_SIZE}`];
      for (const [field, values] of Object.entries(tagFilters)) {
        for (const v of values) parts.push(`filter[${field}]=${encodeURIComponent(v)}`);
      }
      return fetch(`/api/databases/${dbName}/items?${parts.join("&")}`).then((r) => r.json());
    },
    enabled: !!dbName,
  });

  const {
    data: rawItemsData,
    isLoading: rawItemsLoading,
    refetch: refetchRawItems,
  } = useQuery<DatabaseItems>({
    queryKey: [`/api/databases/${dbName}/raw-items`, page, PAGE_SIZE],
    queryFn: () =>
      fetch(`/api/databases/${dbName}/raw-items?page=${page}&limit=${PAGE_SIZE}`).then((r) => r.json()),
    enabled: !!dbName,
  });

  const config = detail?.config;
  const fieldMapping = config?.field_mapping;

  const hasSemanticSearch = (config?.vector_search?.fields?.length ?? 0) > 0;

  const [jobStatusDismissed, setJobStatusDismissed] = useState(false);
  const [bothTerminalAt, setBothTerminalAt] = useState<number | null>(null);

  const lastActivityAtRef = useRef<number>(Date.now());
  const hasSemanticRef = useRef(hasSemanticSearch);
  useEffect(() => { hasSemanticRef.current = hasSemanticSearch; }, [hasSemanticSearch]);

  const { data: jobStatus } = useQuery<{
    fetch: { status: string; fetched?: number; total?: number | null; page?: number; startedAt?: string; finishedAt?: string; error?: string };
    index: { status: string; fetched?: number; total?: number | null; startedAt?: string; finishedAt?: string; error?: string };
  }>({
    queryKey: [`/api/databases/${dbName}/job-status`],
    queryFn: () => fetch(`/api/databases/${dbName}/job-status`).then((r) => r.json()),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      const eitherRunning = data.fetch?.status === "running" || data.index?.status === "running";
      if (eitherRunning) {
        lastActivityAtRef.current = Date.now();
      }
      const inactive = Date.now() - lastActivityAtRef.current;
      if (!eitherRunning && inactive >= 10000) return false;
      return 2000;
    },
  });

  useEffect(() => {
    if (!jobStatus) return;
    if (jobStatus.fetch?.status === "running" || jobStatus.index?.status === "running") {
      lastActivityAtRef.current = Date.now();
    }
    const fetchTerminal = jobStatus.fetch?.status === "done" || jobStatus.fetch?.status === "error";
    const indexTerminal = jobStatus.index?.status === "done" || jobStatus.index?.status === "error" ||
      (!hasSemanticSearch && jobStatus.index?.status !== "running");
    if (fetchTerminal && indexTerminal) {
      if (!bothTerminalAt) setBothTerminalAt(Date.now());
    } else {
      setBothTerminalAt(null);
      setJobStatusDismissed(false);
    }
  }, [jobStatus, hasSemanticSearch]);

  useEffect(() => {
    if (!bothTerminalAt) return;
    const timer = setTimeout(() => setJobStatusDismissed(true), 4000);
    return () => clearTimeout(timer);
  }, [bothTerminalAt]);

  const fetchRunning = jobStatus?.fetch?.status === "running";
  const indexRunning = jobStatus?.index?.status === "running";
  const showJobBanner = !jobStatusDismissed && jobStatus && (
    fetchRunning || indexRunning ||
    jobStatus.fetch?.status === "error" || jobStatus.index?.status === "error" ||
    (bothTerminalAt !== null)
  );

  const [fnPreviewField, setFnPreviewField] = useState<{ key: string; fn: string } | null>(null);
  const [fnTestInput, setFnTestInput] = useState("");
  const [fnTestItemIndex, setFnTestItemIndex] = useState<number>(0);
  const [fnTestResult, setFnTestResult] = useState<{ ok: true; output: string } | { ok: false; error: string } | null>(null);
  const [fnFixing, setFnFixing] = useState(false);
  const [fnCustomMode, setFnCustomMode] = useState(false);

  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const { data: semanticResults, isFetching: semanticFetching } = useQuery<{
    items: Record<string, unknown>[];
    count: number;
    semantic: boolean;
    scores?: Record<string, number>;
    fallback_reason?: "vector_store_unavailable" | "semantic_index_empty";
    fallback_message?: string;
  }>({
    queryKey: [`/api/databases/${dbName}/search`, debouncedSearch],
    queryFn: () =>
      fetch(`/api/databases/${dbName}/search?q=${encodeURIComponent(debouncedSearch)}&limit=100`)
        .then((r) => r.json()),
    enabled: debouncedSearch.trim().length > 0 && !!itemsData,
    staleTime: 10_000,
  });

  const activeItems = dataView === "raw" ? rawItemsData : itemsData;

  const showScoreColumn =
    dataView !== "raw" &&
    !editMode &&
    debouncedSearch.trim().length > 0 &&
    !!semanticResults?.semantic &&
    !!semanticResults.scores &&
    Object.keys(semanticResults.scores).length > 0;

  const columns = (() => {
    let cols: string[] = [];
    if (dataView === "mapped" && fieldMapping && Object.keys(fieldMapping).length > 0) {
      cols = Object.keys(fieldMapping);
    } else if (activeItems?.items?.[0]) {
      cols = Object.keys(activeItems.items[0]);
    }
    if (showScoreColumn) {
      cols = ["score", ...cols.filter((c) => c !== "score")];
    }
    return cols;
  })();

  const filteredItems = (() => {
    let items: Record<string, unknown>[];

    if (debouncedSearch.trim() && semanticResults?.items && dataView !== "raw") {
      items = semanticResults.items.map((item, i) => {
        const scores = semanticResults.scores ?? {};
        const key = String(item.slug ?? item.id ?? i);
        const score = scores[key] ?? scores[String(i)];
        return typeof score === "number" ? { ...item, score } : { ...item };
      });
      // AND tag filters on top of semantic results (server search doesn't apply them)
      if (Object.keys(tagFilters).length > 0) {
        items = items.filter((item) =>
          Object.entries(tagFilters).every(([field, selected]) => {
            const val = item[field];
            const itemVals = Array.isArray(val) ? val.map(String) : val != null ? [String(val)] : [];
            return selected.some((s) => itemVals.includes(s));
          })
        );
      }
    } else if (!activeItems?.items) {
      return [];
    } else {
      items = activeItems.items;
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.toLowerCase();
        items = items.filter((item) =>
          Object.values(item).some(
            (v) => v != null && String(v).toLowerCase().includes(q)
          )
        );
      }
    }

    if (sortKey) {
      items = [...items].sort((a, b) => {
        if (sortKey === "score") {
          const av = typeof a.score === "number" ? a.score : Number.NEGATIVE_INFINITY;
          const bv = typeof b.score === "number" ? b.score : Number.NEGATIVE_INFINITY;
          return sortDir === "asc" ? av - bv : bv - av;
        }
        const av = a[sortKey] ?? "";
        const bv = b[sortKey] ?? "";
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return items;
  })();

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  useEffect(() => {
    setPage(1);
  }, [dataView, search]);

  const runForceRefresh = async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    setJobStatusDismissed(false);
    const label = config?.name || dbName;
    const fallback = `There was an error fetching "${label}".`;
    try {
      const res = await fetch(`/api/databases/${dbName}/refresh`, { method: "POST" });
      if (!res.ok) {
        throw new Error(await parseDatabaseApiError(res, fallback));
      }
      setRefreshError(null);
      setPage(1);
      queryClient.invalidateQueries({ queryKey: [`/api/databases/${dbName}/job-status`] });
      queryClient.invalidateQueries({ queryKey: ["/api/databases"] });
      await Promise.all([refetchItems(), refetchRawItems()]);
    } catch (err) {
      const description = err instanceof Error && err.message.trim()
        ? err.message
        : fallback;
      setRefreshError(description);
      toast({
        title: `Failed to refresh "${label}"`,
        description,
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRefresh = () => runForceRefresh();
  const handleRetryFetch = () => runForceRefresh();

  const handleReindex = async () => {
    setIsReindexing(true);
    setJobStatusDismissed(false);
    try {
      const res = await fetch(`/api/databases/${dbName}/reindex`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Re-index failed");
      }
      queryClient.invalidateQueries({ queryKey: [`/api/databases/${dbName}/job-status`] });
    } catch (err) {
      toast({
        title: "Re-index failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsReindexing(false);
    }
  };

  const handleSaveItems = async (newItems: Record<string, unknown>[]): Promise<void> => {
    setSavingItems(true);
    try {
      const res = await fetch(`/api/databases/${dbName}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: newItems }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save items");
      }
      await Promise.all([refetchItems(), refetchRawItems()]);
      toast({ title: "Items saved", description: `${newItems.length} items written to file` });
    } catch (err) {
      toast({
        title: "Error saving items",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      throw err;
    } finally {
      setSavingItems(false);
    }
  };

  const saveInlineField = async (field: "name" | "description", value: string) => {
    setInlineSaving(true);
    try {
      const updatedConfig = { ...config, [field]: value || undefined };
      const res = await fetch(`/api/databases/${dbName}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedConfig),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Failed to save ${field}`);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/databases", dbName] });
      queryClient.invalidateQueries({ queryKey: ["/api/databases"] });
      await refetchDetail();
      if (field === "name") setEditingName(false);
      else setEditingDesc(false);
    } catch (err) {
      toast({
        title: `Error saving ${field}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setInlineSaving(false);
    }
  };

  const TRANSFORM_ERROR_SENTINEL = "__transform_error__";

  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) return "\u2014";
    if (value === TRANSFORM_ERROR_SENTINEL) return "[transform error]";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const cellClassName = (value: unknown) =>
    value === TRANSFORM_ERROR_SENTINEL ? "text-destructive" : "";

  const copySourceEndpoint = () => {
    const endpoint = config?.source.api?.endpoint;
    if (!endpoint) return;
    navigator.clipboard.writeText(endpoint);
    setSourceEndpointCopied(true);
    setTimeout(() => setSourceEndpointCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/private/databases">
          <Button variant="ghost" size="sm" data-testid="button-back-databases">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 group/name">
            {editingName ? (
              <div className="flex items-center gap-1.5">
                <Input
                  value={editNameValue}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  className="h-8 text-sm font-semibold w-64"
                  autoFocus
                  disabled={inlineSaving}
                  data-testid="input-inline-name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && editNameValue.trim()) saveInlineField("name", editNameValue.trim());
                    if (e.key === "Escape") setEditingName(false);
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={inlineSaving || !editNameValue.trim()}
                  onClick={() => saveInlineField("name", editNameValue.trim())}
                  data-testid="button-save-inline-name"
                >
                  {inlineSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setEditingName(false)} data-testid="button-cancel-inline-name">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold truncate" data-testid="text-database-name">
                  {config?.name || dbName}
                </h2>
                <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex-shrink-0" data-testid="text-database-slug">
                  {dbName}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="invisible group-hover/name:visible"
                  onClick={() => { setEditNameValue(config?.name || dbName); setEditingName(true); }}
                  data-testid="button-edit-name"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 group/desc mt-0.5">
            {editingDesc ? (
              <div className="flex items-center gap-1.5 flex-1">
                <Input
                  value={editDescValue}
                  onChange={(e) => setEditDescValue(e.target.value)}
                  className="h-7 text-xs flex-1"
                  placeholder="Add a description..."
                  autoFocus
                  disabled={inlineSaving}
                  data-testid="input-inline-description"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveInlineField("description", editDescValue.trim());
                    if (e.key === "Escape") setEditingDesc(false);
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={inlineSaving}
                  onClick={() => saveInlineField("description", editDescValue.trim())}
                  data-testid="button-save-inline-desc"
                >
                  {inlineSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setEditingDesc(false)} data-testid="button-cancel-inline-desc">
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : config?.description ? (
              <>
                <p className="text-xs text-muted-foreground truncate" data-testid="text-database-description">{config.description}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="invisible group-hover/desc:visible"
                  onClick={() => { setEditDescValue(config.description || ""); setEditingDesc(true); }}
                  data-testid="button-edit-description"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </>
            ) : (
              <button
                className="text-xs text-muted-foreground/60 hover:text-muted-foreground invisible group-hover/desc:visible cursor-pointer"
                onClick={() => { setEditDescValue(""); setEditingDesc(true); }}
                data-testid="button-add-description"
              >
                + Add description
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => checkHealthMutation.mutate()}
            disabled={checkHealthMutation.isPending}
            data-testid="button-check-health"
          >
            {checkHealthMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <HeartPulse className="h-3.5 w-3.5 mr-1" />
            )}
            Check Health
          </Button>
          <Button
            variant={activePanel === "settings" ? "default" : "outline"}
            size="sm"
            onClick={() => setActivePanel(activePanel === "settings" ? null : "settings")}
            data-testid="button-toggle-settings"
          >
            {activePanel === "settings" ? (
              <X className="h-3.5 w-3.5 mr-1" />
            ) : (
              <Settings className="h-3.5 w-3.5 mr-1" />
            )}
            Settings
          </Button>
          <Button
            variant={activePanel === "mappings" ? "default" : "outline"}
            size="sm"
            onClick={() => setActivePanel(activePanel === "mappings" ? null : "mappings")}
            data-testid="button-toggle-mappings"
          >
            {activePanel === "mappings" ? (
              <X className="h-3.5 w-3.5 mr-1" />
            ) : (
              <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
            )}
            Mappings
          </Button>
          <Button
            variant={activePanel === "usage" ? "default" : "outline"}
            size="sm"
            onClick={() => setActivePanel(activePanel === "usage" ? null : "usage")}
            data-testid="button-toggle-usage"
          >
            {activePanel === "usage" ? (
              <X className="h-3.5 w-3.5 mr-1" />
            ) : (
              <Network className="h-3.5 w-3.5 mr-1" />
            )}
            Usage
          </Button>
        </div>
      </div>

      {activePanel === "settings" && config ? (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Source &amp; Cache Configuration</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <DatabaseConfigEditor
              dbName={dbName}
              config={config}
              onSaved={() => {
                refetchDetail();
                setActivePanel(null);
              }}
            />
          </CardContent>
        </Card>
      ) : activePanel === "mappings" && config ? (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Field Mapping (Raw API &rarr; Database)</CardTitle>
            <p className="text-xs text-muted-foreground">
              Transform raw source fields into normalized database fields. Applied before caching.
            </p>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <FieldMappingEditor
              dbName={dbName}
              config={config}
              onSaved={() => {
                refetchDetail();
                setActivePanel(null);
              }}
            />
          </CardContent>
        </Card>
      ) : activePanel === "usage" ? (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Usage</CardTitle>
            <p className="text-xs text-muted-foreground">
              Content types linked to this database and sections or forms that query it.
            </p>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <DatabaseUsagePanel dbName={dbName} />
          </CardContent>
        </Card>
      ) : (
        <>
          {(() => {
            const hasCachedFields = config?.editor
              ? Object.values(config.editor).some((f) => f.cache_images === true)
              : false;
            const optionalCount = (hasCachedFields ? 1 : 0) + (hasSemanticSearch ? 1 : 0);
            const lgCols =
              optionalCount === 2 ? "lg:grid-cols-6" : optionalCount === 1 ? "lg:grid-cols-5" : "lg:grid-cols-4";
            return (
          <div className={`grid gap-4 sm:grid-cols-2 ${lgCols}`}>
            <Card>
              <CardContent className="pt-4 pb-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Webhook className="h-3.5 w-3.5" />
                    <span>Source</span>
                  </div>
                  {config?.source.api?.params && Object.keys(config.source.api.params).length > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-6 w-6" title="View query params" data-testid="button-view-source-params">
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent side="bottom" align="end" className="w-72 p-3 space-y-2">
                        <p className="text-xs font-medium">Query Parameters</p>
                        <div className="space-y-1">
                          {Object.entries(config.source.api.params).map(([k, v]) => (
                            <div key={k} className="flex items-start gap-2 text-xs">
                              <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-foreground shrink-0">{k}</code>
                              <span className="text-muted-foreground mt-0.5">=</span>
                              <code className="text-muted-foreground font-mono break-all">{String(v)}</code>
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
                <p className="text-sm font-medium">{config?.source.type || "\u2014"}</p>
                {config?.source.api?.endpoint && (
                  <div className="flex items-center gap-1 min-w-0">
                    <button
                      type="button"
                      onClick={copySourceEndpoint}
                      className="text-xs text-muted-foreground truncate min-w-0 flex-1 text-left hover:text-foreground transition-colors cursor-pointer"
                      title={sourceEndpointCopied ? "Copied!" : config.source.api.endpoint}
                      data-testid="text-source-endpoint"
                    >
                      {config.source.api.endpoint}
                    </button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5 shrink-0"
                      title={sourceEndpointCopied ? "Copied!" : "Copy endpoint URL"}
                      data-testid="button-copy-source-endpoint"
                      onClick={copySourceEndpoint}
                    >
                      {sourceEndpointCopied ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Table className="h-3.5 w-3.5" />
                  <span>Items</span>
                </div>
                <p className="text-sm font-medium" data-testid="text-item-count">
                  {itemsData ? itemsData.raw_count ?? itemsData.total_count : detail?.cache_status ? detail.cache_status.item_count : itemsLoading || itemsFetching ? "..." : "\u2014"}
                </p>
                {(itemsData?.from_cache || (!itemsData && detail?.cache_status)) && (
                  <p className="text-xs text-muted-foreground">from cache</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Last Fetched</span>
                  </div>
                  {config?.source.type === "api" && (
                    <WebhookUrlPopover type={dbName} variant="icon" />
                  )}
                </div>
                {fetchRunning ? (
                  <div className="flex items-center gap-1.5" data-testid="text-fetched-at">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">
                      Fetching{jobStatus?.fetch.fetched !== undefined ? `\u2026 ${jobStatus.fetch.fetched} items` : "\u2026"}
                      {jobStatus?.fetch.page ? ` (page ${jobStatus.fetch.page})` : ""}
                    </span>
                  </div>
                ) : jobStatus?.fetch.status === "error" ? (
                  <div className="space-y-1">
                    <p className="text-xs text-destructive truncate" title={jobStatus.fetch.error} data-testid="text-fetched-at">
                      Error: {jobStatus.fetch.error ?? "unknown"}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs px-2"
                      onClick={handleRetryFetch}
                      disabled={isRefreshing}
                      data-testid="button-retry-fetch"
                    >
                      <RefreshCw className={`h-3 w-3 mr-1 ${isRefreshing ? "animate-spin" : ""}`} />
                      Retry
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm font-medium" data-testid="text-fetched-at">
                    {itemsData?.fetched_at
                      ? new Date(itemsData.fetched_at).toLocaleString()
                      : detail?.cache_status?.fetched_at
                        ? new Date(detail.cache_status.fetched_at).toLocaleString()
                        : "\u2014"}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  TTL: {config?.cache?.ttl_hours ?? 24}h
                </p>
              </CardContent>
            </Card>
            <ErrorsKpiCard
              errorCount={detail?.error_count ?? 0}
              errorSummary={detail?.error_summary}
              errors={detail?.validation_errors ?? []}
              warnings={detail?.validation_warnings ?? []}
              onCheckHealth={() => checkHealthMutation.mutate()}
              checkHealthPending={checkHealthMutation.isPending}
            />
            {hasCachedFields && (
              <CachedImagesKpiCard dbName={dbName} />
            )}
            {hasSemanticSearch && (
              <SemanticIndexKpiCard dbName={dbName} jobStatus={jobStatus} onForceRefresh={() => setConfirmForceRefreshOpen(true)} onReindex={handleReindex} />
            )}
          </div>
            );
          })()}

          <Card>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-sm" data-testid="text-field-mapping-title">Field Mapping (Raw API → Database)</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {fieldMapping && Object.keys(fieldMapping).length > 0 ? (
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(fieldMapping).map(([key, p]) => (
                    <div key={key} className="flex items-center gap-1.5 text-xs">
                      <code className="bg-muted px-1.5 py-0.5 rounded font-medium">{key}</code>
                      <span className="text-muted-foreground">&larr;</span>
                      {typeof p === "string" && p.startsWith("function:") ? (
                        <button
                          className="inline-flex items-center gap-1 bg-black dark:bg-zinc-900 px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity shrink-0"
                          onClick={() => {
                            let decoded: string;
                            try { decoded = atob(p.slice("function:".length)); } catch { decoded = p; }
                            setFnPreviewField({ key, fn: decoded });
                            setFnTestResult(null);
                            setFnTestItemIndex(0);
                            const sample = rawItemsData?.items?.[0]?.[key];
                            setFnTestInput(sample != null ? String(sample) : "");
                          }}
                          data-testid={`button-fn-preview-${key}`}
                          title="View computed function"
                        >
                          <Code className="h-3 w-3 text-orange-400" />
                          <span className="text-[10px] text-zinc-400">computed</span>
                        </button>
                      ) : (
                        <code className="text-muted-foreground truncate">{p || "null"}</code>
                      )}
                      {config?.editor?.[key]?.cache_images && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <span className="inline-flex items-center gap-0.5 text-blue-500 shrink-0 cursor-pointer hover:opacity-80 transition-opacity" data-testid={`badge-cached-${key}`}>
                              <Image className="h-3 w-3" />
                              <span className="text-[10px] font-medium">cached</span>
                            </span>
                          </PopoverTrigger>
                          <PopoverContent side="top" className="w-72 text-xs p-3 space-y-2">
                            <p className="font-medium text-sm">Image caching enabled</p>
                            <p className="text-muted-foreground">
                              Images in the <code className="bg-muted px-1 rounded font-mono">{key}</code> field are downloaded from their source URLs and stored locally on this server.
                            </p>
                            <p className="text-muted-foreground">
                              This avoids external image dependencies at render time, speeds up page loads, and ensures images remain available even if the source URL changes or goes down.
                            </p>
                            <p className="text-muted-foreground">
                              Images are re-cached automatically the next time the database is refreshed.
                            </p>
                          </PopoverContent>
                        </Popover>
                      )}
                      {(config as any)?.search_fields?.includes(key) && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <span className="inline-flex items-center text-orange-500 shrink-0 cursor-pointer hover:opacity-80 transition-opacity" data-testid={`badge-keyword-${key}`}>
                              <Search className="h-3 w-3" />
                            </span>
                          </PopoverTrigger>
                          <PopoverContent side="top" className="w-72 text-xs p-3 space-y-2">
                            <p className="font-medium text-sm">Keyword search enabled</p>
                            <p className="text-muted-foreground">
                              The <code className="bg-muted px-1 rounded font-mono">{key}</code> field is included in text-based keyword search.
                            </p>
                            <p className="text-muted-foreground">
                              When a user searches this database, the query is matched against the text content of this field using simple string matching.
                            </p>
                          </PopoverContent>
                        </Popover>
                      )}
                      {config?.vector_search?.fields?.includes(key) && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <span className="inline-flex items-center text-orange-500 shrink-0 cursor-pointer hover:opacity-80 transition-opacity" data-testid={`badge-semantic-${key}`}>
                              <Sparkles className="h-3 w-3 drop-shadow-[0_0_3px_rgba(249,115,22,0.7)]" />
                            </span>
                          </PopoverTrigger>
                          <PopoverContent side="top" className="w-72 text-xs p-3 space-y-2">
                            <p className="font-medium text-sm">Semantic search enabled</p>
                            <p className="text-muted-foreground">
                              The <code className="bg-muted px-1 rounded font-mono">{key}</code> field is included in the semantic search index.
                            </p>
                            <p className="text-muted-foreground">
                              Its text content is embedded as a vector, enabling AI-powered similarity search — users can find entries by meaning rather than exact keyword matches.
                            </p>
                            <p className="text-muted-foreground">
                              The index is updated automatically after each data fetch.
                            </p>
                          </PopoverContent>
                        </Popover>
                      )}
                      {(config?.editor?.[key]?.type === "tags" || config?.editor?.[key]?.type === "select") && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <span className="inline-flex items-center text-orange-500 shrink-0 cursor-pointer hover:opacity-80 transition-opacity" data-testid={`badge-tags-${key}`}>
                              <Tags className="h-3 w-3" />
                            </span>
                          </PopoverTrigger>
                          <PopoverContent side="top" className="w-64 text-xs p-3 space-y-2">
                            <p className="font-medium text-sm">{config.editor![key].type === "tags" ? "Multi-value (tags)" : "Select (dropdown)"}</p>
                            <p className="text-muted-foreground">
                              The <code className="bg-muted px-1 rounded font-mono">{key}</code> field renders as a {config.editor![key].type === "tags" ? "multi-select tag input" : "single-select dropdown"} in the item editor.
                            </p>
                            {(config.editor![key].options?.length ?? 0) > 0 && (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {config.editor![key].options!.map((o) => (
                                  <code key={o} className="bg-muted px-1.5 py-0.5 rounded text-[10px]">{o}</code>
                                ))}
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border border-destructive/30 bg-destructive/5 rounded-md p-4 space-y-3" data-testid="field-mapping-error">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <p className="text-sm text-destructive">
                      No field mapping configured. Raw source fields (potentially hundreds) will be cached as-is. Open Settings to define mappings or use AI to auto-detect them.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActivePanel("mappings")}
                    data-testid="button-open-settings-mapping"
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
                    Edit Mappings
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3 px-4">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-sm">
                    Data{" "}
                    {activeItems && filteredItems.length !== (activeItems?.items?.length ?? 0) && (
                      <span className="text-muted-foreground font-normal">
                        ({filteredItems.length} of {activeItems?.items?.length ?? 0})
                      </span>
                    )}
                  </CardTitle>
                  {!!itemsData && (
                    <div className="flex items-center rounded-md border overflow-visible">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`rounded-r-none border-r toggle-elevate ${dataView === "mapped" ? "toggle-elevated bg-muted" : ""}`}
                        onClick={() => { setDataView("mapped"); setSortKey(null); setSearch(""); setTagFilters({}); setPage(1); }}
                        data-testid="button-view-mapped"
                      >
                        Mapped
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`rounded-l-none toggle-elevate ${dataView === "raw" ? "toggle-elevated bg-muted" : ""}`}
                        onClick={() => { setDataView("raw"); setSortKey(null); setSearch(""); setTagFilters({}); setPage(1); }}
                        data-testid="button-view-raw"
                      >
                        Raw
                      </Button>
                    </div>
                  )}
                  {editMode && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsAddingItem(true)}
                      data-testid="button-add-item"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Item
                    </Button>
                  )}
                </div>
                <div className="flex items-start gap-2">
                  {!!itemsData && (
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          placeholder="Search..."
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          className={`pl-7 h-8 w-48 text-xs transition-[width] duration-200 ease-out focus:w-80 ${search ? "pr-7" : ""}`}
                          data-testid="input-search-items"
                        />
                        {search ? (
                          <button
                            type="button"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded-sm text-muted-foreground hover:text-foreground"
                            onClick={() => setSearch("")}
                            title="Clear search"
                            data-testid="button-clear-search-items"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                      {(() => {
                        const facets = itemsData?.facets;
                        if (dataView !== "mapped" || !facets || Object.keys(facets).length === 0) return null;
                        const activeFilterCount = Object.values(tagFilters).flat().length;
                        return (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 shrink-0 relative"
                                data-testid="button-open-filters"
                              >
                                <SlidersHorizontal className="h-3.5 w-3.5" />
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
                                      onClick={() => { setTagFilters({}); setPage(1); }}
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
                                          setPage(1);
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
                                                  setPage(1);
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
                      {(() => {
                        const searchFields = (config as any)?.search_fields as string[] | undefined;
                        const hasKeywordFields = (searchFields?.length ?? 0) > 0;
                        const isFallback =
                          !!debouncedSearch.trim() &&
                          !!semanticResults &&
                          !semanticResults.semantic &&
                          hasSemanticSearch;
                        const fallbackReason = semanticResults?.fallback_reason;
                        const fallbackLabel =
                          fallbackReason === "vector_store_unavailable"
                            ? "Qdrant unreachable"
                            : fallbackReason === "semantic_index_empty"
                              ? "Index empty / not built"
                              : "Semantic failed";
                        const label = hasSemanticSearch
                          ? semanticFetching
                            ? <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Searching…</>
                            : isFallback
                              ? <><AlertTriangle className="h-2.5 w-2.5 text-amber-500" /> Keyword only · {fallbackLabel}</>
                              : debouncedSearch.trim() && semanticResults?.semantic
                                ? <><Sparkles className="h-2.5 w-2.5 text-orange-500" /> Ranked by meaning</>
                                : <><Sparkles className="h-2.5 w-2.5 text-orange-500" /> Semantic search</>
                          : semanticFetching
                            ? <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Searching…</>
                            : <><HelpCircle className="h-2.5 w-2.5" /> How search works</>;
                        return (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                className={`text-[10px] flex items-center gap-1 pl-0.5 hover:text-foreground transition-colors cursor-pointer ${
                                  isFallback ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                                }`}
                                data-testid="text-search-mode"
                              >
                                {label}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="bottom" align="start" className="w-80 text-xs p-4 space-y-3">
                              <div className="flex items-center gap-2">
                                {isFallback ? (
                                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                                ) : (
                                  <Search className="h-4 w-4 shrink-0" />
                                )}
                                <p className="font-medium text-sm">
                                  {isFallback ? "Semantic search unavailable" : "How search works here"}
                                </p>
                              </div>
                              {isFallback && (
                                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-1" data-testid="text-search-fallback-reason">
                                  <p className="font-medium text-foreground">{fallbackLabel}</p>
                                  <p className="text-muted-foreground">
                                    {semanticResults?.fallback_message ??
                                      "Semantic search could not run, so results use exact keyword matching only."}
                                  </p>
                                  {fallbackReason === "vector_store_unavailable" && (
                                    <p className="text-muted-foreground">
                                      Check that Qdrant is running and <code className="bg-muted px-1 rounded font-mono">QDRANT_URL</code> is correct, then retry search.
                                    </p>
                                  )}
                                  {fallbackReason === "semantic_index_empty" && (
                                    <p className="text-muted-foreground">
                                      Use <strong className="text-foreground">Force Refresh</strong> or <strong className="text-foreground">Re-index</strong> on the Semantic Index card, then search again.
                                    </p>
                                  )}
                                </div>
                              )}
                              {hasSemanticSearch ? (
                                <>
                                  <p className="text-muted-foreground">
                                    This database has <strong className="text-foreground">semantic search</strong> enabled. When healthy, queries hit the vector index — results are sorted by <strong className="text-foreground">meaning</strong>, not exact keyword match.
                                  </p>
                                  {config?.vector_search?.fields && config.vector_search.fields.length > 0 && (
                                    <div className="space-y-1">
                                      <p className="font-medium text-foreground">Semantic fields</p>
                                      <div className="flex flex-wrap gap-1">
                                        {config.vector_search.fields.map((f) => (
                                          <code key={f} className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{f}</code>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {!isFallback && (
                                    <p className="text-muted-foreground">
                                      If the vector store or index is unavailable, search falls back to keyword matching and this control will show the specific failure reason.
                                    </p>
                                  )}
                                </>
                              ) : hasKeywordFields ? (
                                <>
                                  <p className="text-muted-foreground">
                                    This database uses <strong className="text-foreground">keyword search</strong>. Your query is matched as plain text against the configured fields.
                                  </p>
                                  <div className="space-y-1">
                                    <p className="font-medium text-foreground">Searched fields</p>
                                    <div className="flex flex-wrap gap-1">
                                      {searchFields!.map((f) => (
                                        <code key={f} className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{f}</code>
                                      ))}
                                    </div>
                                  </div>
                                  <p className="text-muted-foreground">
                                    You can upgrade to <strong className="text-foreground">semantic search</strong> in <strong className="text-foreground">Settings → Field Mappings</strong> by enabling the vector index on one or more fields.
                                  </p>
                                </>
                              ) : (
                                <>
                                  <p className="text-muted-foreground">
                                    No specific search fields are configured. Your query is matched as plain text <strong className="text-foreground">across all fields</strong> in this database.
                                  </p>
                                  <p className="text-muted-foreground">
                                    To narrow which fields are searched, open <strong className="text-foreground">Settings → Field Mappings</strong> and enable keyword or semantic search on individual fields.
                                  </p>
                                </>
                              )}
                            </PopoverContent>
                          </Popover>
                        );
                      })()}
                      {showJobBanner && (
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pl-0.5 mt-0.5" data-testid="job-status-banner">
                          {fetchRunning ? (
                            <>
                              <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />
                              <span>
                                Fetching{jobStatus?.fetch.fetched !== undefined ? ` ${jobStatus.fetch.fetched} items` : "\u2026"}
                                {jobStatus?.fetch.page ? ` (page ${jobStatus.fetch.page})` : ""}
                              </span>
                            </>
                          ) : indexRunning ? (
                            <>
                              <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />
                              <span>
                                Indexing{jobStatus?.index.fetched !== undefined && jobStatus?.index.total ? ` ${jobStatus.index.fetched} / ${jobStatus.index.total}` : "\u2026"}
                              </span>
                            </>
                          ) : jobStatus?.fetch.status === "error" ? (
                            <>
                              <span className="text-destructive shrink-0">Fetch error: {jobStatus.fetch.error ?? "unknown"}</span>
                              <button
                                className="text-muted-foreground underline underline-offset-2 hover:text-foreground cursor-pointer shrink-0"
                                onClick={handleRetryFetch}
                                disabled={isRefreshing}
                                data-testid="button-banner-retry-fetch"
                              >
                                Retry
                              </button>
                            </>
                          ) : jobStatus?.index.status === "error" ? (
                            <>
                              <span className="text-destructive shrink-0">Index error: {jobStatus.index.error ?? "unknown"}</span>
                              <button
                                className="text-muted-foreground underline underline-offset-2 hover:text-foreground cursor-pointer shrink-0"
                                onClick={handleReindex}
                                disabled={isReindexing}
                                data-testid="button-banner-reindex"
                              >
                                Re-index
                              </button>
                            </>
                          ) : (
                            <>
                              <Check className="h-2.5 w-2.5 shrink-0" />
                              <span>Up to date</span>
                            </>
                          )}
                          <button
                            className="ml-auto text-muted-foreground/60 hover:text-muted-foreground cursor-pointer"
                            onClick={() => setJobStatusDismissed(true)}
                            data-testid="button-dismiss-job-banner"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmForceRefreshOpen(true)}
                    disabled={isRefreshing}
                    data-testid="button-refresh-items"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isRefreshing ? "animate-spin" : ""}`} />
                    Force Refresh
                  </Button>
                  {config?.source.type === "local" && (
                    <Button
                      variant={editMode ? "default" : "outline"}
                      size="sm"
                      onClick={() => setEditMode(!editMode)}
                      disabled={!itemsData}
                      data-testid="button-edit-items"
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      {editMode ? "Done" : "Edit Items"}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {refreshError && (
                <div
                  className="mx-4 mb-3 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-sm flex items-start gap-2"
                  data-testid="refresh-error-banner"
                >
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-destructive">
                      Failed to refresh &ldquo;{config?.name || dbName}&rdquo;
                    </p>
                    <p className="text-destructive/90 break-words mt-0.5">{refreshError}</p>
                  </div>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => setRefreshError(null)}
                    data-testid="button-dismiss-refresh-error"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {itemsLoading || rawItemsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-sm text-muted-foreground">
                    {search || Object.keys(tagFilters).length > 0
                      ? "No items match your search or filters."
                      : "No items returned from the datasource."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" data-testid="table-database-items">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        {editMode && <th className="px-2 py-2 w-20" />}
                        {columns.map((col) => (
                          <th
                            key={col}
                            className="px-3 py-2 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap"
                            onClick={() => !editMode && handleSort(col)}
                            data-testid={`th-sort-${col}`}
                            title={
                              col === "score"
                                ? "Qdrant cosine similarity (higher = closer meaning)"
                                : undefined
                            }
                          >
                            <span className="inline-flex items-center gap-1">
                              {col === "score" ? (
                                <span className="inline-flex items-center gap-1">
                                  <Sparkles className="h-3 w-3 text-orange-500" />
                                  score
                                </span>
                              ) : (
                                col
                              )}
                              {!editMode && sortKey === col ? (
                                sortDir === "asc" ? (
                                  <ChevronUp className="h-3 w-3" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" />
                                )
                              ) : !editMode ? (
                                <ArrowUpDown className="h-3 w-3 opacity-30" />
                              ) : null}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(editMode ? (itemsData?.items || []) : filteredItems).map((item, i) => {
                        const openItemEdit = () => {
                          const pageItems = itemsData?.items || [];
                          const pageIdx = pageItems.indexOf(item);
                          const localIdx = pageIdx >= 0 ? pageIdx : i;
                          setEditingItem(item);
                          setEditingItemIndex((page - 1) * PAGE_SIZE + localIdx);
                          setIsAddingItem(false);
                        };
                        return (
                        <tr
                          key={i}
                          className="border-b last:border-b-0 hover:bg-muted/30 cursor-pointer"
                          data-testid={`row-item-${i}`}
                          onClick={openItemEdit}
                        >
                          {editMode && (
                            <td className="px-2 py-1 whitespace-nowrap">
                              <div className="flex items-center gap-0.5">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openItemEdit();
                                  }}
                                  disabled={savingItems}
                                  data-testid={`button-edit-row-${i}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteConfirmIndex(i);
                                  }}
                                  disabled={savingItems}
                                  data-testid={`button-delete-row-${i}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </div>
                            </td>
                          )}
                          {columns.map((col) => {
                            const raw = item[col];
                            const display =
                              col === "score" && typeof raw === "number"
                                ? raw.toFixed(4)
                                : formatCellValue(raw);
                            return (
                            <td
                              key={col}
                              className={`px-3 py-2 max-w-[200px] truncate whitespace-nowrap ${
                                col === "score"
                                  ? "font-mono tabular-nums text-muted-foreground"
                                  : cellClassName(raw)
                              }`}
                              title={
                                col === "score" && typeof raw === "number"
                                  ? `Cosine similarity: ${raw}`
                                  : formatCellValue(raw)
                              }
                              data-testid={col === "score" ? `cell-score-${i}` : undefined}
                            >
                              {display}
                            </td>
                            );
                          })}
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {activeItems && activeItems.total_count > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-muted-foreground">
                  <span data-testid="text-pagination-info">
                    Page {activeItems.page} of {Math.ceil(activeItems.total_count / activeItems.limit)}{" "}
                    ({activeItems.total_count} total records)
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1 || itemsLoading || rawItemsLoading}
                      data-testid="button-page-prev"
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page >= Math.ceil(activeItems.total_count / activeItems.limit) || itemsLoading || rawItemsLoading}
                      data-testid="button-page-next"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={fnPreviewField !== null} onOpenChange={(v) => {
        if (!v) { setFnPreviewField(null); setFnTestResult(null); }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code className="h-4 w-4" />
              Computed field: <code className="font-mono text-sm">{fnPreviewField?.key}</code>
            </DialogTitle>
            <DialogDescription>
              This field's value is produced by a JavaScript function run on each item.
            </DialogDescription>
          </DialogHeader>
          <pre className="bg-muted rounded-md p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all leading-relaxed" data-testid="pre-fn-preview">
            {fnPreviewField?.fn ?? ""}
          </pre>
          {(() => {
            const rawItems = rawItemsData?.items ?? [];
            const key = fnPreviewField?.key ?? "";
            const runFn = () => {
              const fn = fnPreviewField?.fn ?? "";
              const rawItem = rawItems[fnTestItemIndex] ?? {};
              try {
                // eslint-disable-next-line no-new-func
                const result = new Function("__value__", "__item__", `return (${fn})(__value__, __item__)`)(fnTestInput, rawItem);
                setFnTestResult({ ok: true, output: result === undefined ? "undefined" : JSON.stringify(result) });
              } catch (err) {
                setFnTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
              }
            };
            return (
              <div className="space-y-2 pt-1 border-t">
                <p className="text-xs font-medium text-muted-foreground pt-2">Test the function</p>
                <div className="flex gap-2">
                  {fnCustomMode ? (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="shrink-0"
                        data-testid="button-fn-custom-back"
                        onClick={() => {
                          setFnCustomMode(false);
                          const sample = rawItems[fnTestItemIndex]?.[key];
                          setFnTestInput(sample != null ? String(sample) : "");
                          setFnTestResult(null);
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <input
                        autoFocus
                        className="flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="Type a custom value to test…"
                        value={fnTestInput}
                        onChange={(e) => { setFnTestInput(e.target.value); setFnTestResult(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runFn(); } }}
                        data-testid="input-fn-test-value"
                      />
                    </>
                  ) : rawItems.length > 0 ? (
                    <Select
                      value={String(fnTestItemIndex)}
                      onValueChange={(v) => {
                        if (v === "__custom__") {
                          setFnCustomMode(true);
                          setFnTestInput("");
                          setFnTestResult(null);
                          return;
                        }
                        const idx = parseInt(v, 10);
                        setFnTestItemIndex(idx);
                        const sample = rawItems[idx]?.[key];
                        setFnTestInput(sample != null ? String(sample) : "");
                        setFnTestResult(null);
                      }}
                    >
                      <SelectTrigger className="flex-1 h-8 text-xs font-mono" data-testid="select-fn-test-item">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {rawItems.slice(0, 3).map((item, i) => {
                          const slug = item["slug"] != null ? String(item["slug"]) : null;
                          const val = item[key];
                          const fieldPreview = val != null && String(val).trim() !== "" ? String(val) : null;
                          const label = slug ?? fieldPreview ?? "(no slug)";
                          const truncated = label.length > 40 ? label.slice(0, 40) + "…" : label;
                          return (
                            <SelectItem key={i} value={String(i)} className="text-xs font-mono">
                              <span className="text-muted-foreground mr-1.5">#{i + 1}</span>
                              {truncated}
                            </SelectItem>
                          );
                        })}
                        <SelectItem value="__custom__" className="text-xs">
                          Manual custom value
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <input
                      autoFocus
                      className="flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder="Type a value to test…"
                      value={fnTestInput}
                      onChange={(e) => { setFnTestInput(e.target.value); setFnTestResult(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runFn(); } }}
                      data-testid="input-fn-test-value"
                    />
                  )}
                  <Button size="sm" variant="secondary" data-testid="button-fn-test-run" onClick={runFn}>
                    <Play className="h-3.5 w-3.5 mr-1" />
                    Run
                  </Button>
                </div>
                {fnTestResult !== null && (
                  fnTestResult.ok ? (
                    <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2" data-testid="fn-test-result-ok">
                      <CircleCheck className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                      <code className="text-xs font-mono break-all">{fnTestResult.output}</code>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2" data-testid="fn-test-result-error">
                        <CircleX className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                        <code className="text-xs font-mono break-all text-destructive flex-1">{fnTestResult.error}</code>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={fnFixing}
                        data-testid="button-fn-fix-ai"
                        onClick={async () => {
                          if (!fnPreviewField || fnTestResult.ok) return;
                          setFnFixing(true);
                          try {
                            const rawItem = rawItems[fnTestItemIndex] ?? {};
                            const res = await fetch(`/api/databases/${dbName}/ai/fix-transform`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                fieldKey: fnPreviewField.key,
                                fnBody: fnPreviewField.fn,
                                errorMessage: fnTestResult.error,
                                sampleInput: fnTestInput || undefined,
                                sampleRawItem: Object.keys(rawItem).length > 0 ? rawItem : undefined,
                              }),
                            });
                            if (!res.ok) {
                              const err = await res.json().catch(() => ({}));
                              throw new Error((err as { error?: string }).error || "AI request failed");
                            }
                            const { fnBody: newFn } = await res.json() as { fnBody: string };
                            const newEncoded = "function:" + btoa(newFn);
                            const currentConfig = detail?.config;
                            if (!currentConfig) throw new Error("Config not loaded");
                            const updatedConfig = {
                              ...currentConfig,
                              field_mapping: {
                                ...currentConfig.field_mapping,
                                [fnPreviewField.key]: newEncoded,
                              },
                            };
                            const saveRes = await fetch(`/api/databases/${dbName}/config`, {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(updatedConfig),
                            });
                            if (!saveRes.ok) {
                              const err = await saveRes.json().catch(() => ({}));
                              throw new Error((err as { error?: string }).error || "Failed to save");
                            }
                            queryClient.invalidateQueries({ queryKey: ["/api/databases", dbName] });
                            setFnPreviewField({ key: fnPreviewField.key, fn: newFn });
                            setFnTestResult(null);
                            toast({ title: "New function body proposed" });
                          } catch (err) {
                            toast({ title: "AI fix failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
                          } finally {
                            setFnFixing(false);
                          }
                        }}
                      >
                        {fnFixing ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <Wand2 className="h-3.5 w-3.5 mr-1" />
                        )}
                        {fnFixing ? "Fixing…" : "Fix with AI"}
                      </Button>
                    </div>
                  )
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={healthDialogOpen} onOpenChange={setHealthDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col" data-testid="dialog-database-health">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {healthResult?.status === "passed" ? (
                <CircleCheck className="h-5 w-5 text-chart-3" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              )}
              Database Health — {dbName}
            </DialogTitle>
            <DialogDescription>
              {healthResult?.status === "passed"
                ? "No issues found. This database passed all health checks."
                : "Issues detected from cached job state and configuration (read-only check)."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 py-1">
            {healthResult?.status === "passed" && (
              <div className="p-3 rounded-md bg-chart-3/10 border border-chart-3/30 text-sm text-foreground">
                All checks passed.
              </div>
            )}
            {(healthResult?.errors.length ?? 0) > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-destructive">Errors</p>
                {healthResult!.errors.map((issue, i) => (
                  <div
                    key={`e-${i}`}
                    className="p-2 rounded-md bg-destructive/10 border border-destructive/30 text-sm"
                    data-testid={`health-error-${i}`}
                  >
                    <div className="flex items-start gap-2">
                      <CircleX className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        {issue.code && (
                          <span className="font-mono text-xs text-destructive">{issue.code}</span>
                        )}
                        <p className="text-foreground">{issue.message}</p>
                        {issue.suggestion && (
                          <p className="text-xs text-muted-foreground mt-1 italic">{issue.suggestion}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {(healthResult?.warnings.length ?? 0) > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-chart-2">Warnings</p>
                {healthResult!.warnings.map((issue, i) => (
                  <div
                    key={`w-${i}`}
                    className="p-2 rounded-md bg-chart-2/10 border border-chart-2/30 text-sm"
                    data-testid={`health-warning-${i}`}
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        {issue.code && (
                          <span className="font-mono text-xs text-chart-2">{issue.code}</span>
                        )}
                        <p className="text-foreground">{issue.message}</p>
                        {issue.suggestion && (
                          <p className="text-xs text-muted-foreground mt-1 italic">{issue.suggestion}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setHealthDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmForceRefreshOpen} onOpenChange={setConfirmForceRefreshOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Force Refresh — are you sure?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This will <strong className="text-foreground">bypass the cache</strong> and re-fetch all data for <strong className="text-foreground">{dbName}</strong> directly from the source API or file.
                </p>
                <p>This means:</p>
                <ul className="list-disc list-inside space-y-1 pl-1">
                  <li>A live request will be made to the configured data source.</li>
                  <li>The existing cached data will be replaced with the new response.</li>
                  {config?.editor && Object.values(config.editor).some((f: any) => f?.cache_images) && (
                    <li>Any fields with image caching enabled will re-download and re-store their images.</li>
                  )}
                  {hasSemanticSearch && (
                    <li>The semantic search index will be <strong className="text-foreground">rebuilt in the background</strong> — embeddings will be re-generated for all items. Search will fall back to keyword matching until it finishes.</li>
                  )}
                </ul>
                <p>Data is loaded automatically from cache on page open. Use Force Refresh only when you need to pull the latest data from the source.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmForceRefreshOpen(false)}
              data-testid="button-cancel-force-refresh"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => { setConfirmForceRefreshOpen(false); handleRefresh(); }}
              data-testid="button-confirm-force-refresh"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Force Refresh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleteConfirmIndex !== null && (
        <Dialog open onOpenChange={(v) => { if (!v) setDeleteConfirmIndex(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Item</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete item {deleteConfirmIndex + 1}? This will immediately save the file without this entry.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteConfirmIndex(null)}
                disabled={savingItems}
                data-testid="button-cancel-delete-item"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={savingItems}
                data-testid="button-confirm-delete-item"
                onClick={async () => {
                  const idx = deleteConfirmIndex;
                  setDeleteConfirmIndex(null);
                  setSavingItems(true);
                  try {
                    const res = await fetch(`/api/databases/${dbName}/items/${idx}`, {
                      method: "DELETE",
                    });
                    if (!res.ok) {
                      const err = await res.json();
                      throw new Error(err.error || "Failed to delete item");
                    }
                    await Promise.all([refetchItems(), refetchRawItems()]);
                    toast({ title: "Item deleted" });
                  } catch (err) {
                    toast({
                      title: "Error deleting item",
                      description: err instanceof Error ? err.message : String(err),
                      variant: "destructive",
                    });
                  } finally {
                    setSavingItems(false);
                  }
                }}
              >
                {savingItems ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                )}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {(editingItem !== null || isAddingItem) && (
        <ItemEditModal
          dbName={dbName}
          item={isAddingItem ? null : editingItem}
          allItems={itemsData?.items || []}
          onSave={async (builtItem) => {
            let res: Response;
            if (isAddingItem) {
              res = await fetch(`/api/databases/${dbName}/items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ item: builtItem }),
              });
            } else {
              res = await fetch(`/api/databases/${dbName}/items/${editingItemIndex}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(builtItem),
              });
            }
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error((err as { error?: string }).error || "Failed to save item");
            }
            void Promise.all([refetchItems(), refetchRawItems()]);
          }}
          onClose={() => {
            setEditingItem(null);
            setEditingItemIndex(null);
            setIsAddingItem(false);
          }}
        />
      )}
    </div>
  );
}

export default function PrivateDatabases() {
  const [, params] = useRoute("/private/databases/:name");
  const dbName = params?.name;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      {dbName ? (
        <DatabaseDetailView dbName={dbName} />
      ) : (
        <DatabaseList />
      )}
    </div>
  );
}
