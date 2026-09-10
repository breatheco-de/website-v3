import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PROPOSAL_KIND_OPTIONS,
  PROPOSAL_STATUS_OPTIONS,
  type ProposalListFilters,
  type ProposalListKind,
  type ProposalListStats,
  type ProposalListStatus,
} from "@/pages/proposals-list-filters";

export type ProposalListFilterDims = Pick<ProposalListFilters, "status" | "kind">;

export function ProposalListFiltersDialog({
  open,
  onOpenChange,
  filters,
  stats,
  onApply,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: ProposalListFilters;
  stats?: ProposalListStats | null;
  onApply: (next: ProposalListFilterDims) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState<ProposalListFilterDims>({
    status: filters.status,
    kind: filters.kind,
  });

  useEffect(() => {
    if (open) {
      setDraft({ status: filters.status, kind: filters.kind });
    }
  }, [open, filters.status, filters.kind]);

  const patchDraft = (patch: Partial<ProposalListFilterDims>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  function handleApply() {
    onApply(draft);
    onOpenChange(false);
  }

  function handleClear() {
    onClear();
    onOpenChange(false);
  }

  function statusLabel(value: ProposalListStatus, label: string): string {
    if (value === "all") {
      const total = stats?.total;
      return total != null ? `${label} (${total})` : label;
    }
    const n = stats?.by_status?.[value];
    return n != null ? `${label} (${n})` : label;
  }

  function kindLabel(value: ProposalListKind, label: string): string {
    if (value === "all") {
      const total = stats?.total;
      return total != null ? `${label} (${total})` : label;
    }
    const n = stats?.by_kind?.[value];
    return n != null ? `${label} (${n})` : label;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="dialog-proposal-filters">
        <DialogHeader>
          <DialogTitle>Filters</DialogTitle>
          <DialogDescription>
            These only change which proposals appear in the list. Nothing is written to content until
            someone acts on a proposal. Changes apply when you click Apply. Sort is separate — use the
            Sort control next to Filters.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="proposal-status-filter" className="text-xs text-muted-foreground">
              Status
            </Label>
            <Select
              value={draft.status}
              onValueChange={(status) => patchDraft({ status: status as ProposalListStatus })}
            >
              <SelectTrigger
                id="proposal-status-filter"
                className="h-8 text-sm"
                data-testid="select-proposal-status-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPOSAL_STATUS_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    data-testid={`option-proposal-status-${opt.value}`}
                  >
                    {statusLabel(opt.value, opt.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="proposal-kind-filter" className="text-xs text-muted-foreground">
              Kind
            </Label>
            <Select
              value={draft.kind}
              onValueChange={(kind) => patchDraft({ kind: kind as ProposalListKind })}
            >
              <SelectTrigger
                id="proposal-kind-filter"
                className="h-8 text-sm"
                data-testid="select-proposal-kind-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPOSAL_KIND_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    data-testid={`option-proposal-kind-${opt.value}`}
                  >
                    {kindLabel(opt.value, opt.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={handleClear} data-testid="button-clear-proposal-filters">
            Clear
          </Button>
          <Button size="sm" onClick={handleApply} data-testid="button-apply-proposal-filters">
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
