import { useState } from "react";
import { Check, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getDebugUserName } from "@/hooks/useDebugAuth";
import {
  formatSitePath,
  formatSitePathSpaced,
  isContentFilePath,
  toContentFileRef,
} from "@shared/formatSitePath";

export interface RedirectConflictInfo {
  redirectUrl: string;
  files: string[];
  code: string;
}

export interface FixHint {
  type: "api" | "script" | "llm" | "manual";
  label: string;
  fixerName?: string;
  command?: string;
  promptTemplate?: string;
  url?: string;
}

export interface ValidatorIssue {
  type: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  suggestion?: string;
  fix?: FixHint;
}

/** Legacy messages embedded absolute/site-prefixed paths ending in .yml". */
const LEGACY_CONTENT_FILE_IN_MESSAGE_RE =
  /"([^"]*(?:site_[^/]+|4geeks-com|content|marketing-content)\/[^"]+\.ya?ml)"/g;

/** Strip optional " (live)" suffix from redirect validator claimant labels. */
export function stripLiveRedirectLabel(raw: string): string {
  return raw.replace(/\s*\(live\)\s*$/i, "").trim();
}

function normalizeClaimantRef(rawPath: string): string | null {
  const stripped = stripLiveRedirectLabel(rawPath);
  if (!stripped || !isContentFilePath(stripped)) return null;
  return toContentFileRef(stripped);
}

/** Dedupe by display path (after site folder); prefer site_-prefixed refs for API deletes. */
function pushUniqueFile(files: string[], rawPath: string): void {
  const ref = normalizeClaimantRef(rawPath);
  if (!ref) return;
  const display = formatSitePath(ref);
  const existingIdx = files.findIndex((f) => formatSitePath(f) === display);
  if (existingIdx < 0) {
    files.push(ref);
    return;
  }
  const existing = files[existingIdx]!;
  // Prefer cwd-relative path that still includes the site folder prefix.
  const refHasSite = /(?:^|\/)(?:site_[^/]+|4geeks-com|content|marketing-content)\//.test(ref);
  const existingHasSite = /(?:^|\/)(?:site_[^/]+|4geeks-com|content|marketing-content)\//.test(existing);
  if (refHasSite && !existingHasSite) {
    files[existingIdx] = ref;
  }
}

/** Collect claimant file paths from a REDIRECT_CONFLICT / REDIRECT_OVERLAP message. */
export function extractRedirectClaimantPaths(message: string): string[] {
  const files: string[] = [];

  const claimed = message.match(/claimed by both "([^"]+)" and "([^"]+)"/);
  if (claimed) {
    pushUniqueFile(files, claimed[1]!);
    pushUniqueFile(files, claimed[2]!);
  }

  const existsInBoth = message.match(/exists in both "([^"]+)" and "([^"]+)"/);
  if (existsInBoth) {
    pushUniqueFile(files, existsInBoth[1]!);
    pushUniqueFile(files, existsInBoth[2]!);
  }

  const conflicts = message.match(/conflicts with "([^"]+)"/);
  if (conflicts) {
    pushUniqueFile(files, conflicts[1]!);
  }

  // Older absolute / site-prefixed messages (no " (live)" suffix).
  if (files.length === 0) {
    const legacy = message.match(LEGACY_CONTENT_FILE_IN_MESSAGE_RE);
    if (legacy) {
      for (const m of legacy) {
        pushUniqueFile(files, m.replace(/"/g, ""));
      }
    }
  }

  return files;
}

export function parseRedirectConflict(issue: ValidatorIssue): RedirectConflictInfo | null {
  const codes = ["REDIRECT_CONFLICT", "REDIRECT_OVERLAP", "SELF_REDIRECT", "REDIRECT_OVERWRITES_CONTENT"];
  if (!codes.includes(issue.code)) return null;

  let redirectUrl = "";
  const files: string[] = [];

  if (issue.code === "REDIRECT_CONFLICT" || issue.code === "REDIRECT_OVERLAP") {
    const urlMatch = issue.message.match(/"(\/[^"]*)"/);
    if (urlMatch) redirectUrl = urlMatch[1]!;
    for (const f of extractRedirectClaimantPaths(issue.message)) {
      if (!files.includes(f)) files.push(f);
    }
    if (issue.file) pushUniqueFile(files, issue.file);
    if (issue.code === "REDIRECT_OVERLAP" && !files.some((f) => f.includes("_common.yml"))) {
      const localeFile = files.find((f) => !f.includes("_common.yml"));
      if (localeFile) {
        const dir = localeFile.substring(0, localeFile.lastIndexOf("/"));
        if (dir) files.unshift(`${dir}/_common.yml`);
      }
    }
  } else if (issue.code === "SELF_REDIRECT") {
    const urlMatch = issue.message.match(/"(\/[^"]*)"/);
    if (urlMatch) redirectUrl = urlMatch[1]!;
    if (issue.file) pushUniqueFile(files, issue.file);
  } else if (issue.code === "REDIRECT_OVERWRITES_CONTENT") {
    const urlMatch = issue.message.match(/"(\/[^"]*)"/);
    if (urlMatch) redirectUrl = urlMatch[1]!;
    if (issue.file) pushUniqueFile(files, issue.file);
  }

  if (!redirectUrl) return null;
  return { redirectUrl, files, code: issue.code };
}

