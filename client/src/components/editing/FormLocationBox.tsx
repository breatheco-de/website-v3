import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Link2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { emitContentUpdated } from "@/lib/contentEvents";
import { cn } from "@/lib/utils";
import {
  formPageLocationMismatch,
  hasUnresolvedTemplate,
  pageLocationValues,
  parseFormLocationPolicy,
  resolveFormLocationSource,
} from "@shared/formLocationPolicy";

type LocationOption = { slug: string; name: string; city: string; country: string; region: string };

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
}

function nextConfig(current: unknown, locations: string[]): Record<string, unknown> | undefined {
  const base =
    current && typeof current === "object" && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
  delete base.default;
  delete base.allowed;
  if (locations.length === 1) base.default = locations[0];
  else if (locations.length > 1) base.allowed = locations;
  return Object.keys(base).length > 0 ? base : undefined;
}

export function FormLocationBox(props: FormLocationBoxProps) {
  const { toast } = useToast();
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

  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const draft = props.variant || urlParams?.get("force_variant") || urlParams?.get("variant") || null;

  const current = source.layer === "form" ? source.locations : source.layer === "entry" ? source.locations : [];
  const [pending, setPending] = useState<string[] | null>(null);
  const selected = pending ?? current;
  const dirty = pending !== null && pending.join(",") !== current.join(",");
  const [confirm, setConfirm] = useState<null | "page" | "form">(null);
  const [clearOthers, setClearOthers] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const post = async (body: Record<string, unknown>) => {
    const res = await apiRequest("POST", "/api/content/form-location", {
      contentType: props.contentType,
      slug: props.slug,
      locale: props.locale,
      ...(draft ? { variant: draft } : {}),
      ...body,
    });
    return (await res.json()) as {
      updated_locales?: string[];
      unmatched_locales?: string[];
      cleared_overrides?: number;
    };
  };

  const saveWholePage = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      const out = await post({
        scope: "page",
        locations: pending,
        clearOverrideIndexes: clearOthers ? props.otherOverrideIndexes : [],
      });
      // This form follows the page from now on.
      props.onFormLocationChange(nextConfig(props.formLocation, []));
      setPending(null);
      emitContentUpdated({ contentType: props.contentType, slug: props.slug, locale: props.locale });
      toast({
        title: draft ? "Saved in this draft" : "Page locations saved",
        description: [
          draft
            ? "Goes live for every language when the draft is published."
            : "Every form on this page without its own location uses it now.",
          out.cleared_overrides ? `Cleared ${out.cleared_overrides} form override(s).` : "",
          "Save this section to stop this form overriding the page.",
        ]
          .filter(Boolean)
          .join(" "),
      });
    } catch (err) {
      toast({ title: "Could not save page locations", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  };

  const saveThisForm = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      props.onFormLocationChange(nextConfig(props.formLocation, pending));
      const out = await post({ scope: "form", locations: pending, section: props.section });
      setPending(null);
      const updated = out.updated_locales ?? [];
      const unmatched = out.unmatched_locales ?? [];
      toast({
        title: "Form location set",
        description: [
          "Save this section to apply it here.",
          updated.length ? `Already saved in: ${updated.join(", ")}.` : "",
          unmatched.length ? `Couldn't find this form in: ${unmatched.join(", ")} — set it there by hand.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
    } catch (err) {
      toast({ title: "Could not save the other languages", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  };

  const clearOwn = () => {
    props.onFormLocationChange(nextConfig(props.formLocation, []));
    setPending(null);
  };

  const sourceLine = (() => {
    switch (source.layer) {
      case "form":
        return source.own?.mode === "picker" && source.locations.length === 0
          ? "Visitors pick from every campus (set on this form)."
          : `Set on this form: ${list(source.locations)}.`;
      case "entry":
        return `From this page's Locations: ${list(source.locations)}.`;
      case "autodetect":
        return "Detected from the visitor's location.";
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
        {source.layer === "missing" ? (
          <Badge variant="destructive" className="text-[10px]" data-testid="badge-form-location-missing">
            Missing
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            {source.layer === "form" ? "This form" : source.layer === "entry" ? "This page" : "Detected"}
          </Badge>
        )}
      </div>

      {source.layer === "missing" ? (
        <p className="text-xs text-destructive" data-testid="text-form-location-missing">
          No location yet. This page type doesn't allow detection, so saving or publishing is blocked until you set one
          for the whole page or for this form.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="text-form-location-source">
          {sourceLine}
        </p>
      )}
      {mismatch ? (
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
        onChange={(vals) => setPending(vals)}
        label="Pick campuses"
        searchPlaceholder="Search locations…"
        groupLabels={groupLabels}
        isLoading={props.formOptionsLoading}
        testIdPrefix="form-location"
        emptyMessage="No locations found"
      />

      <div className="flex flex-wrap gap-2">
        {dirty && entryField ? (
          <>
            <Button size="sm" disabled={saving} onClick={() => setConfirm("page")} data-testid="button-form-location-page">
              Whole page
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => (linkedVariable ? setConfirm("form") : void saveThisForm())}
              data-testid="button-form-location-form"
            >
              This form only
            </Button>
          </>
        ) : null}
        {dirty && !entryField ? (
          <Button
            size="sm"
            disabled={saving}
            onClick={() => (linkedVariable ? setConfirm("form") : void saveThisForm())}
            data-testid="button-form-location-form"
          >
            Set on this form
          </Button>
        ) : null}
        {dirty ? (
          <Button size="sm" variant="ghost" onClick={() => setPending(null)} disabled={saving}>
            Cancel
          </Button>
        ) : null}
        {!dirty && source.layer === "form" ? (
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
            "This form only" also updates the same form in the page's other languages. The page type setting lives in the
            content type dashboard (Form location).
          </p>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => (!open ? setConfirm(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "page" ? "Use these locations for the whole page?" : "Set this form's location?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {confirm === "page" ? (
                  <>
                    <p>
                      The page's Locations become: <strong>{list(pending ?? [])}</strong>
                      {pageValues.length ? ` (was ${list(pageValues)})` : ""}. Every form without its own location
                      follows it, in every language.
                    </p>
                    {draft ? (
                      <p>This is saved in the draft "{draft}" and goes live when the draft is published.</p>
                    ) : null}
                    {props.otherOverrideIndexes.length > 0 ? (
                      <label className="flex items-start gap-2">
                        <Checkbox
                          checked={clearOthers}
                          onCheckedChange={(v) => setClearOthers(v === true)}
                          data-testid="checkbox-form-location-clear-others"
                        />
                        <span>
                          Also clear {props.otherOverrideIndexes.length} other form(s) on this page that set their own
                          location, so they follow the page.
                        </span>
                      </label>
                    ) : null}
                  </>
                ) : (
                  <p>This form's location becomes {list(pending ?? [])}, in every language of this page.</p>
                )}
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
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(e) => {
                e.preventDefault();
                void (confirm === "page" ? saveWholePage() : saveThisForm());
              }}
              data-testid="button-form-location-confirm"
            >
              {confirm === "page" ? "Save for the whole page" : "Set on this form"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
