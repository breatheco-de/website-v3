/**
 * Per-ad-account location limits for Settings → Ads (Meta / Google).
 * Empty selection = all locations (default). Save may require confirm when
 * live ads would be affected.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconAlertTriangle, IconChevronDown, IconMapPin } from "@tabler/icons-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SearchableMultiCombobox } from "@/components/ui/searchable-multi-combobox";
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
import { apiFetch } from "@/lib/queryClient";
import { buildQueryOptionsUrl } from "@shared/parseFormFieldSource";
import type { AccountLocationsMap } from "@shared/adsAccountLocations";

function ReadMore({ testId, children }: { testId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button type="button" className="flex items-center gap-2 text-sm font-medium text-foreground" data-testid={testId}>
          Read more (advanced)
          <IconChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-1 text-xs text-muted-foreground">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export type AccountLocationsAffected = {
  slug: string;
  path: string;
  reasons: string[];
};

type AccountRow = { id: string; label: string };

type Props = {
  platform: "meta" | "google";
  accounts: AccountRow[];
  value: AccountLocationsMap;
  onChange: (next: AccountLocationsMap) => void;
  disabled?: boolean;
  testId?: string;
};

export function AccountLocationsCard({
  platform,
  accounts,
  value,
  onChange,
  disabled,
  testId = `card-${platform}-account-locations`,
}: Props) {
  // English is the reference locale for location slugs (ads-config / diagnostics).
  // Omitting locale would also return Spanish rows with translated slugs (e.g. barcelona-espana).
  const { data: locData, isLoading } = useQuery<{ options: Array<{ value: string; label: string }> }>({
    queryKey: ["/api/query-options", "location", "slug", "name", "en"],
    staleTime: 60_000,
    queryFn: async () => {
      const url = buildQueryOptionsUrl(
        { content_type: "location", value_path: "slug", label_path: "name" },
        "en",
      );
      const res = await apiFetch(url);
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  const locationOptions = useMemo(() => {
    const opts = (locData?.options ?? []).map((o) => ({
      value: o.value,
      label: o.label || o.value,
    }));
    return opts;
  }, [locData]);

  function setAccountLocations(accountId: string, slugs: string[]) {
    const next: AccountLocationsMap = { ...value };
    if (slugs.length === 0) delete next[accountId];
    else next[accountId] = slugs;
    // Drop maps for accounts no longer connected
    for (const id of Object.keys(next)) {
      if (!accounts.some((a) => a.id === id)) delete next[id];
    }
    onChange(next);
  }

  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <IconMapPin className="h-4 w-4" />
          Account locations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          By default every ad account may serve any location. Limit an account to specific campuses so we
          can catch mismatched ads and stop a page from going live when two accounts both advertise it.
        </p>
        {accounts.length === 0 ? (
          <p className="text-muted-foreground">Pick ad accounts above first.</p>
        ) : (
          <div className="space-y-4">
            {accounts.map((a) => (
              <div key={a.id} className="space-y-1.5" data-testid={`${testId}-row-${a.id}`}>
                <p className="text-sm font-medium text-foreground">{a.label}</p>
                <p className="text-xs text-muted-foreground font-mono">{a.id}</p>
                <SearchableMultiCombobox
                  values={value[a.id] ?? []}
                  onChange={(next) => setAccountLocations(a.id, next)}
                  options={locationOptions}
                  placeholder="All locations (default)"
                  searchPlaceholder="Search campuses…"
                  emptyMessage="No locations match"
                  isLoading={isLoading}
                  disabled={disabled}
                  testId={`${testId}-picker-${a.id}`}
                />
                {(value[a.id]?.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground">No limit — this account may serve any location.</p>
                )}
              </div>
            ))}
          </div>
        )}
        <ReadMore testId={`button-${platform}-account-locations-advanced`}>
          <p>
            Stored in <code className="font-mono">ads-config.yml</code> as{" "}
            <code className="font-mono">{platform}.account_locations</code>. Omit or leave empty for an
            account to keep it unrestricted. Values are location content-type slugs.
          </p>
          <p>
            Ads diagnostics warn when a limited account points at a page with no Locations or with
            Locations outside that account&apos;s list. Publishing is blocked only when live ads from
            two or more accounts point at the same page.
          </p>
        </ReadMore>
      </CardContent>
    </Card>
  );
}

/** Confirm dialog when save would affect landings with live ads. */
export function AccountLocationsConfirmDialog(props: {
  open: boolean;
  affected: AccountLocationsAffected[];
  onCancel: () => void;
  onConfirm: () => void;
  confirming?: boolean;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={(open) => !open && props.onCancel()}>
      <AlertDialogContent data-testid="dialog-account-locations-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <IconAlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            These landings would be affected
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                Limiting these ad accounts would change how we check landings that already have live
                ads. Live pages stay as they are until someone republishes. Confirm to save.
              </p>
              <ul className="max-h-60 overflow-y-auto space-y-2 text-left">
                {props.affected.slice(0, 40).map((a) => (
                  <li key={a.slug} className="rounded-md border border-border p-2">
                    <p className="font-medium text-foreground font-mono text-xs">{a.path}</p>
                    <ul className="mt-1 list-disc pl-4 text-xs">
                      {a.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {props.affected.length > 40 && (
                <p className="text-xs">…and {props.affected.length - 40} more.</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-account-locations-confirm-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="button-account-locations-confirm-save"
            onClick={(e) => {
              e.preventDefault();
              props.onConfirm();
            }}
            disabled={props.confirming}
          >
            {props.confirming ? "Saving…" : "Save anyway"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
