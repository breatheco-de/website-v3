import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Link2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { cn } from "@/lib/utils";
import {
  formPageLocationMismatch,
  hasUnresolvedTemplate,
  pageLocationValues,
  parseFormLocationPolicy,
  resolveFormLocationSource,
} from "@shared/formLocationPolicy";

type LocationOption = { slug: string; name: string; city: string; country: string; region: string };

/** Pending location picker state for Save-time scope (this form vs whole page). */
export interface FormLocationPendingSelection {
  locations: string[];
  /** Layer when the staff started editing the picker (before this pending edit). */
  baselineLayer: "form" | "entry" | "autodetect" | "missing";
  /** Page Locations values at baseline (for clear-page detection). */
  baselinePageValues: string[];
}

export interface FormLocationBoxProps {
  contentType: string;
  slug: string;
  locale: string;
  /** Draft name when editing a draft (page-wide choices are staged in it). */
  variant?: string | null;
  section: { index: number; id?: string | null; type: string };
  /** This form's `fields.location` as stored in the section YAML. */
  formLocation: unknown;
  singleEntry?: Record<string, unknown>;
  /** Other forms on this page (editor's language) that set their own location. */
  otherOverrideIndexes: number[];
  formOptions?: { locations: LocationOption[]; regions: Array<{ slug: string; label: string }> };
  formOptionsLoading?: boolean;
  /** Write this form's `fields.location` in the section YAML (saved with the section). */
  onFormLocationChange: (next: Record<string, unknown> | undefined) => void;
  /** Controlled pending picker (null = show derived source). Parent clears after Save. */
  pendingSelection?: FormLocationPendingSelection | null;
  onPendingSelectionChange?: (pending: FormLocationPendingSelection | null) => void;
}

/** The new `fields.location` object for a form: one = default, several = allowed, none = cleared. */
export function nextFormLocationConfig(
  current: unknown,
  locations: string[],
): Record<string, unknown> | undefined {
  const base =
    current && typeof current === "object" && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
  delete base.default;
  delete base.allowed;
  if (locations.length === 1) base.default = locations[0];
  else if (locations.length > 1) base.allowed = locations;
  return Object.keys(base).length > 0 ? base : undefined;
}

/** Slugs stored on a form's `fields.location` (default or allowed). */
export function locationSlugsFromFormConfig(formLocation: unknown): string[] {
  if (!formLocation || typeof formLocation !== "object" || Array.isArray(formLocation)) return [];
  const loc = formLocation as Record<string, unknown>;
  if (Array.isArray(loc.allowed)) {
    return loc.allowed.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim());
  }
  if (typeof loc.default === "string" && loc.default.trim() && loc.default.trim() !== "auto") {
    if (hasUnresolvedTemplate(loc.default)) return [];
    return [loc.default.trim()];
  }
  if (Array.isArray(loc.default)) {
    return loc.default.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim());
  }
  return [];
}

