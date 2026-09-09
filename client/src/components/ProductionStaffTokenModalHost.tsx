import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import {
  registerProductionStaffTokenPrompt,
  type ProductionStaffTokenPromptOpts,
} from "@/lib/productionStaffTokenGate";

type Resolver = (ok: boolean) => void;

/**
 * Dev-only host: listens for production_staff_token_required via the gate and
 * collects a production staff token for this npm run dev process.
 */
export function ProductionStaffTokenModalHost() {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ProductionStaffTokenPromptOpts | null>(null);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const resolverRef = useRef<Resolver | null>(null);

  const finish = useCallback((ok: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    setOpts(null);
    setToken("");
    setSaving(false);
    setSaveError(null);
    setAdvancedOpen(false);
    resolve?.(ok);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    registerProductionStaffTokenPrompt((promptOpts) => {
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setOpts(promptOpts);
        setToken("");
        setSaveError(null);
        setAdvancedOpen(false);
        setOpen(true);
      });
    });

    return () => {
      registerProductionStaffTokenPrompt(null);
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
    };
  }, []);

  const canConfirm = token.trim().length > 0 && !saving;

  const onConfirm = async () => {
    const trimmed = token.trim();
    if (!trimmed) return;
    setSaving(true);
    setSaveError(null);
    try {
      const localToken = getDebugToken();
      const res = await fetch("/api/dev/production-staff-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
          ...(localToken ? { Authorization: `Token ${localToken}` } : {}),
        },
        body: JSON.stringify({ token: trimmed }),
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setSaveError(text || `Could not save token (${res.status})`);
        setSaving(false);
        return;
      }
      finish(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save token");
      setSaving(false);
    }
  };

  if (!import.meta.env.DEV) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish(false);
      }}
    >
      <DialogContent
        className="sm:max-w-md z-[10002]"
        overlayClassName="z-[10002]"
        data-testid="dialog-production-staff-token"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {opts?.rejected ? "That production token was rejected" : "Production staff token needed"}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                {opts?.rejected
                  ? "Production did not accept the last token. Paste a fresh one from a tab where you are logged in on the live site."
                  : "This download talks to the live site. Paste a staff token from a logged-in production tab — not your localhost GitHub login."}
              </p>
              <p>
                Pasting authorizes this running local server until you restart it. Also set{" "}
                <code className="text-xs text-foreground">{opts?.envVar ?? "PRODUCTION_STAFF_TOKEN"}</code>{" "}
                in <code className="text-xs text-foreground">.env</code> so you do not paste after every
                restart.
              </p>
              {opts?.productionOrigin ? (
                <p className="text-xs">
                  Live origin:{" "}
                  <code className="text-foreground">{opts.productionOrigin}</code>
                </p>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="production-staff-token-input">Production staff token</Label>
          <Input
            id="production-staff-token-input"
            data-testid="input-production-staff-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canConfirm) void onConfirm();
            }}
            placeholder="Paste token from production"
          />
          {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
        </div>

        <details
          className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-medium text-foreground">
            Read more (advanced)
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>
              Env var: <code>{opts?.envVar ?? "PRODUCTION_STAFF_TOKEN"}</code> — not written
              automatically; copy it yourself into <code>.env</code>.
            </li>
            <li>Process memory only for pastes; cleared if production returns 401 again.</li>
            <li>
              Used for Node → live HTTP pulls (e.g. pipeline event history). GCS “pull from
              production” actions do not use this token.
            </li>
          </ul>
        </details>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => finish(false)}
            data-testid="button-cancel-production-staff-token"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={() => void onConfirm()}
            data-testid="button-confirm-production-staff-token"
          >
            {saving ? "Saving…" : "Use token"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
