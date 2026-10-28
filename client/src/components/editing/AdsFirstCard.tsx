import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AdsFirstCardProps {
  contentType: string;
  enabled: boolean;
  /** Config still loading. */
  loading: boolean;
}

export function AdsFirstCard({ contentType, enabled, loading }: AdsFirstCardProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [confirmOffOpen, setConfirmOffOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);

  const save = async (next: boolean) => {
    setSaving(true);
    try {
      await apiRequest("PUT", `/api/content-types/${contentType}/config`, {
        ads: next ? { optimize: true } : null,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
      toast({
        title: next ? "Optimize for ads on" : "Optimize for ads off",
        description: next
          ? "Pages of this type now load tracking on open and count their own visits."
          : "Tracking stops for this type. Collected visit data is kept.",
      });
    } catch (err) {
      toast({
        title: "Failed to update Optimize for ads",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card data-testid="card-kpi-ads-first">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Optimize for ads</CardTitle>
          <Switch
            checked={enabled}
            disabled={saving || loading}
            onCheckedChange={(checked) => {
              if (checked) void save(true);
              else setConfirmOffOpen(true);
            }}
            data-testid="switch-ads-first"
          />
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Treat pages of this type as ad landing pages: tracking starts as soon as the page opens, and page
            stats use the site&apos;s own visitor counts. Costs a little page-speed score.
          </p>
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setExplainOpen(true)}
            data-testid="button-ads-first-explain"
          >
            How ads-first works
          </button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOffOpen} onOpenChange={setConfirmOffOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off Optimize for ads?</AlertDialogTitle>
            <AlertDialogDescription>
              Tracking stops for pages of this type and page stats go back to Google Analytics. Collected data is
              kept, and the stats drawer can still show it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-ads-first-off-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOffOpen(false);
                void save(false);
              }}
              data-testid="button-ads-first-off-confirm"
            >
              Turn off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AdsFirstExplainDialog open={explainOpen} onClose={() => setExplainOpen(false)} />
    </>
  );
}

function AdsFirstExplainDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setShowAdvanced(false);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How ads-first works</DialogTitle>
          <DialogDescription>
            For pages people reach from ads, where counting every visit matters more than a perfect speed score.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Tracking loads right away.</strong> Google Tag Manager starts when the
            page opens instead of waiting for the first scroll or tap, so visitors who leave fast are still seen by
            Google and Meta. Any page opened from an ad link gets this too, whatever its type.
          </p>
          <p>
            <strong className="text-foreground">Consent on landing outside Europe.</strong> Visitors in countries
            that get the short cookie notice count as agreeing when they land. Visitors in the EU, UK and Switzerland
            still choose Accept or Reject. Visitors whose country is unknown follow the consent settings page.
          </p>
          <p>
            <strong className="text-foreground">The site counts its own visits.</strong> Every visit is counted
            anonymously, with no cookies, no IP address and no visitor ID, so the cookie banner does not control it.
            Logged-in staff are never counted. Page stats for these pages use these counts instead of Google
            Analytics.
          </p>
          <p>
            <strong className="text-foreground">The first 28 days fill in gradually.</strong> Stats show &quot;collecting
            since&quot; until a full period exists. Google Analytics stays one click away in the stats drawer.
          </p>
          <p>
            <strong className="text-foreground">What does not change:</strong> the Ads report and conversions sent to
            Google Ads and Meta. Turning this off stops tracking but keeps the data already collected.
          </p>

          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
            data-testid="button-toggle-ads-first-advanced"
          >
            {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
          </button>

          {showAdvanced && (
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2 text-xs">
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  Setting: <code className="text-[11px] font-mono">site_*/content-types.yml</code> →{" "}
                  <code className="text-[11px] font-mono">ads.optimize</code>
                </li>
                <li>
                  Early Tag Manager also applies to URLs with <code className="text-[11px] font-mono">gclid</code>,{" "}
                  <code className="text-[11px] font-mono">fbclid</code>, <code className="text-[11px] font-mono">gbraid</code>{" "}
                  or <code className="text-[11px] font-mono">wbraid</code>.
                </li>
                <li>
                  Visit data: <code className="text-[11px] font-mono">data/&lt;site&gt;/visits.db</code> (raw page views
                  kept 90 days, daily totals kept indefinitely).
                </li>
                <li>
                  Each page view sends an arrival message and a summary to{" "}
                  <code className="text-[11px] font-mono">/api/page-ready</code>; journeys use{" "}
                  <code className="text-[11px] font-mono">/api/page-link</code>. Nothing is stored on the device.
                </li>
                <li>Reloads and back-button returns are not counted as new visits.</li>
                <li>Collector: <code className="text-[11px] font-mono">client/src/lib/page-ready.ts</code>.</li>
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose} data-testid="button-ads-first-explain-close">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
