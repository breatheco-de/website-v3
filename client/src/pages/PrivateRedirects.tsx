import { useState, useEffect, useRef, useCallback, lazy, Suspense, type ReactNode, type CSSProperties } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, CircleCheck, ExternalLink, FileText, GripVertical, Info, Pencil, Plus, Route, Search, ShieldCheck, TestTube, Trash2, Wrench, X } from "lucide-react";
import { getDebugUserName, useDebugAuth } from "@/hooks/useDebugAuth";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Link, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AddRedirectDialog, getApiErrorMessage, hasRegexChars } from "@/components/editing/AddRedirectDialog";
import { useToast } from "@/hooks/use-toast";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import {
  RedirectConflictResolverModal,
  parseRedirectConflict,
  useRedirectConflictResolver,
} from "@/components/RedirectConflictResolver";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";
import { formatSitePathsInText } from "@shared/formatSitePath";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const CustomRedirectsYmlEditorPanel = lazy(
  () => import("@/components/editing/CustomRedirectsYmlEditorPanel"),
);

const SKIP_DELETE_CONFIRM_KEY = "private-redirects-skip-delete-confirm-until";
const SKIP_DELETE_CONFIRM_MS = 5 * 60 * 1000;

function getSkipDeleteConfirmUntil(): number {
  try {
    const raw = sessionStorage.getItem(SKIP_DELETE_CONFIRM_KEY);
    const until = raw ? Number(raw) : 0;
    return Number.isFinite(until) ? until : 0;
  } catch {
    return 0;
  }
}

function setSkipDeleteConfirmUntil(until: number): void {
  try {
    sessionStorage.setItem(SKIP_DELETE_CONFIRM_KEY, String(until));
  } catch {
    /* ignore */
  }
}

interface Redirect {
  from: string;
  to: string | Record<string, string>;
  type: string;
  status: number;
  source: string;
  priority?: "before" | "fallback";
}

function formatRedirectTo(to: string | Record<string, string>): string {
  if (typeof to === "string") return to;
  return Object.values(to).join(", ");
}

