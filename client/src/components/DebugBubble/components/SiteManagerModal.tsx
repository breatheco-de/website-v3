import { lazy, Suspense, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconServer, IconSwitchHorizontal } from "@tabler/icons-react";
import { AlertCircle, Check, FileText, Loader2, Pencil, Plus, Power, RefreshCw, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { useHardRestart } from "@/hooks/useHardRestart";
import { useToast } from "@/hooks/use-toast";
import { setDevSiteOverride, stashPendingDomainNavigation } from "@/lib/devSite";

const SitesYmlViewerPanel = lazy(() => import("@/components/editing/SitesYmlViewerPanel"));

const IS_PROD = import.meta.env.PROD;

interface SiteInfo {
  domain: string;
  contentFolder: string;
  isMultiSite: boolean;
  isDevOverride: boolean;
  githubRepoUrl?: string;
}

interface SiteManagerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteInfo: SiteInfo | null | undefined;
  onSwitchSite?: () => void;
}

interface GitHubSeedResult {
  attempted: boolean;
  success: boolean;
  committed: string[];
  skipped: string[];
  errors: string[];
  commitSha: string | null;
  reason?: string;
}

interface RefreshConfigResult {
  success: boolean;
  source: "gcs" | "local";
  sites: Array<{ domain: string; contentFolder: string; githubRepoUrl?: string }>;
  siteInfo: SiteInfo;
  message: string;
  error?: string;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getDebugToken();
  if (token) headers.Authorization = `Token ${token}`;
  return headers;
}

interface CreateSiteResult {
  folderName: string;
  created: boolean;
  githubSeed?: GitHubSeedResult;
}

interface RenameDomainResult {
  success: boolean;
  sites: Array<{ domain: string; contentFolder: string; githubRepoUrl?: string }>;
  siteInfo: SiteInfo;
  previousDomain: string;
  message: string;
  error?: string;
}

interface SoftReloadResult {
  success: boolean;
  error?: string;
}

async function finishDomainNavigation(domain: string): Promise<void> {
  stashPendingDomainNavigation(domain);
  if (!IS_PROD) {
    await setDevSiteOverride(domain);
    window.location.reload();
    return;
  }
  window.location.href = `https://${domain}${window.location.pathname}${window.location.search}`;
}

function ConfigRow({ label, value, mono = false }: { label: string; value: string | boolean | undefined; mono?: boolean }) {
  if (value === undefined || value === null || value === "") return null;
  const displayValue = typeof value === "boolean" ? (value ? "Yes" : "No") : value;
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-b-0">
      <span className="text-xs text-muted-foreground shrink-0 w-32">{label}</span>
      <span className={`text-xs text-foreground text-right break-all ${mono ? "font-mono" : ""}`}>{displayValue}</span>
    </div>
  );
}

