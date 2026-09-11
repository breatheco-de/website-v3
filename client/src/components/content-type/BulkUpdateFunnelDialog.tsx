import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { apiRequest } from "@/lib/queryClient";
import {
  FunnelFieldsForm,
  type FunnelProductsMode,
} from "@/components/DebugBubble/components/FunnelTab";

const BULK_PRODUCT_MODES: { value: FunnelProductsMode; label: string }[] = [
  { value: "leave", label: "Leave" },
  { value: "all", label: "All" },
  { value: "list", label: "Specific" },
  { value: "clear", label: "Clear" },
];

export function BulkUpdateFunnelDialog({
  open,
  onOpenChange,
  contentType,
  slugs,
  isDbView,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: string;
  slugs: string[];
  isDbView: boolean;
  onDone: (result: { ok: string[]; failed: { slug: string; error: string }[] }) => void;
}) {
  const [stage, setStage] = useState("");
  const [stageEditing, setStageEditing] = useState(true);
  const [productsMode, setProductsMode] = useState<FunnelProductsMode>("leave");
  const [selectedBindings, setSelectedBindings] = useState<
    { product: string; persona?: string }[]
  >([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setStage("");
    setStageEditing(true);
    setProductsMode("leave");
    setSelectedBindings([]);
    setAdvancedOpen(false);
  }, [open]);

  const { data: productMap } = useQuery<{
    products: {
      content_slug: string;
      name: string;
      actively_selling?: boolean;
      audience_status?: "missing" | "minimal" | "complete";
      personas?: { id: string; label: string }[];
    }[];
  }>({
    queryKey: ["/api/ecommerce/product-map"],
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const productOptions = (productMap?.products ?? []).filter(
    (p) => p.actively_selling !== false,
  );

  const canApply = !!stage.trim();

  const handleApply = async () => {
    if (!canApply || saving) return;
    setSaving(true);
    const body: {
      stage: string;
      products?: { product: string; persona?: string }[] | "all" | null;
    } = {
      stage: stage.trim(),
    };
    // Leave = omit products key (path-touched merge preserves existing).
    // Clear = null. Set all/list = value.
    if (productsMode === "all") body.products = "all";
    else if (productsMode === "list") body.products = selectedBindings;
    else if (productsMode === "clear") body.products = null;
    // leave: do not set products

    const ok: string[] = [];
    const failed: { slug: string; error: string }[] = [];
    const results = await Promise.allSettled(
      slugs.map(async (slug) => {
        const res = await apiRequest(
          "PUT",
          `/api/content-types/${contentType}/funnel/${slug}`,
          body,
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Save failed");
        return slug;
      }),
    );
    results.forEach((r, i) => {
      const slug = slugs[i]!;
      if (r.status === "fulfilled") ok.push(slug);
      else failed.push({ slug, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
    });
    setSaving(false);
    onDone({ ok, failed });
    if (failed.length === 0) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[90vh] overflow-y-auto"
        ref={(node) => setPortalEl(node)}
        data-testid="dialog-bulk-update-funnel"
      >
        <DialogHeader>
          <DialogTitle>Update funnel ({slugs.length})</DialogTitle>
        </DialogHeader>

        <FunnelFieldsForm
          stage={stage}
          onStageChange={setStage}
          stageEditing={stageEditing}
          onStageEditingChange={setStageEditing}
          productsMode={productsMode}
          onProductsModeChange={setProductsMode}
          selectedBindings={selectedBindings}
          onSelectedBindingsChange={setSelectedBindings}
          productOptions={productOptions}
          productsModeOptions={BULK_PRODUCT_MODES}
          portalContainer={portalEl}
          hideStoreMembership
          isProgram={contentType === "program"}
          education={
            <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm text-muted-foreground">
              <p className="text-foreground font-medium flex items-center gap-1.5">
                <Info className="h-4 w-4 shrink-0" />
                Bulk funnel update
              </p>
              <p>
                Same stage (and optional products) on every selected page.{" "}
                <span className="text-foreground">Leave</span> keeps each page’s current products;{" "}
                <span className="text-foreground">Clear</span> removes products on purpose. A stage is
                required.
              </p>
              {isDbView && (
                <p>
                  This writes each entry’s <code className="text-xs bg-muted px-1 rounded">_common.yml</code>{" "}
                  (creates the file if needed). The shared template is unchanged.
                </p>
              )}
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 text-xs text-foreground hover:text-foreground/80">
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                  />
                  Read more (advanced)
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 text-xs space-y-1 font-mono">
                  <p>{`{type}/{slug}/_common.yml → funnel`}</p>
                  <p>PUT /api/content-types/:type/funnel/:slug (path-touched merge)</p>
                </CollapsibleContent>
              </Collapsible>
            </div>
          }
        />

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleApply()}
            disabled={!canApply || saving}
            data-testid="button-bulk-funnel-apply"
          >
            {saving ? "Updating…" : `Apply to ${slugs.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