function FullUrlHoverCard({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  return (
    <HoverCard openDelay={200} closeDelay={80}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        align="start"
        side="top"
        className="w-auto max-w-md p-3"
      >
        <code className="text-xs font-mono break-all whitespace-pre-wrap leading-relaxed">
          {url}
        </code>
      </HoverCardContent>
    </HoverCard>
  );
}

function isLocaleMap(
  to: string | Record<string, string>,
): to is Record<string, string> {
  return typeof to === "object";
}

function isCustomRedirect(redirect: { type?: string; source?: string }): boolean {
  if (redirect.type === "custom") return true;
  return /(?:^|\/)custom-redirects\.yml$/.test(redirect.source || "");
}

function redirectSortId(redirect: Redirect): string {
  const toKey =
    typeof redirect.to === "string" ? redirect.to : JSON.stringify(redirect.to);
  return `${redirect.from}=>${toKey}`;
}

function SortableRedirectRow({
  id,
  index,
  type,
  children,
}: {
  id: string;
  index: number;
  type: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : undefined,
    position: isDragging ? "relative" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50 transition-colors"
      data-testid={`redirect-row-${type}-${index}`}
    >
      <button
        type="button"
        className="touch-none cursor-grab active:cursor-grabbing flex-shrink-0 h-5 w-5 flex items-center justify-center text-muted-foreground"
        title="Drag to reorder"
        data-testid={`button-drag-${index}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}

interface ValidationIssue {
  type: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  suggestion?: string;
}

interface ValidationResult {
  name: string;
  description: string;
  status: "passed" | "failed" | "warning";
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  duration: number;
}

const FILE_ORDINALS = ["first", "second", "third", "fourth", "fifth"];

/** Button label for remove-from-file; disambiguates when basenames collide. */
function removeFromFileLabel(
  files: string[],
  index: number,
  formatPath: (filePath: string) => string,
): string {
  const basenames = files.map((f) => formatPath(f).split("/").pop() || f);
  const name = basenames[index] || "file";
  const duplicateCount = basenames.filter((b) => b === name).length;
  if (duplicateCount > 1) {
    const ordinalIndex =
      basenames.slice(0, index + 1).filter((b) => b === name).length - 1;
    const ordinal = FILE_ORDINALS[ordinalIndex] || `${ordinalIndex + 1}th`;
    return `Remove from ${ordinal} ${name}`;
  }
  return `Remove from ${name}`;
}

export default function PrivateRedirects() {
  const formatPath = useFormatSitePath();
  const { hasCapability } = useDebugAuth();
  const canEditRedirects = hasCapability("edit_redirects");
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showYamlEditor, setShowYamlEditor] = useState(false);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [validationExpanded, setValidationExpanded] = useState(false);

  const searchString = useSearch();
  const urlFromQuery = new URLSearchParams(searchString).get("url")?.trim() ?? "";
  const [testRedirectUrl, setTestRedirectUrl] = useState(urlFromQuery);
  const [testRedirectResult, setTestRedirectResult] = useState<{
    match: boolean;
    from?: string;
    resolvedTo?: string;
    status?: number;
    priority?: string;
    source?: string;
    matchType?: string;
    captureGroups?: string[];
    pageExists?: boolean;
    destinationExists?: boolean;
    live_content?: boolean;
    conflicts?: Array<{ kind: string; from: string; source?: string; message: string }>;
    fixes?: Array<{ id: string; kind: string; effect: string }>;
  } | null>(null);
  const [isTestingRedirect, setIsTestingRedirect] = useState(false);
  const [showRedirectsTestAdvanced, setShowRedirectsTestAdvanced] = useState(false);
  const testRedirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deletingRedirect, setDeletingRedirect] = useState<Redirect | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [dontAskAgainDelete, setDontAskAgainDelete] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editDraftRef = useRef("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const { toast } = useToast();
  const {
    resolveModalOpen,
    setResolveModalOpen,
    activeConflict,
    openResolver,
  } = useRedirectConflictResolver();

  const runValidation = useCallback(async () => {
    setIsValidating(true);
    setValidationExpanded(false);
    try {
      const res = await apiRequest("POST", "/api/validation/run/redirects");
      const data = await res.json();
      setValidationResult(data);
      if (data.status === "failed" || data.status === "warning") {
        setShowValidation(true);
      }
    } catch {
      setValidationResult(null);
    } finally {
      setIsValidating(false);
    }
  }, []);

  useEffect(() => {
    runValidation();
  }, [runValidation]);

  useEffect(() => {
    if (testRedirectTimer.current) clearTimeout(testRedirectTimer.current);
    const trimmed = testRedirectUrl.trim();
    if (!trimmed) {
      setTestRedirectResult(null);
      setIsTestingRedirect(false);
      return;
    }
    setIsTestingRedirect(true);
    const controller = new AbortController();
    testRedirectTimer.current = setTimeout(() => {
      fetch(`/api/debug/redirects/test?url=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data) => {
          setTestRedirectResult(data);
          setIsTestingRedirect(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setTestRedirectResult(null);
            setIsTestingRedirect(false);
          }
        });
    }, 300);
    return () => {
      if (testRedirectTimer.current) clearTimeout(testRedirectTimer.current);
      controller.abort();
    };
  }, [testRedirectUrl]);

  const { data: redirectsData, isLoading } = useQuery<{
    redirects: Redirect[];
  }>({
    queryKey: ["/api/debug/redirects"],
  });

  const redirects = redirectsData?.redirects || [];

  const filteredRedirects = redirects.filter((r) => {
    const q = search.toLowerCase();
    const toStr = formatRedirectTo(r.to).toLowerCase();
    return (
      r.from.toLowerCase().includes(q) ||
      toStr.includes(q) ||
      r.type.toLowerCase().includes(q) ||
      String(r.status).includes(q)
    );
  });

  const groupedByType = filteredRedirects.reduce(
    (acc, redirect) => {
      const normalizedType = redirect.type.replace(/-common$/, "");
      if (!acc[normalizedType]) {
        acc[normalizedType] = [];
      }
      acc[normalizedType].push(redirect);
      return acc;
    },
    {} as Record<string, Redirect[]>,
  );

  const totalIssues = validationResult
    ? validationResult.errors.length + validationResult.warnings.length
    : 0;

  const handleDeleteRedirect = async (redirect?: Redirect | null) => {
    const target = redirect ?? deletingRedirect;
    if (!target) return;

    setIsDeleting(true);
    try {
      await apiRequest("DELETE", "/api/debug/redirects", {
        from: target.from,
        source: target.source,
        author: getDebugUserName(),
      });

      if (dontAskAgainDelete) {
        setSkipDeleteConfirmUntil(Date.now() + SKIP_DELETE_CONFIRM_MS);
      }

      toast({
        title: "Redirect deleted",
        description: `${target.from} has been removed`,
      });

      setDeletingRedirect(null);
      setDontAskAgainDelete(false);
      queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
      runValidation();
    } catch (err) {
      toast({
        title: "Failed to delete redirect",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const requestDeleteRedirect = (redirect: Redirect) => {
    if (Date.now() < getSkipDeleteConfirmUntil()) {
      void handleDeleteRedirect(redirect);
      return;
    }
    setDontAskAgainDelete(false);
    setDeletingRedirect(redirect);
  };

  const [removingFrom, setRemovingFrom] = useState<string | null>(null);

  const removeIssueFromValidation = (redirectUrl: string) => {
    setValidationResult((prev) => {
      if (!prev) return prev;
      const matchesUrl = (issue: ValidationIssue) => issue.message.includes(`"${redirectUrl}"`);
      return {
        ...prev,
        errors: prev.errors.filter((e) => !matchesUrl(e)),
        warnings: prev.warnings.filter((w) => !matchesUrl(w)),
      };
    });
  };

  const handleRemoveFromFile = async (redirectUrl: string, source: string) => {
    const key = `${redirectUrl}::${source}`;
    setRemovingFrom(key);
    try {
      const res = await apiRequest("DELETE", "/api/debug/redirects", {
        from: redirectUrl,
        source,
        author: getDebugUserName(),
      });
      const data = await res.json();
      toast({ title: "Removed", description: data.message || `Removed from ${source}` });
      removeIssueFromValidation(redirectUrl);
      queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
    } catch (err) {
      toast({
        title: "Failed to remove",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setRemovingFrom(null);
    }
  };

  const handleRemoveFromBoth = async (redirectUrl: string, files: string[]) => {
    const key = `${redirectUrl}::both`;
    setRemovingFrom(key);
    try {
      for (const source of files) {
        await apiRequest("DELETE", "/api/debug/redirects", {
          from: redirectUrl,
          source,
          author: getDebugUserName(),
        });
      }
      toast({ title: "Removed from both", description: `Removed "${redirectUrl}" from all sources` });
      removeIssueFromValidation(redirectUrl);
      queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
    } catch (err) {
      toast({
        title: "Failed to remove",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setRemovingFrom(null);
    }
  };

  const handleTogglePriority = async (redirect: Redirect, targetPriority?: "before" | "fallback") => {
    const newPriority = targetPriority || (redirect.priority === "fallback" ? "before" : "fallback");
    if ((redirect.priority || "before") === newPriority) return;
    try {
      await apiRequest("PATCH", "/api/debug/redirects/priority", {
        from: redirect.from,
        priority: newPriority,
        author: getDebugUserName(),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
    } catch (err) {
      toast({
        title: "Failed to update priority",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const startInlineEdit = (redirect: Redirect, field: "from" | "to") => {
    if (!isCustomRedirect(redirect) || !hasRegexChars(redirect.from)) return;
    if (field === "to" && typeof redirect.to !== "string") return;
    const initial = field === "from" ? redirect.from : String(redirect.to);
    editDraftRef.current = initial;
    setEditDraft(initial);
    setEditingKey(`${redirect.from}::${field}`);
  };

  const cancelInlineEdit = () => {
    setEditingKey(null);
    editDraftRef.current = "";
    setEditDraft("");
  };

  const handleSaveInlineEdit = async (redirect: Redirect, field: "from" | "to") => {
    const trimmed = editDraftRef.current.trim();
    if (!trimmed) {
      toast({
        title: "Value required",
        description: "Pattern or destination cannot be empty",
        variant: "destructive",
      });
      return;
    }
    if (field === "from" && !hasRegexChars(trimmed)) {
      toast({
        title: "Invalid pattern",
        description: "Edited origin must remain a regex pattern",
        variant: "destructive",
      });
      return;
    }
    const current = field === "from" ? redirect.from : String(redirect.to);
    if (trimmed === current) {
      cancelInlineEdit();
      return;
    }

    setIsSavingEdit(true);
    try {
      await apiRequest("PATCH", "/api/debug/redirects", {
        from: redirect.from,
        ...(field === "from" ? { newFrom: trimmed } : { newTo: trimmed }),
        author: getDebugUserName(),
      });
      toast({
        title: "Redirect updated",
        description:
          field === "from"
            ? `${redirect.from} → ${trimmed}`
            : `${redirect.from} now points to ${trimmed}`,
      });
      cancelInlineEdit();
      await queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
    } catch (err) {
      toast({
        title: "Failed to update redirect",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleReorderCustomRedirect = async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const allCustomRedirects = redirects.filter((r) => isCustomRedirect(r));
    if (fromIndex >= allCustomRedirects.length || toIndex >= allCustomRedirects.length) {
      return;
    }
    const reordered = arrayMove(allCustomRedirects, fromIndex, toIndex);
    try {
      await apiRequest("PATCH", "/api/debug/redirects/reorder", {
        redirects: reordered.map((r) => ({
          from: r.from,
          to: r.to,
          status: r.status,
          priority: r.priority,
        })),
        author: getDebugUserName(),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
      toast({
        title: "Redirects reordered",
        description: "Custom redirect order has been saved.",
      });
    } catch (err) {
      toast({
        title: "Failed to reorder redirects",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const redirectSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleCustomRedirectDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const allCustomRedirects = redirects.filter((r) => isCustomRedirect(r));
    const oldIndex = allCustomRedirects.findIndex(
      (r) => redirectSortId(r) === String(active.id),
    );
    const newIndex = allCustomRedirects.findIndex(
      (r) => redirectSortId(r) === String(over.id),
    );
    if (oldIndex === -1 || newIndex === -1) return;
    void handleReorderCustomRedirect(oldIndex, newIndex);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="link-back-home"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold flex items-center gap-2">
                  <Route className="w-5 h-5" />
                  URL Redirects
                </h1>
                <p className="text-sm text-muted-foreground">
                  {redirects.length} redirect{redirects.length !== 1 ? "s" : ""}{" "}
                  configured
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {validationResult && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowValidation(!showValidation)}
                  data-testid="button-toggle-validation"
                >
                  {validationResult.status === "passed" ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Badge
                          variant="secondary"
                          className="gap-1 cursor-pointer bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                        >
                          <CircleCheck className="h-3.5 w-3.5" />
                          Passed
                        </Badge>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-64 text-sm"
                        side="bottom"
                        align="start"
                      >
                        <div className="space-y-2">
                          <p className="font-medium">All tests passed</p>
                          <p className="text-muted-foreground text-xs">
                            No redirect conflicts, loops, or self-redirects were
                            found. All redirects are properly configured and
                            pointing to valid destinations.
                          </p>
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : validationResult.status === "warning" ? (
                    <Badge variant="outline" className="gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {totalIssues} warning{totalIssues !== 1 ? "s" : ""}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {totalIssues} issue{totalIssues !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={runValidation}
                disabled={isValidating}
                title="Run validation"
                data-testid="button-run-validation"
              >
                {isValidating ? (
                  <div className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
                ) : (
                  <TestTube className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setShowSearch((prev) => {
                    if (prev) setSearch("");
                    return !prev;
                  })
                }
                data-testid="button-toggle-search"
              >
                <Search className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowYamlEditor(true)}
                data-testid="button-view-custom-redirects-yml"
              >
                <FileText className="h-3.5 w-3.5 mr-1" />
                View YAML
              </Button>
              <Button
                variant="outline"
                size="sm"
                asChild
                data-testid="button-view-runtime-404s"
              >
                <Link href="/private/diagnostics/runtime-issues">
                  <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                  404's
                </Link>
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowAddDialog(true)}
                disabled={!canEditRedirects}
                title={!canEditRedirects ? "You need the edit_redirects capability" : undefined}
                data-testid="button-add-redirect"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add redirect
              </Button>
            </div>
          </div>
        </div>
      </div>
      {showSearch && (
        <div
          className="border-b"
          style={{ background: "hsl(var(--muted-foreground) / 0.03)" }}
        >
          <div className="container mx-auto px-4 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search redirects..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                autoFocus
                data-testid="input-search-redirects"
              />
            </div>
          </div>
        </div>
      )}
      <div className="border-b" style={{ background: "hsl(var(--muted-foreground) / 0.03)" }}>
        <div className="container mx-auto px-4 py-3">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>
                Redirects take effect immediately — no server restart needed.
                Browsers cache 301 redirects aggressively, so test changes in an incognito window if a redirect seems stuck.
              </span>
            </div>
            <div className="space-y-1.5 text-xs text-muted-foreground" data-testid="redirects-test-how-it-works">
              <p className="text-foreground font-medium">How redirects work</p>
              <p>
                Rules live in <strong className="text-foreground font-medium">two stores</strong>: page{" "}
                <code className="text-[11px]">meta.redirects</code> (destination locale file) and{" "}
                <code className="text-[11px]">custom-redirects.yml</code>. Runtime has one{" "}
                <strong className="text-foreground font-medium">first-match winner</strong>; other matching rules show as conflicts below.
                Each locale has <strong className="text-foreground font-medium">one canonical homepage</strong>{" "}
                (e.g. <code className="text-[11px]">/en/home</code>, <code className="text-[11px]">/es/inicio</code>);
                bare <code className="text-[11px]">/</code>, <code className="text-[11px]">/en</code>,{" "}
                <code className="text-[11px]">/es</code>, and <code className="text-[11px]">/us</code> are aliases that may 301 there without an overwrite warning.
              </p>
              <button
                type="button"
                className="text-xs text-primary underline-offset-2 hover:underline"
                onClick={() => setShowRedirectsTestAdvanced((v) => !v)}
                data-testid="button-redirects-test-read-more"
              >
                {showRedirectsTestAdvanced ? "Hide advanced" : "Read more (advanced)"}
              </button>
              {showRedirectsTestAdvanced && (
                <ul className="list-disc pl-5 space-y-1 text-[11px]">
                  <li>
                    Page aliases: <code>{"{directory}/{slug}/{locale}.yml"}</code>{" "}
                    <code>meta.redirects</code> (dest locale only, not <code>_common.yml</code>)
                  </li>
                  <li>
                    Catch-alls / external dests: <code>site_&lt;name&gt;/custom-redirects.yml</code>
                  </li>
                  <li>
                    Overwrite warnings use <code>contentIndex.isKnownUrl</code> only (not the SEO sitemap).
                    Locale-home aliases are listed in <code>shared/public-app-routes.ts</code> (
                    <code>LOCALE_HOME_ALIASES</code>) and never count as live content.
                  </li>
                  <li>
                    After shipping routing changes, re-run site validation / clear diagnostics cache if old overwrite errors linger.
                  </li>
                </ul>
              )}
            </div>
            <div className="space-y-2">
              <div className="relative">
                <TestTube className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Test a URL — paste a full link or a path like /us/coding-bootcamp/some-article"
                  value={testRedirectUrl}
                  onChange={(e) => setTestRedirectUrl(e.target.value)}
                  className="pl-9 pr-8"
                  data-testid="input-test-redirect-url"
                />
                {testRedirectUrl && (
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setTestRedirectUrl("")}
                    data-testid="button-clear-test-url"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {!testRedirectUrl.trim() && !isTestingRedirect && (
                <p className="text-xs text-muted-foreground" data-testid="text-test-redirect-empty">
                  Paste a path — winner is first-match; other rules appear as conflicts.
                </p>
              )}
              {isTestingRedirect && (
                <p className="text-xs text-muted-foreground" data-testid="status-testing-redirect">Checking...</p>
              )}
              {!isTestingRedirect && testRedirectResult && (
                testRedirectResult.match ? (
                  <div className="rounded-md border p-3 space-y-2" data-testid="result-redirect-match">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant={testRedirectResult.destinationExists === false ? "destructive" : "secondary"}
                        className={`gap-1 ${testRedirectResult.destinationExists === false ? "" : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"}`}
                      >
                        {testRedirectResult.destinationExists === false ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : (
                          <CircleCheck className="h-3 w-3" />
                        )}
                        {testRedirectResult.destinationExists === false ? "Redirect found to a 404" : "Redirect found"}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-xs">
                        {testRedirectResult.status}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {testRedirectResult.priority}
                      </Badge>
                      {testRedirectResult.matchType === "regex" && (
                        <Badge variant="outline" className="text-xs font-mono">regex</Badge>
                      )}
                      {(testRedirectResult.conflicts ?? []).map((conflict, i) => (
                        <Badge
                          key={`${conflict.kind}-${i}`}
                          variant={conflict.kind === "overwrites_content" ? "destructive" : "secondary"}
                          className="text-xs"
                          data-testid={`chip-redirect-conflict-${conflict.kind}`}
                        >
                          {conflict.kind === "overwrites_content"
                            ? "Overwrites live URL"
                            : conflict.kind === "duplicate_from"
                              ? "Duplicate from"
                              : conflict.kind === "regex_shadowed"
                                ? "Shadowed regex"
                                : conflict.kind}
                        </Badge>
                      ))}
                    </div>
                    {(testRedirectResult.conflicts ?? []).some((c) => c.kind === "overwrites_content") && (
                      <div
                        className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive dark:text-red-300"
                        data-testid="banner-redirect-overwrites-content"
                      >
                        This path is both a redirect and a live content URL (
                        <code>contentIndex.isKnownUrl</code>). Locale-home aliases (
                        <code>/</code>, <code>/en</code>, <code>/es</code>, <code>/us</code>) do not trigger this —
                        they should 301 to the canonical homepage. First-match still 301s visitors away from the live page.
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground flex-shrink-0">Rule:</span>
                        <code className="bg-muted px-2 py-0.5 rounded truncate">{testRedirectResult.from}</code>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground flex-shrink-0">Destination:</span>
                        <code className="bg-muted px-2 py-0.5 rounded truncate">{testRedirectResult.resolvedTo}</code>
                        <a
                          href={testRedirectResult.resolvedTo}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-0.5 rounded hover:bg-muted flex-shrink-0"
                          data-testid="link-test-redirect-destination"
                        >
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </a>
                      </div>
                      {testRedirectResult.captureGroups && testRedirectResult.captureGroups.length > 0 && (
                        <div className="flex items-center gap-2 text-xs flex-wrap">
                          <span className="text-muted-foreground flex-shrink-0">Groups:</span>
                          {testRedirectResult.captureGroups.map((g, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-xs">
                              <span className="font-mono font-medium">${i + 1}</span>
                              <span className="text-muted-foreground">=</span>
                              <span>{g}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground flex-shrink-0">Source:</span>
                        <span className="text-muted-foreground">{formatPath(testRedirectResult.source || "")}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border p-3 space-y-1" data-testid="result-redirect-no-match">
                    {(() => {
                      let displayPath = testRedirectUrl.trim();
                      try {
                        if (/^https?:\/\//i.test(displayPath)) displayPath = new URL(displayPath).pathname;
                      } catch {}
                      displayPath = displayPath.split("?")[0].split("#")[0];
                      if (!displayPath.startsWith("/")) displayPath = "/" + displayPath;
                      return testRedirectResult.pageExists ? (
                        <>
                          <p className="text-xs text-muted-foreground">
                            No redirect matches — this URL loads an existing page directly.
                          </p>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground flex-shrink-0">Page:</span>
                            <code className="bg-muted px-2 py-0.5 rounded truncate">{displayPath}</code>
                            <a
                              href={displayPath}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-0.5 rounded hover:bg-muted flex-shrink-0"
                              data-testid="link-test-page-destination"
                            >
                              <ExternalLink className="h-3 w-3 text-muted-foreground" />
                            </a>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No redirect matches and no page exists at <code className="bg-muted px-1.5 py-0.5 rounded">{displayPath}</code> — visitors would see a 404.
                        </p>
                      );
                    })()}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
      {showValidation && validationResult && (
        <div
          className="border-b"
          style={{ background: "hsl(var(--muted-foreground) / 0.05)" }}
        >
          <div className="container mx-auto px-4 py-4">
            <button
              onClick={() => setValidationExpanded(!validationExpanded)}
              className="flex items-center gap-2 w-full text-left"
              data-testid="button-toggle-validation-details"
            >
              <ChevronRight
                className={`h-4 w-4 text-muted-foreground transition-transform ${validationExpanded ? "rotate-90" : ""}`}
              />
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Validation Results</span>
              <span className="text-xs text-muted-foreground">
                ({validationResult.duration}ms)
              </span>
              <div className="flex items-center gap-2 ml-auto">
                {totalIssues === 0 ? (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <CircleCheck className="h-3 w-3" />
                    All passed
                  </Badge>
                ) : (
                  <>
                    {validationResult.errors.length > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {validationResult.errors.length} error
                        {validationResult.errors.length !== 1 ? "s" : ""}
                      </Badge>
                    )}
                    {validationResult.warnings.length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {validationResult.warnings.length} warning
                        {validationResult.warnings.length !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </>
                )}
              </div>
            </button>
            {validationExpanded && (
              <div className="mt-3 space-y-2">
                {totalIssues === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md border text-sm">
                    <CircleCheck className="h-4 w-4 flex-shrink-0" />
                    All redirect checks passed. No conflicts, loops, or
                    self-redirects found.
                  </div>
                ) : (
                  <>
                    {validationResult.errors.map((issue, i) => {
                      const conflict = parseRedirectConflict(issue);
                      return (
                        <div
                          key={`err-${i}`}
                          className="flex items-start gap-3 px-3 py-2 rounded-md border bg-destructive/5 border-destructive/20"
                          data-testid={`validation-error-${i}`}
                        >
                          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="destructive" className="text-xs">
                                {issue.code}
                              </Badge>
                              {issue.file && (
                                <span className="text-xs text-muted-foreground truncate">
                                  {formatPath(issue.file || "")}
                                </span>
                              )}
                            </div>
                            <p className="text-sm mt-1">
                              {formatSitePathsInText(issue.message, formatPath)}
                            </p>
                            {issue.suggestion && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {formatSitePathsInText(issue.suggestion || "", formatPath)}
                              </p>
                            )}
                            {conflict && conflict.files.length >= 2 && (
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                {conflict.files.map((file, fi) => (
                                  <Button
                                    key={file}
                                    variant="outline"
                                    size="sm"
                                    className="text-xs gap-1.5"
                                    disabled={removingFrom !== null}
                                    onClick={() => handleRemoveFromFile(conflict.redirectUrl, file)}
                                    data-testid={`button-remove-from-${fi}-err-${i}`}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    {removingFrom === `${conflict.redirectUrl}::${file}`
                                      ? "Removing..."
                                      : removeFromFileLabel(conflict.files, fi, formatPath)}
                                  </Button>
                                ))}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs gap-1.5 text-destructive"
                                  disabled={removingFrom !== null}
                                  onClick={() => handleRemoveFromBoth(conflict.redirectUrl, conflict.files)}
                                  data-testid={`button-remove-both-err-${i}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                  {removingFrom === `${conflict.redirectUrl}::both` ? "Removing..." : "Remove from both"}
                                </Button>
                              </div>
                            )}
                            {conflict && conflict.files.length === 1 && (
                              <div className="flex items-center gap-2 mt-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs gap-1.5"
                                  disabled={removingFrom !== null}
                                  onClick={() => handleRemoveFromFile(conflict.redirectUrl, conflict.files[0])}
                                  data-testid={`button-remove-err-${i}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                  {removingFrom === `${conflict.redirectUrl}::${conflict.files[0]}`
                                    ? "Removing..."
                                    : removeFromFileLabel(conflict.files, 0, formatPath)}
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {validationResult.warnings.map((issue, i) => {
                      const conflict = parseRedirectConflict(issue);
                      return (
                        <div
                          key={`warn-${i}`}
                          className="flex items-start gap-3 px-3 py-2 rounded-md border"
                          style={{
                            background: "hsl(var(--muted-foreground) / 0.03)",
                          }}
                          data-testid={`validation-warning-${i}`}
                        >
                          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="secondary" className="text-xs">
                                {issue.code}
                              </Badge>
                              {issue.file && (
                                <span className="text-xs text-muted-foreground truncate">
                                  {formatPath(issue.file || "")}
                                </span>
                              )}
                            </div>
                            <p className="text-sm mt-1">
                              {formatSitePathsInText(issue.message, formatPath)}
                            </p>
                            {issue.suggestion && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {formatSitePathsInText(issue.suggestion || "", formatPath)}
                              </p>
                            )}
                            {conflict && conflict.files.length >= 2 && (
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                {conflict.files.map((file, fi) => (
                                  <Button
                                    key={file}
                                    variant="outline"
                                    size="sm"
                                    className="text-xs gap-1.5"
                                    disabled={removingFrom !== null}
                                    onClick={() => handleRemoveFromFile(conflict.redirectUrl, file)}
                                    data-testid={`button-remove-from-${fi}-warn-${i}`}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    {removingFrom === `${conflict.redirectUrl}::${file}`
                                      ? "Removing..."
                                      : removeFromFileLabel(conflict.files, fi, formatPath)}
                                  </Button>
                                ))}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs gap-1.5 text-destructive"
                                  disabled={removingFrom !== null}
                                  onClick={() => handleRemoveFromBoth(conflict.redirectUrl, conflict.files)}
                                  data-testid={`button-remove-both-warn-${i}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                  {removingFrom === `${conflict.redirectUrl}::both` ? "Removing..." : "Remove from both"}
                                </Button>
                              </div>
                            )}
                            {conflict && conflict.files.length === 1 && (
                              <div className="flex items-center gap-2 mt-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs gap-1.5"
                                  disabled={removingFrom !== null}
                                  onClick={() => handleRemoveFromFile(conflict.redirectUrl, conflict.files[0])}
                                  data-testid={`button-remove-warn-${i}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                  {removingFrom === `${conflict.redirectUrl}::${conflict.files[0]}`
                                    ? "Removing..."
                                    : removeFromFileLabel(conflict.files, 0, formatPath)}
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="container mx-auto px-4 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
          </div>
        ) : filteredRedirects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {search
                ? "No redirects match your search"
                : "No redirects configured"}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {Object.entries(groupedByType).map(([type, typeRedirects]) => {
              const isExpanded = expandedType === type;
              return (
                <div key={type}>
                  <button
                    onClick={() => setExpandedType(isExpanded ? null : type)}
                    className="flex items-center gap-3 w-full px-4 py-3 rounded-md text-sm hover-elevate"
                    data-testid={`button-toggle-${type}`}
                  >
                    <ChevronRight
                      className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    />
                    <Badge variant="secondary">{type}</Badge>
                    <span className="text-muted-foreground font-normal text-sm">
                      {typeRedirects.length} redirect
                      {typeRedirects.length !== 1 ? "s" : ""}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="ml-4 mt-1 border rounded-lg divide-y">
                      {(() => {
                        const canReorder = typeRedirects.some((r) =>
                          isCustomRedirect(r),
                        );
                        const rows = typeRedirects.map((redirect, index) => {
                        const isCustom = isCustomRedirect(redirect);
                        const isEditableRegex =
                          isCustom && hasRegexChars(redirect.from);
                        const editingFrom = editingKey === `${redirect.from}::from`;
                        const editingTo = editingKey === `${redirect.from}::to`;
                        const rowBody = (
                          <>
                            <div className="flex-1 min-w-0 flex items-center gap-1.5">
                              {editingFrom ? (
                                <div className="flex items-center gap-1 flex-1 min-w-0">
                                  <Input
                                    value={editDraft}
                                    onChange={(e) => {
                                      editDraftRef.current = e.target.value;
                                      setEditDraft(e.target.value);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        void handleSaveInlineEdit(redirect, "from");
                                      } else if (e.key === "Escape") {
                                        cancelInlineEdit();
                                      }
                                    }}
                                    disabled={isSavingEdit}
                                    autoFocus
                                    className="h-7 text-xs font-mono flex-1"
                                    data-testid={`input-edit-from-${type}-${index}`}
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 flex-shrink-0"
                                    disabled={isSavingEdit}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => void handleSaveInlineEdit(redirect, "from")}
                                    title="Save"
                                    data-testid={`button-save-from-${type}-${index}`}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 flex-shrink-0"
                                    disabled={isSavingEdit}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={cancelInlineEdit}
                                    title="Cancel"
                                    data-testid={`button-cancel-from-${type}-${index}`}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : isEditableRegex ? (
                                <FullUrlHoverCard url={redirect.from}>
                                  <button
                                    type="button"
                                    className="text-xs bg-muted px-2 py-1 rounded truncate text-left min-w-0 max-w-full cursor-pointer hover:ring-1 hover:ring-ring inline-flex items-center gap-1.5"
                                    onClick={() => startInlineEdit(redirect, "from")}
                                    data-testid={`code-from-${type}-${index}`}
                                  >
                                    <code className="font-mono truncate">{redirect.from}</code>
                                    <Pencil className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                  </button>
                                </FullUrlHoverCard>
                              ) : (
                                <FullUrlHoverCard url={redirect.from}>
                                  <code className="text-xs bg-muted px-2 py-1 rounded block truncate cursor-default">
                                    {redirect.from}
                                  </code>
                                </FullUrlHoverCard>
                              )}
                              {hasRegexChars(redirect.from) && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0 font-mono">
                                  regex
                                </Badge>
                              )}
                              {isCustom ? (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      className="flex-shrink-0"
                                      data-testid={`button-toggle-priority-${index}`}
                                    >
                                      <Badge
                                        variant="outline"
                                        className={`text-[10px] px-1.5 py-0 cursor-pointer gap-0.5 ${
                                          redirect.priority === "fallback"
                                            ? "bg-primary/10"
                                            : ""
                                        }`}
                                      >
                                        {redirect.priority === "fallback" && (
                                          <AlertTriangle className="h-2.5 w-2.5" />
                                        )}
                                        {redirect.priority === "fallback" ? "fallback" : "before"}
                                      </Badge>
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-72 p-0" align="start" side="bottom">
                                    <div className="p-3 space-y-2">
                                      <p className="text-xs font-medium">When should this redirect apply?</p>
                                      <div className="flex border rounded-md overflow-hidden">
                                        {[
                                          {
                                            value: "before" as const,
                                            label: "Before",
                                            desc: "Always redirects, even if a real page exists at this URL.",
                                          },
                                          {
                                            value: "fallback" as const,
                                            label: "Fallback",
                                            desc: "Only redirects if no real page matches. Real pages take priority.",
                                          },
                                        ].map((option, i) => (
                                          <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => handleTogglePriority(redirect, option.value)}
                                            className={`flex-1 text-left p-2.5 transition-colors ${
                                              i > 0 ? "border-l" : ""
                                            } ${
                                              (redirect.priority || "before") === option.value
                                                ? "bg-primary/15"
                                                : "hover-elevate"
                                            }`}
                                            data-testid={`button-inline-priority-${option.value}-${index}`}
                                          >
                                            <span className="text-xs font-medium">{option.label}</span>
                                            <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                                              {option.desc}
                                            </p>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              ) : redirect.priority === "fallback" ? (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0 gap-0.5">
                                  <AlertTriangle className="h-2.5 w-2.5" />
                                  fallback
                                </Badge>
                              ) : null}
                            </div>
                            <Badge
                              variant={
                                redirect.status === 301 || redirect.status === 308
                                  ? "secondary"
                                  : "outline"
                              }
                              className="text-xs flex-shrink-0 font-mono"
                            >
                              {redirect.status}
                            </Badge>
                            <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <div className="flex-1 min-w-0 flex items-center gap-2">
                              {isLocaleMap(redirect.to) ? (
                                <div className="flex-1 min-w-0 space-y-1">
                                  {Object.entries(redirect.to).map(
                                    ([locale, url]) => (
                                      <div
                                        key={locale}
                                        className="flex items-center gap-1.5"
                                      >
                                        <LocaleFlag locale={locale} />
                                        <FullUrlHoverCard url={url}>
                                          <code className="text-xs bg-muted px-2 py-0.5 rounded truncate flex-1 cursor-default">
                                            {url}
                                          </code>
                                        </FullUrlHoverCard>
                                        <a
                                          href={url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="p-0.5 rounded hover:bg-muted flex-shrink-0"
                                          data-testid={`link-redirect-target-${type}-${index}-${locale}`}
                                        >
                                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                        </a>
                                      </div>
                                    ),
                                  )}
                                </div>
                              ) : editingTo ? (
                                <div className="flex items-center gap-1 flex-1 min-w-0">
                                  <Input
                                    value={editDraft}
                                    onChange={(e) => {
                                      editDraftRef.current = e.target.value;
                                      setEditDraft(e.target.value);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        void handleSaveInlineEdit(redirect, "to");
                                      } else if (e.key === "Escape") {
                                        cancelInlineEdit();
                                      }
                                    }}
                                    disabled={isSavingEdit}
                                    autoFocus
                                    className="h-7 text-xs font-mono flex-1"
                                    data-testid={`input-edit-to-${type}-${index}`}
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 flex-shrink-0"
                                    disabled={isSavingEdit}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => void handleSaveInlineEdit(redirect, "to")}
                                    title="Save"
                                    data-testid={`button-save-to-${type}-${index}`}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 flex-shrink-0"
                                    disabled={isSavingEdit}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={cancelInlineEdit}
                                    title="Cancel"
                                    data-testid={`button-cancel-to-${type}-${index}`}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : (
                                <>
                                  {isEditableRegex ? (
                                    <FullUrlHoverCard url={redirect.to as string}>
                                      <button
                                        type="button"
                                        className="text-xs bg-muted px-2 py-1 rounded truncate text-left flex-1 min-w-0 cursor-pointer hover:ring-1 hover:ring-ring inline-flex items-center gap-1.5"
                                        onClick={() => startInlineEdit(redirect, "to")}
                                        data-testid={`code-to-${type}-${index}`}
                                      >
                                        <code className="font-mono truncate">{redirect.to as string}</code>
                                        <Pencil className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                      </button>
                                    </FullUrlHoverCard>
                                  ) : (
                                    <FullUrlHoverCard url={String(redirect.to)}>
                                      <code className="text-xs bg-muted px-2 py-1 rounded block truncate flex-1 cursor-default">
                                        {redirect.to}
                                      </code>
                                    </FullUrlHoverCard>
                                  )}
                                  {!/\$\d/.test(redirect.to as string) && !hasRegexChars(redirect.to as string) && (
                                    <a
                                      href={redirect.to as string}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="p-1 rounded hover:bg-muted flex-shrink-0"
                                      title="Open target URL"
                                      data-testid={`link-redirect-target-${type}-${index}`}
                                    >
                                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                                    </a>
                                  )}
                                </>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="flex-shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => requestDeleteRedirect(redirect)}
                              title="Delete redirect"
                              data-testid={`button-delete-redirect-${type}-${index}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        );

                        if (isCustom && canReorder) {
                          return (
                            <SortableRedirectRow
                              key={redirectSortId(redirect)}
                              id={redirectSortId(redirect)}
                              index={index}
                              type={type}
                            >
                              {rowBody}
                            </SortableRedirectRow>
                          );
                        }

                        return (
                          <div
                            key={`${redirect.from}-${index}`}
                            className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50 transition-colors"
                            data-testid={`redirect-row-${type}-${index}`}
                          >
                            {rowBody}
                          </div>
                        );
                      });

                        if (!canReorder) return rows;

                        return (
                          <DndContext
                            sensors={redirectSensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleCustomRedirectDragEnd}
                          >
                            <SortableContext
                              items={typeRedirects
                                .filter((r) => isCustomRedirect(r))
                                .map(redirectSortId)}
                              strategy={verticalListSortingStrategy}
                            >
                              {rows}
                            </SortableContext>
                          </DndContext>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <AddRedirectDialog
        key={showAddDialog ? "open" : "closed"}
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSuccess={runValidation}
      />
      <Dialog
        open={!!deletingRedirect}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingRedirect(null);
            setDontAskAgainDelete(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete Redirect</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this redirect? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          {deletingRedirect && (
            <div className="min-w-0 space-y-3 py-2">
              <div className="min-w-0 rounded-md border p-3 space-y-2 overflow-hidden">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">From</p>
                  <code className="text-xs bg-muted px-2 py-1 rounded block min-w-0 max-w-full truncate" title={deletingRedirect.from}>
                    {deletingRedirect.from}
                  </code>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">To</p>
                  {isLocaleMap(deletingRedirect.to) ? (
                    <div className="space-y-1 min-w-0">
                      {Object.entries(deletingRedirect.to).map(
                        ([locale, url]) => (
                          <div
                            key={locale}
                            className="flex min-w-0 items-center gap-1.5"
                          >
                            <LocaleFlag locale={locale} />
                            <code className="text-xs bg-muted px-2 py-0.5 rounded min-w-0 flex-1 truncate" title={url}>
                              {url}
                            </code>
                          </div>
                        ),
                      )}
                    </div>
                  ) : (
                    <code className="text-xs bg-muted px-2 py-1 rounded block min-w-0 max-w-full truncate" title={String(deletingRedirect.to)}>
                      {deletingRedirect.to}
                    </code>
                  )}
                </div>
              </div>
              <label
                className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none"
                data-testid="label-dont-ask-again-delete"
              >
                <Checkbox
                  checked={dontAskAgainDelete}
                  onCheckedChange={(checked) =>
                    setDontAskAgainDelete(checked === true)
                  }
                  data-testid="checkbox-dont-ask-again-delete"
                />
                Don&apos;t ask again for 5 min
              </label>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeletingRedirect(null);
                setDontAskAgainDelete(false);
              }}
              disabled={isDeleting}
              data-testid="button-cancel-delete"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleDeleteRedirect()}
              disabled={isDeleting}
              data-testid="button-confirm-delete"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RedirectConflictResolverModal
        open={resolveModalOpen}
        onOpenChange={setResolveModalOpen}
        conflict={activeConflict}
        onResolved={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
          runValidation();
        }}
      />
      {showYamlEditor && (
        <Suspense fallback={null}>
          <CustomRedirectsYmlEditorPanel
            onClose={() => setShowYamlEditor(false)}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
              runValidation();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