function getConflictTitle(code: string): string {
  switch (code) {
    case "REDIRECT_CONFLICT": return "Redirect Conflict";
    case "REDIRECT_OVERLAP": return "Duplicate Redirect";
    case "SELF_REDIRECT": return "Self-Redirect";
    case "REDIRECT_OVERWRITES_CONTENT": return "Redirect Overwrites Content";
    default: return "Redirect Issue";
  }
}

function formatFilePath(f: string): string {
  return formatSitePathSpaced(stripLiveRedirectLabel(f));
}

/** "Keep in …" label; uses full site-relative path so sibling en.yml files stay distinct. */
export function keepInFileLabel(files: string[], index: number): string {
  const formatted = files.map((f) => formatSitePath(stripLiveRedirectLabel(f)));
  const path = formatted[index] || "file";
  const basenames = formatted.map((p) => p.split("/").pop() || p);
  const base = basenames[index] || "file";
  const duplicateCount = basenames.filter((b) => b === base).length;
  // Prefer the full relative path whenever it has more than the basename.
  if (path.includes("/")) {
    return `Keep in ${path.split("/").join(" / ")}`;
  }
  if (duplicateCount > 1) {
    const ordinalIndex =
      basenames.slice(0, index + 1).filter((b) => b === base).length - 1;
    const ordinals = ["first", "second", "third", "fourth", "fifth"];
    const ordinal = ordinals[ordinalIndex] || `${ordinalIndex + 1}th`;
    return `Keep in ${ordinal} ${base}`;
  }
  return `Keep in ${path}`;
}

function getConflictDescription(info: RedirectConflictInfo): string {
  switch (info.code) {
    case "REDIRECT_CONFLICT":
      return "Two pages claim this same redirect. Choose which one should keep it.";
    case "REDIRECT_OVERLAP":
      return "This redirect is defined in both _common.yml and a locale file. Keep it in only one place.";
    case "SELF_REDIRECT":
      return "This redirect points back to itself, creating a loop. It should be removed.";
    case "REDIRECT_OVERWRITES_CONTENT":
      return "This redirect is hiding an existing page. Remove it so visitors can see the page.";
    default:
      return "There's an issue with this redirect.";
  }
}

interface ConfirmationWarning {
  action: string;
  result: string;
}