function EditableDomainRow({
  domain,
  onRenameRequest,
  disabled = false,
}: {
  domain: string;
  onRenameRequest: (newDomain: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(domain);

  useEffect(() => {
    if (!editing) setDraft(domain);
  }, [domain, editing]);

  if (!domain) return null;

  const handleSave = () => {
    const next = draft.trim().toLowerCase();
    if (!next || next === domain) {
      setDraft(domain);
      setEditing(false);
      return;
    }
    onRenameRequest(next);
    setEditing(false);
  };

  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-b-0">
      <span className="text-xs text-muted-foreground shrink-0 w-32">Domain</span>
      <div className="flex items-center gap-1.5 min-w-0 flex-1 justify-end">
        {editing ? (
          <>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") {
                  setDraft(domain);
                  setEditing(false);
                }
              }}
              className="h-7 font-mono text-xs text-right max-w-[220px]"
              disabled={disabled}
              autoFocus
              data-testid="input-edit-site-domain"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={handleSave}
              disabled={disabled}
              title="Save domain change"
              data-testid="button-save-site-domain"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => {
                setDraft(domain);
                setEditing(false);
              }}
              disabled={disabled}
              title="Cancel"
              data-testid="button-cancel-edit-site-domain"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <>
            <span className="text-xs text-foreground text-right break-all font-mono">{domain}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setEditing(true)}
              disabled={disabled}
              title="Edit domain"
              data-testid="button-edit-site-domain"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function SiteManagerModal({ open, onOpenChange, siteInfo, onSwitchSite }: SiteManagerModalProps) {
  const [view, setView] = useState<"config" | "create">("config");
  const [folderName, setFolderName] = useState("");
  const [domain, setDomain] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [includeSample, setIncludeSample] = useState(true);
  const [successResult, setSuccessResult] = useState<CreateSiteResult | null>(null);
  const [successGithubUrl, setSuccessGithubUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [domainConfirmOpen, setDomainConfirmOpen] = useState(false);
  const [domainReloadActive, setDomainReloadActive] = useState(false);
  const [renamedTargetDomain, setRenamedTargetDomain] = useState<string | null>(null);
  const [pendingDomainRename, setPendingDomainRename] = useState<{ from: string; to: string } | null>(null);
  const [displaySiteInfo, setDisplaySiteInfo] = useState<SiteInfo | null>(null);
  const [showSitesYml, setShowSitesYml] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { phase: restartPhase, message: restartMessage, start: startRestart, reset: resetRestart } = useHardRestart();
  const currentSiteInfo = displaySiteInfo ?? siteInfo ?? null;
  const handleSwitchSite = () => {
    onOpenChange(false);
    window.setTimeout(() => onSwitchSite?.(), 200);
  };
  // Hide dialog while sites.yml side panel is open (dialog overlay is z-[10000], panel is z-[9999]).
  const siteManagerDialogOpen =
    open && !domainConfirmOpen && !restartConfirmOpen && !domainReloadActive && !showSitesYml;

  const refreshMutation = useMutation<RefreshConfigResult, Error>({
    mutationFn: async () => {
      const res = await fetch("/api/admin/sites/refresh-config", {
        method: "POST",
        headers: authHeaders(),
      });
      const data = (await res.json()) as RefreshConfigResult;
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to refresh site registry");
      }
      return data;
    },
    onSuccess: (data) => {
      setDisplaySiteInfo(data.siteInfo);
      queryClient.setQueryData(["/api/site/info"], data.siteInfo);
      queryClient.setQueryData(["/api/sites"], data.sites);
      toast({ title: "Site registry refreshed", description: data.message });
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "Refresh failed",
        description: err.message,
      });
    },
  });

  const renameDomainMutation = useMutation<RenameDomainResult, Error, { currentDomain: string; newDomain: string }>({
    mutationFn: async ({ currentDomain, newDomain }) => {
      const res = await fetch("/api/admin/sites/domain", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ currentDomain, newDomain }),
      });
      const data = (await res.json()) as RenameDomainResult;
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to rename site domain");
      }

      const softRes = await fetch("/api/admin/server/soft-reload", {
        method: "POST",
        headers: authHeaders(),
      });
      const soft = (await softRes.json()) as SoftReloadResult;
      if (!softRes.ok || !soft.success) {
        throw new Error(soft.error || "Domain updated but server soft reload failed");
      }

      return data;
    },
    onSuccess: async (data) => {
      setDisplaySiteInfo(data.siteInfo);
      queryClient.setQueryData(["/api/site/info"], data.siteInfo);
      queryClient.setQueryData(["/api/sites"], data.sites);
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/gcs-sync-inventory"] });
      setDomainReloadActive(false);
      setRenamedTargetDomain(null);
      toast({ title: "Domain updated", description: data.message });
      await finishDomainNavigation(data.siteInfo.domain);
    },
    onError: (err) => {
      setDomainReloadActive(false);
      setRenamedTargetDomain(null);
      toast({
        variant: "destructive",
        title: "Domain update failed",
        description: err.message,
      });
    },
  });

  const domainActionsBusy =
    refreshMutation.isPending ||
    renameDomainMutation.isPending ||
    domainReloadActive;

  const handleDomainRenameRequest = (newDomain: string) => {
    if (!currentSiteInfo?.domain) return;
    setPendingDomainRename({ from: currentSiteInfo.domain, to: newDomain });
    setDomainConfirmOpen(true);
  };

  const createMutation = useMutation<CreateSiteResult, Error, { name: string; domain: string; githubRepoUrl?: string; includeSampleContent: boolean }>({
    mutationFn: async (body) => {
      const res = await fetch("/api/admin/sites/create", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create site");
      return data as CreateSiteResult;
    },
    onSuccess: (data) => {
      setSuccessResult(data);
      setSuccessGithubUrl(githubUrl.trim() || null);
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: ["/api/site/info"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sites"] });
    },
    onError: (err) => {
      setErrorMsg(err.message);
    },
  });

  const handleCreate = () => {
    if (!folderName.trim() || !domain.trim()) return;
    setErrorMsg(null);
    setSuccessResult(null);
    setSuccessGithubUrl(null);
    createMutation.mutate({
      name: folderName.trim(),
      domain: domain.trim(),
      githubRepoUrl: githubUrl.trim() || undefined,
      includeSampleContent: includeSample,
    });
  };

  const handleDialogClose = (v: boolean) => {
    if (!v) {
      setView("config");
      setSuccessResult(null);
      setSuccessGithubUrl(null);
      setErrorMsg(null);
      setDisplaySiteInfo(null);
      setRestartConfirmOpen(false);
      setDomainConfirmOpen(false);
      setDomainReloadActive(false);
      setRenamedTargetDomain(null);
      setPendingDomainRename(null);
      setShowSitesYml(false);
      resetRestart();
    }
    onOpenChange(v);
  };

  const resetCreateForm = () => {
    setFolderName("");
    setDomain("");
    setGithubUrl("");
    setIncludeSample(true);
    setErrorMsg(null);
  };

  const openCreateView = () => {
    setSuccessResult(null);
    setSuccessGithubUrl(null);
    resetCreateForm();
    setView("create");
  };

  const isSubmitDisabled = !folderName.trim() || !domain.trim() || createMutation.isPending;

  const createForm = successResult ? (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Check className="h-4 w-4 text-primary" />
        Site created successfully
      </div>
      <div className="text-xs text-muted-foreground space-y-2">
          <p>
            Folder: <code className="font-mono bg-muted px-1 py-0.5 rounded">{successResult.folderName}/</code>
            — pages live under <code className="font-mono">pages/{"{slug}"}/en.yml</code>.
            Components come from the parent site via <code className="font-mono">inherit_components_from</code>
            {" "}(this folder has no <code className="font-mono">component-registry/</code>).
          </p>

        {successResult.githubSeed?.success && (
          <p className="text-foreground">
            {successResult.githubSeed.committed.length} scaffold file
            {successResult.githubSeed.committed.length === 1 ? "" : "s"} pushed to GitHub
            {successResult.githubSeed.commitSha
              ? ` (commit ${successResult.githubSeed.commitSha.slice(0, 7)})`
              : ""}
            . Files are safe in the content repo before restart.
          </p>
        )}

        {successResult.githubSeed?.attempted && !successResult.githubSeed.success && (
          <div className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-destructive space-y-1">
            <p className="font-medium">GitHub push failed — files exist only locally.</p>
            {successResult.githubSeed.errors.length > 0 && (
              <p>{successResult.githubSeed.errors.slice(0, 3).join("; ")}</p>
            )}
            <p>Retry via Sync → push-all before restarting.</p>
          </div>
        )}

        {successResult.githubSeed && !successResult.githubSeed.attempted && successResult.githubSeed.reason && (
          <p className="text-foreground">GitHub push skipped: {successResult.githubSeed.reason}</p>
        )}

        <p className="text-foreground">
          Site registry saved to GCS in production — the new domain will appear in Switch Site after a browser refresh.
        </p>
        <p className="text-foreground">
          Next step: restart the server so background sync picks up the new site.
        </p>
        {successGithubUrl && successResult.githubSeed?.attempted && !successResult.githubSeed.success && (
          <p className="text-destructive">Do not restart until the push succeeds, or scaffold files may be lost.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={() => {
            setRestartConfirmOpen(true);
          }}
          disabled={restartPhase === "restarting"}
          data-testid="button-restart-server"
        >
          {restartPhase === "restarting" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Power className="h-3.5 w-3.5 mr-1.5" />
          )}
          Restart server
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setSuccessResult(null);
            setSuccessGithubUrl(null);
            resetCreateForm();
          }}
        >
          Create another site
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setView("config")}>
          Back to config
        </Button>
      </div>
      {restartPhase !== "idle" && (
        <div
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
            restartPhase === "online"
              ? "border-green-500/30 bg-green-500/5 text-foreground"
              : restartPhase === "failed"
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-border bg-muted/40 text-foreground"
          }`}
          data-testid="status-restart-server"
        >
          {restartPhase === "restarting" && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 mt-0.5" />}
          {restartPhase === "online" && <Check className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />}
          {restartPhase === "failed" && <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
          <span className="flex-1">{restartMessage}</span>
        </div>
      )}
    </div>
  ) : (
    <>
      <div className="space-y-2">
        <Label htmlFor="site-folder-name" className="text-xs">
          Site folder name
        </Label>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1.5 rounded-l border border-r-0 border-input shrink-0">site_</span>
          <Input
            id="site-folder-name"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="my-site"
            className="rounded-l-none font-mono text-sm"
            data-testid="input-site-folder-name"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">Alphanumeric and hyphens only. Will create folder <code className="font-mono">site_{folderName || "…"}/</code>.</p>
      </div>

      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1.5 text-[11px] text-foreground">
        <p>
          New sites inherit the default site&apos;s component library (
          <code className="font-mono text-[10px]">inherit_components_from</code>
          ) and must not create a local <code className="font-mono text-[10px]">component-registry/</code>.
          Sample content uses folder layout: <code className="font-mono text-[10px]">pages/{"{slug}"}/en.yml</code>
          (not <code className="font-mono text-[10px]">about.en.yml</code>). Home is served at{" "}
          <code className="font-mono text-[10px]">/en</code> via <code className="font-mono text-[10px]">home_page</code>.
        </p>
        <p className="text-muted-foreground">
          Images use a separate field (<code className="font-mono text-[10px]">fallback_content_folder</code>);
          create defaults both to the same parent. Advanced:{" "}
          <code className="font-mono text-[10px]">server/site-scaffold.ts</code>,{" "}
          <code className="font-mono text-[10px]">shared/registry-resolve.ts</code>,{" "}
          <code className="font-mono text-[10px]">sites.yml.example</code>.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="site-domain" className="text-xs">Primary domain</Label>
        <Input
          id="site-domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="example.com"
          className="font-mono text-sm"
          data-testid="input-site-domain"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="site-github-url" className="text-xs">GitHub repo URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input
          id="site-github-url"
          value={githubUrl}
          onChange={(e) => setGithubUrl(e.target.value)}
          placeholder="https://github.com/org/repo"
          className="font-mono text-sm"
          data-testid="input-site-github-url"
        />
      </div>

      <div className="flex items-center justify-between py-1">
        <div>
          <Label htmlFor="site-sample-content" className="text-xs">Include sample content</Label>
          <p className="text-[11px] text-muted-foreground">
            Adds <code className="font-mono">pages/about/en.yml</code> and{" "}
            <code className="font-mono">blog/sample-post/en.yml</code>.
          </p>
        </div>
        <Switch
          id="site-sample-content"
          checked={includeSample}
          onCheckedChange={setIncludeSample}
          data-testid="switch-include-sample-content"
        />
      </div>

      {errorMsg && (
        <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">{errorMsg}</p>
      )}

      <div className="flex justify-between pt-1">
        <Button size="sm" variant="ghost" onClick={() => setView("config")}>
          Cancel
        </Button>
        <Button
          onClick={handleCreate}
          disabled={isSubmitDisabled}
          size="sm"
          data-testid="button-create-site"
        >
          {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
          {createMutation.isPending
            ? (githubUrl.trim() ? "Creating & pushing…" : "Creating site…")
            : "Create Site"}
        </Button>
      </div>
    </>
  );

  return (
    <>
    <Dialog open={siteManagerDialogOpen} onOpenChange={handleDialogClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconServer className="h-4 w-4 text-muted-foreground" />
            Site Manager
          </DialogTitle>
          <DialogDescription>
            {view === "config"
              ? "Current site configuration from the multisite registry."
              : "Scaffold a new site folder and register it in sites.yml."}
          </DialogDescription>
        </DialogHeader>

        {view === "config" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setShowSitesYml(true)}
                title="View YAML"
                data-testid="button-view-sites-yml"
              >
                <FileText className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                title="Refresh"
                data-testid="button-refresh-site-config"
              >
                {refreshMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
              {currentSiteInfo?.isMultiSite && onSwitchSite && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSwitchSite}
                  data-testid="button-switch-site"
                >
                  <IconSwitchHorizontal className="h-3.5 w-3.5 mr-1.5" />
                  Switch to another site
                </Button>
              )}
              <Button
                size="sm"
                onClick={openCreateView}
                data-testid="button-new-site"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New Site
              </Button>
            </div>
            {currentSiteInfo ? (
              <div className="rounded-md border px-3 py-1">
                <ConfigRow label="Content Folder" value={currentSiteInfo.contentFolder} mono />
                <EditableDomainRow
                  domain={currentSiteInfo.domain}
                  onRenameRequest={handleDomainRenameRequest}
                  disabled={domainActionsBusy}
                />
                <ConfigRow label="Multi-site Mode" value={currentSiteInfo.isMultiSite} />
                <ConfigRow label="Dev Override" value={currentSiteInfo.isDevOverride} />
                <ConfigRow label="GitHub Repo URL" value={currentSiteInfo.githubRepoUrl} mono />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No site info available.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">{createForm}</div>
        )}
      </DialogContent>
    </Dialog>

      <AlertDialog
        open={domainConfirmOpen}
        onOpenChange={(open) => {
          setDomainConfirmOpen(open);
          if (!open && !renameDomainMutation.isPending) setPendingDomainRename(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change site domain?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDomainRename ? (
                <>
                  Rename <span className="font-mono">{pendingDomainRename.from}</span> to{" "}
                  <span className="font-mono">{pendingDomainRename.to}</span> in sites.yml, soft-reload the server
                  registry, and reload your browser on the new domain.
                </>
              ) : (
                "Confirm the domain change to update sites.yml and reload the server registry."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={renameDomainMutation.isPending}
              data-testid="button-cancel-domain-rename"
            >
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!pendingDomainRename || renameDomainMutation.isPending}
              onClick={() => {
                if (!pendingDomainRename) return;
                setDomainConfirmOpen(false);
                setRenamedTargetDomain(pendingDomainRename.to);
                setPendingDomainRename(null);
                setDomainReloadActive(true);
                renameDomainMutation.mutate({
                  currentDomain: pendingDomainRename.from,
                  newDomain: pendingDomainRename.to,
                });
              }}
              data-testid="button-confirm-domain-rename"
            >
              {renameDomainMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Updating…
                </>
              ) : (
                "Confirm & reload"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={restartConfirmOpen} onOpenChange={setRestartConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart the server?</AlertDialogTitle>
            <AlertDialogDescription>
              This gracefully exits and relaunches the process so newly created sites are picked up. The site will be
              briefly unavailable while it comes back online. If it does not recover, you will need to roll back or
              redeploy from the platform. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-restart-server">Cancel</AlertDialogCancel>
            <Button
              type="button"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setRestartConfirmOpen(false);
                resetRestart();
                startRestart();
              }}
              data-testid="button-confirm-restart-server"
            >
              Restart server
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={domainReloadActive}
        onOpenChange={(open) => {
          if (!open && !renameDomainMutation.isPending) {
            setDomainReloadActive(false);
            setRenamedTargetDomain(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Applying domain change</AlertDialogTitle>
            <AlertDialogDescription>
              {renamedTargetDomain ? (
                <>
                  Updating the site registry to <span className="font-mono">{renamedTargetDomain}</span> and reloading
                  server state. Your browser will refresh on the new domain when this finishes.
                </>
              ) : (
                "Updating sites.yml and reloading server state."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div
            className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs border-border bg-muted/40 text-foreground"
            data-testid="status-domain-reload-dialog"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 mt-0.5" />
            <span className="flex-1">Soft-reloading server registry…</span>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {showSitesYml && (
        <Suspense fallback={null}>
          <SitesYmlViewerPanel
            onClose={() => setShowSitesYml(false)}
            onSaved={() => {
              void queryClient.invalidateQueries({ queryKey: ["/api/site/info"] });
              void queryClient.invalidateQueries({ queryKey: ["/api/sites"] });
              setDisplaySiteInfo(null);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