export function FormLocationBox(props: FormLocationBoxProps) {
  const { data: typeConfig } = useQuery<Record<string, unknown>>({
    queryKey: [`/api/content-types/${props.contentType}/config`],
    enabled: !!props.contentType,
    staleTime: 5 * 60 * 1000,
  });
  const policy = parseFormLocationPolicy(typeConfig);
  const entryField = policy?.entryField ?? null;
  const form = useMemo(() => ({ fields: { location: props.formLocation } }), [props.formLocation]);
  const source = resolveFormLocationSource({ form, entry: props.singleEntry, policy });
  const pageValues = pageLocationValues(props.singleEntry, entryField);
  const ownValues = source.layer === "form" ? source.locations : [];
  const mismatch = formPageLocationMismatch(ownValues, pageValues);
  const linkedVariable = (() => {
    const loc = props.formLocation as { default?: unknown } | undefined;
    return typeof loc?.default === "string" && hasUnresolvedTemplate(loc.default) ? loc.default : null;
  })();

  const pending = props.pendingSelection ?? null;

  /** Derived locations shown when there is no pending picker edit. */
  const derivedSelected =
    source.layer === "form" ? source.locations : source.layer === "entry" ? source.locations : [];

  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [pendingUnlink, setPendingUnlink] = useState<string[] | null>(null);

  const selected = pending?.locations ?? derivedSelected;

  const nameOf = (slug: string) => props.formOptions?.locations.find((l) => l.slug === slug)?.name ?? slug;
  const list = (values: string[]) => values.map(nameOf).join(", ");

  const options = useMemo(
    () =>
      (props.formOptions?.locations ?? []).map((loc) => ({
        value: loc.slug,
        label: `${loc.name} — ${loc.city}`,
        group: loc.region,
        badgeLabel: loc.city,
        searchTerms: [loc.city, loc.country, loc.slug, loc.name],
      })),
    [props.formOptions?.locations],
  );
  const groupLabels = Object.fromEntries((props.formOptions?.regions ?? []).map((r) => [r.slug, r.label]));

  const applyFormLocations = (locations: string[]) => {
    props.onFormLocationChange(nextFormLocationConfig(props.formLocation, locations));
  };

  const commitPick = (vals: string[]) => {
    const layer = pending?.baselineLayer ?? source.layer;
    const pageBaseline = pending != null ? pending.baselinePageValues : pageValues;
    const nextPending: FormLocationPendingSelection = {
      locations: vals,
      baselineLayer: layer,
      baselinePageValues: pageBaseline,
    };
    props.onPendingSelectionChange?.(nextPending);

    // Stage form YAML for non-empty picks and for clearing a form override.
    // When following the page and clearing to empty, do not stage (would snap back to page).
    if (vals.length > 0) {
      applyFormLocations(vals);
    } else if (source.layer === "form" || layer === "form") {
      applyFormLocations([]);
    }
  };

  const onPickLocations = (vals: string[]) => {
    if (linkedVariable) {
      setPendingUnlink(vals);
      setUnlinkOpen(true);
      return;
    }
    commitPick(vals);
  };

  const confirmUnlink = () => {
    if (pendingUnlink) commitPick(pendingUnlink);
    setPendingUnlink(null);
    setUnlinkOpen(false);
  };

  const clearOwn = () => {
    const nextPending: FormLocationPendingSelection = {
      locations: [],
      baselineLayer: "form",
      baselinePageValues: pageValues,
    };
    props.onPendingSelectionChange?.(nextPending);
    applyFormLocations([]);
  };

  const sourceLine = (() => {
    if (pending != null) {
      if (pending.locations.length === 0) {
        return pending.baselineLayer === "entry"
          ? "Cleared — Save to keep following the page, or clear locations for the whole page."
          : entryField
            ? "Cleared on this form — Save to follow the page (or choose whole page)."
            : "Cleared on this form — Save to use detection.";
      }
      return entryField
        ? `Pending: ${list(pending.locations)}. Save to choose this form or the whole page.`
        : `Pending: ${list(pending.locations)}. Save the section to apply.`;
    }
    switch (source.layer) {
      case "form":
        return source.own?.mode === "picker" && source.locations.length === 0
          ? "Visitors pick from every location (set on this form)."
          : `Set on this form: ${list(source.locations)}.`;
      case "entry":
        return `From this page's Locations: ${list(source.locations)}.`;
      case "autodetect":
        return "Detected from the visitor's location. Pick locations, then Save the section.";
      default:
        return null;
    }
  })();

  return (
    <div className="rounded-md border bg-muted/40 p-3 space-y-3" data-testid="card-form-location">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">Location</span>
        </div>
        {source.layer === "missing" && pending == null ? (
          <Badge variant="destructive" className="text-[10px]" data-testid="badge-form-location-missing">
            Missing
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            {pending != null
              ? "Pending"
              : source.layer === "form"
                ? "This form"
                : source.layer === "entry"
                  ? "This page"
                  : "Detected"}
          </Badge>
        )}
      </div>

      {source.layer === "missing" && pending == null ? (
        <p className="text-xs text-destructive" data-testid="text-form-location-missing">
          No location yet. This page type doesn't allow detection, so saving or publishing is blocked until you set one
          for the whole page or for this form (pick locations, then Save).
        </p>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="text-form-location-source">
          {sourceLine}
        </p>
      )}
      {mismatch && pending == null ? (
        <p className="text-xs text-amber-600 dark:text-amber-400 flex gap-1" data-testid="text-form-location-mismatch">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          This form overrides the page ({list(pageValues)}). The form's location wins.
        </p>
      ) : null}
      {linkedVariable ? (
        <p className="text-xs text-muted-foreground flex gap-1">
          <Link2 className="h-3.5 w-3.5 shrink-0" />
          Linked to <code className="font-mono">{linkedVariable}</code>.
        </p>
      ) : null}

      <SearchableMultiSelect
        options={options}
        value={selected}
        onChange={onPickLocations}
        label="Pick locations"
        searchPlaceholder="Search locations…"
        groupLabels={groupLabels}
        isLoading={props.formOptionsLoading}
        testIdPrefix="form-location"
        emptyMessage="No locations found"
      />

      <div className="flex flex-wrap gap-2">
        {source.layer === "form" && pending == null ? (
          <Button size="sm" variant="ghost" onClick={clearOwn} data-testid="button-form-location-clear">
            {entryField ? "Follow the page" : "Use detection"}
          </Button>
        ) : null}
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <ChevronDown className="h-3 w-3" />
          Read more (advanced)
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 text-[11px] text-muted-foreground space-y-1">
          <p>
            Order: this form's <code className="font-mono">fields.location</code> (one location ={" "}
            <code className="font-mono">default</code>, several = <code className="font-mono">allowed</code>), then the
            page field{" "}
            <code className="font-mono">{entryField ?? "(none set for this page type)"}</code> in{" "}
            <code className="font-mono">_common.yml</code>, then visitor detection
            {policy && !policy.autodetect ? " (turned off for this page type)" : ""}.
          </p>
          <p>One location is hidden and locked; several show a required dropdown with the visitor's city pre-selected.</p>
          <p>
            Picking locations stages a change. Section Save asks whether to apply it on this form only or the whole page
            (when this page type has a Locations field). This form only writes this language and the same form in the
            page's other languages. Whole page writes the page Locations field. The page type setting lives in the
            content type dashboard (Form location).
          </p>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog
        open={unlinkOpen}
        onOpenChange={(open) => {
          if (!open) {
            setUnlinkOpen(false);
            setPendingUnlink(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect linked location?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This form's location becomes {list(pendingUnlink ?? [])}. Save the section to apply it here and in
                  other languages.
                </p>
                {linkedVariable ? (
                  <p className={cn("text-amber-600 dark:text-amber-400")}>
                    This form's location is linked to <code className="font-mono">{linkedVariable}</code>. Continuing
                    disconnects it.
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmUnlink();
              }}
              data-testid="button-form-location-confirm"
            >
              Disconnect and set
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