function getConfirmationWarning(conflict: RedirectConflictInfo, selectedFile: string): ConfirmationWarning {
  switch (conflict.code) {
    case "REDIRECT_CONFLICT": {
      const removedFile = conflict.files.find(f => f !== selectedFile);
      return {
        action: `Remove from "${formatFilePath(removedFile || "")}"`,
        result: `Kept in "${formatFilePath(selectedFile)}"`,
      };
    }
    case "REDIRECT_OVERLAP": {
      const removedFile = selectedFile.includes("_common.yml")
        ? conflict.files.find(f => !f.includes("_common.yml"))
        : conflict.files.find(f => f.includes("_common.yml"));
      return {
        action: `Remove duplicate from "${formatFilePath(removedFile || "")}"`,
        result: `Stays in "${formatFilePath(selectedFile)}"`,
      };
    }
    case "SELF_REDIRECT":
      return {
        action: `Remove self-redirect from "${formatFilePath(selectedFile)}"`,
        result: "The URL will load normally",
      };
    case "REDIRECT_OVERWRITES_CONTENT":
      return {
        action: `Remove redirect from "${formatFilePath(selectedFile)}"`,
        result: "The page will be visible again",
      };
    default:
      return {
        action: `Remove from "${formatFilePath(selectedFile)}"`,
        result: "The redirect will no longer apply",
      };
  }
}

