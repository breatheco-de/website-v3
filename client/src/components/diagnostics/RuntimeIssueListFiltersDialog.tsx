import { useEffect, useState } from "react";
import { CalendarDays, Globe, MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  FILTER_ALL,
  SOURCE_FILTER_TAGS,
  deviceLabel,
  sourceLabel,
  type RuntimeIssueFilters,
} from "./runtime-issues-filters";

export function RuntimeIssueListFiltersDialog({
  open,
  onOpenChange,
  filters,
  locales,
  devices,
  onApply,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: RuntimeIssueFilters;
  locales: string[];
  devices: string[];
  /** Commit draft filters to the table/URL (call on Apply). */
  onApply: (next: RuntimeIssueFilters) => void;
  /** Reset applied filters (parent) and close. */
  onClear: () => void;
}) {
  const [draft, setDraft] = useState<RuntimeIssueFilters>(filters);

  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  const patchDraft = (patch: Partial<RuntimeIssueFilters>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const {
    pathQuery,
    referrerQuery,
    locale: localeFilter,
    device: deviceFilter,
    pagesOnly,
    windowDays,
    tz,
    source: sourceFilter,
  } = draft;

  function handleApply() {
    onApply(draft);
    onOpenChange(false);
  }

  function handleClear() {
    onClear();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="dialog-runtime-list-filters">
        <DialogHeader>
          <DialogTitle>List filters</DialogTitle>
          <DialogDescription>
            These only change the table, CSV, and totals. They do not stop recording 404s. Changes apply
            when you click Apply.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2" data-testid="toggle-pages-only">
            <Switch
              id="pages-only"
              checked={pagesOnly}
              onCheckedChange={(checked) => patchDraft({ pagesOnly: checked })}
            />
            <Label htmlFor="pages-only" className="text-sm">
              Pages only
            </Label>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Hides file URLs (.js, images, and other assets), including Internal ones.
          </p>
          <div className="flex items-center gap-2" data-testid="toggle-query-params-only">
            <Switch
              id="query-params-only"
              checked={draft.queryParamsOnly}
              onCheckedChange={(checked) => patchDraft({ queryParamsOnly: checked })}
            />
            <Label htmlFor="query-params-only" className="text-sm">
              With query params only
            </Label>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Shows paths where the 404 URL had recorded query string data (UTM, gclid, etc.). Older rows
            without params appear only after new hits.
          </p>
          <div className="space-y-1">
            <Label htmlFor="runtime-path-filter" className="text-xs text-muted-foreground">
              Path
            </Label>
            <Input
              id="runtime-path-filter"
              value={pathQuery}
              onChange={(e) => patchDraft({ pathQuery: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleApply();
                }
              }}
              placeholder="Contains…"
              className="h-8 text-sm"
              data-testid="input-runtime-path-filter"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1 min-w-0">
              <Label
                htmlFor="runtime-window-filter"
                className="text-xs text-muted-foreground inline-flex items-center gap-1.5"
              >
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Window
              </Label>
              <Select
                value={String(windowDays)}
                onValueChange={(value) => patchDraft({ windowDays: value === "7" ? 7 : 30 })}
              >
                <SelectTrigger
                  id="runtime-window-filter"
                  className="h-8 text-sm"
                  data-testid="select-runtime-window-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground leading-snug" data-testid="text-runtime-window-tz">
                {tz}
              </p>
            </div>
            <div className="space-y-1 min-w-0">
              <Label
                htmlFor="runtime-locale-filter"
                className="text-xs text-muted-foreground inline-flex items-center gap-1.5"
              >
                <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Locale
              </Label>
              <Select value={localeFilter} onValueChange={(locale) => patchDraft({ locale })}>
                <SelectTrigger
                  id="runtime-locale-filter"
                  className="h-8 text-sm"
                  data-testid="select-runtime-locale-filter"
                >
                  <SelectValue placeholder="All locales" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL}>All locales</SelectItem>
                  {locales.map((locale) => (
                    <SelectItem key={locale} value={locale} data-testid={`option-runtime-locale-${locale}`}>
                      {locale}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-0">
              <Label
                htmlFor="runtime-device-filter"
                className="text-xs text-muted-foreground inline-flex items-center gap-1.5"
              >
                <MonitorSmartphone className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Device
              </Label>
              <Select value={deviceFilter} onValueChange={(device) => patchDraft({ device })}>
                <SelectTrigger
                  id="runtime-device-filter"
                  className="h-8 text-sm"
                  data-testid="select-runtime-device-filter"
                >
                  <SelectValue placeholder="All devices" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL}>All devices</SelectItem>
                  {devices.map((device) => (
                    <SelectItem key={device} value={device} data-testid={`option-runtime-device-${device}`}>
                      {deviceLabel(device)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="runtime-source-filter" className="text-xs text-muted-foreground">
              Source
            </Label>
            <Select value={sourceFilter} onValueChange={(source) => patchDraft({ source })}>
              <SelectTrigger
                id="runtime-source-filter"
                className="h-8 text-sm"
                data-testid="select-runtime-source-filter"
              >
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>All sources</SelectItem>
                {SOURCE_FILTER_TAGS.map((tag) => (
                  <SelectItem key={tag} value={tag} data-testid={`option-runtime-source-${tag}`}>
                    {sourceLabel(tag)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="runtime-referrer-filter" className="text-xs text-muted-foreground">
              Referrer
            </Label>
            <Input
              id="runtime-referrer-filter"
              value={referrerQuery}
              onChange={(e) => patchDraft({ referrerQuery: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleApply();
                }
              }}
              placeholder="Contains…"
              className="h-8 text-sm"
              data-testid="input-runtime-referrer-filter"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={handleClear} data-testid="button-clear-runtime-filters">
            Clear
          </Button>
          <Button size="sm" onClick={handleApply} data-testid="button-apply-runtime-filters">
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