export function RedirectConflictResolverModal({
  open,
  onOpenChange,
  conflict,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflict: RedirectConflictInfo | null;
  onResolved: () => void;
}) {
  const { toast } = useToast();
  const [resolving, setResolving] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ fileToRemove: string; keepFile: string } | null>(null);

  const handleResolve = async (fileToRemoveFrom: string) => {
    if (!conflict) return;
    setResolving(true);
    try {
      const res = await apiRequest("DELETE", "/api/debug/redirects", {
        from: conflict.redirectUrl,
        source: fileToRemoveFrom,
        author: getDebugUserName(),
      });
      const result = await res.json();
      if (result.success) {
        toast({ title: "Resolved", description: result.message });
        setPendingAction(null);
        onOpenChange(false);
        onResolved();
      } else {
        toast({ title: "Error", description: result.error || "Failed to resolve", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to resolve conflict", variant: "destructive" });
    } finally {
      setResolving(false);
    }
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) setPendingAction(null);
    onOpenChange(isOpen);
  };

  if (!conflict) return null;

  const isSimpleRemoval = conflict.code === "SELF_REDIRECT" || conflict.code === "REDIRECT_OVERWRITES_CONTENT";
  const isConflict = conflict.code === "REDIRECT_CONFLICT";
  const isOverlap = conflict.code === "REDIRECT_OVERLAP";

  const commonFile = conflict.files.find(f => f.includes("_common.yml"));
  const localeFiles = conflict.files.filter(f => !f.includes("_common.yml"));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" style={{ borderRadius: "0.8rem" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            {getConflictTitle(conflict.code)}
          </DialogTitle>
          <DialogDescription>
            {getConflictDescription(conflict)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground mb-1">Redirect URL</p>
            <p className="text-sm font-mono text-foreground break-all">{conflict.redirectUrl}</p>
          </div>

          {!pendingAction && (
            <>
              {isSimpleRemoval && conflict.files.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {conflict.code === "SELF_REDIRECT"
                      ? "Remove this self-redirect:"
                      : "Remove this redirect so the page remains accessible:"}
                  </p>
                  <Button
                    className="w-full h-auto min-h-9 justify-start gap-2 py-2"
                    variant="outline"
                    onClick={() => setPendingAction({ fileToRemove: conflict.files[0], keepFile: "" })}
                    disabled={resolving}
                    data-testid="button-resolve-remove"
                    title={formatFilePath(conflict.files[0])}
                  >
                    <X className="h-4 w-4 text-destructive flex-shrink-0" />
                    <span className="min-w-0 text-left break-all">Remove from {formatFilePath(conflict.files[0])}</span>
                  </Button>
                </div>
              )}

              {isConflict && conflict.files.length >= 2 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Choose which file should keep this redirect:</p>
                  {conflict.files.map((file, index) => {
                    const otherFile = conflict.files.find(f => f !== file);
                    const label = keepInFileLabel(conflict.files, index);
                    return (
                      <Button
                        key={`${file}-${index}`}
                        className="w-full h-auto min-h-9 justify-start gap-2 py-2"
                        variant="outline"
                        onClick={() => {
                          if (otherFile) setPendingAction({ fileToRemove: otherFile, keepFile: file });
                        }}
                        disabled={resolving}
                        data-testid={`button-keep-${index}`}
                        title={formatFilePath(file)}
                      >
                        <Check className="h-4 w-4 text-chart-3 flex-shrink-0" />
                        <span className="min-w-0 text-left break-all">{label}</span>
                      </Button>
                    );
                  })}
                </div>
              )}

              {isOverlap && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Where should this redirect live?</p>
                  {commonFile && (
                    <Button
                      className="w-full h-auto min-h-9 justify-start gap-2 py-2"
                      variant="outline"
                      onClick={() => {
                        if (localeFiles.length > 0) setPendingAction({ fileToRemove: localeFiles[0], keepFile: commonFile });
                      }}
                      disabled={resolving || localeFiles.length === 0}
                      data-testid="button-keep-common"
                    >
                      <Check className="h-4 w-4 text-chart-3 flex-shrink-0" />
                      <span className="min-w-0 text-left break-all">Keep in _common.yml (all languages)</span>
                    </Button>
                  )}
                  {localeFiles.map((file, localeIndex) => (
                    <Button
                      key={`${file}-${localeIndex}`}
                      className="w-full h-auto min-h-9 justify-start gap-2 py-2"
                      variant="outline"
                      onClick={() => {
                        if (commonFile) setPendingAction({ fileToRemove: commonFile, keepFile: file });
                      }}
                      disabled={resolving || !commonFile}
                      data-testid={`button-keep-locale-${localeIndex}`}
                      title={formatFilePath(file)}
                    >
                      <Check className="h-4 w-4 text-chart-3 flex-shrink-0" />
                      <span className="min-w-0 text-left break-all">
                        {keepInFileLabel(localeFiles, localeIndex)} only
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}

          {pendingAction && (
            <div className="space-y-3">
              {(() => {
                const warning = getConfirmationWarning(conflict, pendingAction.keepFile || pendingAction.fileToRemove);
                return (
                  <div className="rounded-md border border-chart-5/30 bg-chart-5/10 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap mt-px">Action:</span>
                      <span className="text-sm text-foreground">{warning.action}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap mt-px">Result:</span>
                      <span className="text-sm text-foreground">{warning.result}</span>
                    </div>
                    {pendingAction.keepFile && (
                      <p className="text-xs text-muted-foreground pt-1 border-t border-chart-5/20">
                        {conflict.redirectUrl} → {formatFilePath(pendingAction.keepFile)}
                      </p>
                    )}
                  </div>
                );
              })()}
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setPendingAction(null)}
                  disabled={resolving}
                  data-testid="button-back-options"
                >
                  Back
                </Button>
                <Button
                  variant="default"
                  onClick={() => handleResolve(pendingAction.fileToRemove)}
                  disabled={resolving}
                  data-testid="button-apply-resolve"
                  className="flex-1"
                >
                  {resolving ? "Applying..." : "Apply"}
                </Button>
              </div>
            </div>
          )}
        </div>

        {!pendingAction && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => handleClose(false)} disabled={resolving} data-testid="button-cancel-resolve">
              Cancel
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function useRedirectConflictResolver() {
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [activeConflict, setActiveConflict] = useState<RedirectConflictInfo | null>(null);

  const openResolver = (issue: ValidatorIssue) => {
    const conflict = parseRedirectConflict(issue);
    if (conflict) {
      setActiveConflict(conflict);
      setResolveModalOpen(true);
    }
  };

  return {
    resolveModalOpen,
    setResolveModalOpen,
    activeConflict,
    openResolver,
  };
}
