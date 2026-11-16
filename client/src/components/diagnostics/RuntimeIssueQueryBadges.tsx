import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AdsCampaignDetailModal,
  isCampaignLookupValue,
} from "@/components/diagnostics/AdsCampaignDetailModal";
import { sortParamKeysForDisplay, type RuntimeQueryAttribution } from "@shared/runtime-issues";

function badgeLabel(kind: "source" | "medium" | "campaign", values: string[]): string {
  const first = values[0] ?? "";
  if (values.length <= 1) return `${kind}: ${first}`;
  return `${kind}: ${first} (+${values.length - 1})`;
}

function QueryAttributionBadge({
  kind,
  values,
  fingerprint,
  issuePath,
  sourceHints,
}: {
  kind: "source" | "medium" | "campaign";
  values: string[];
  fingerprint: string;
  issuePath?: string;
  sourceHints?: string[];
}) {
  const [campaignValue, setCampaignValue] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  if (values.length === 0) return null;

  if (kind !== "campaign") {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="cursor-pointer max-w-[180px]"
            data-testid={`badge-runtime-query-${kind}-${fingerprint}`}
          >
            <Badge variant="outline" className="text-[10px] max-w-[180px] truncate">
              {badgeLabel(kind, values)}
            </Badge>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-80 space-y-2 text-sm"
          data-testid={`popover-runtime-query-${kind}-${fingerprint}`}
        >
          <p className="font-medium text-foreground capitalize">{kind}</p>
          <ul className="text-muted-foreground space-y-1">
            {values.map((value) => (
              <li key={value} className="font-mono text-xs break-all">
                {value}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    );
  }

  const lookupValues = values.filter(isCampaignLookupValue);
  if (lookupValues.length === 0) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="cursor-pointer max-w-[180px]"
            data-testid={`badge-runtime-query-campaign-${fingerprint}`}
          >
            <Badge variant="outline" className="text-[10px] max-w-[180px] truncate">
              {badgeLabel("campaign", values)}
            </Badge>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-2 text-sm">
          <p className="font-medium text-foreground">campaign</p>
          <p className="text-xs text-muted-foreground">
            This value is not a Meta or Google campaign id we can look up.
          </p>
          <ul className="text-muted-foreground space-y-1">
            {values.map((value) => (
              <li key={value} className="font-mono text-xs break-all">
                {value}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    );
  }

  const openCampaign = (value: string) => {
    setPickerOpen(false);
    setCampaignValue(value);
  };

  return (
    <>
      {lookupValues.length === 1 ? (
        <button
          type="button"
          className="cursor-pointer max-w-[180px]"
          data-testid={`badge-runtime-query-campaign-${fingerprint}`}
          onClick={() => openCampaign(lookupValues[0]!)}
        >
          <Badge variant="outline" className="text-[10px] max-w-[180px] truncate hover:border-primary/50">
            {badgeLabel("campaign", values)}
          </Badge>
        </button>
      ) : (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="cursor-pointer max-w-[180px]"
              data-testid={`badge-runtime-query-campaign-${fingerprint}`}
            >
              <Badge variant="outline" className="text-[10px] max-w-[180px] truncate hover:border-primary/50">
                {badgeLabel("campaign", values)}
              </Badge>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-80 space-y-2 text-sm"
            data-testid={`popover-runtime-query-campaign-picker-${fingerprint}`}
          >
            <p className="font-medium text-foreground">Pick a campaign</p>
            <p className="text-xs text-muted-foreground">Open details for one of the tagged campaigns.</p>
            <ul className="space-y-1">
              {lookupValues.map((value) => (
                <li key={value}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-start font-mono text-xs h-auto py-1.5 whitespace-normal break-all"
                    onClick={() => openCampaign(value)}
                  >
                    {value}
                  </Button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
      <AdsCampaignDetailModal
        open={!!campaignValue}
        onOpenChange={(open) => {
          if (!open) setCampaignValue(null);
        }}
        value={campaignValue}
        issuePath={issuePath}
        sourceHints={sourceHints}
      />
    </>
  );
}

function ParamBadge({
  other,
  fingerprint,
}: {
  other: Record<string, string[]>;
  fingerprint: string;
}) {
  const keys = sortParamKeysForDisplay(Object.keys(other));
  if (keys.length === 0) return null;

  const lines = keys.flatMap((key) =>
    (other[key] ?? []).map((value) => `${key}=${value}`),
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-pointer"
          data-testid={`badge-runtime-query-param-${fingerprint}`}
        >
          <Badge variant="outline" className="text-[10px]">
            param ({keys.length})
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 space-y-2 text-sm"
        data-testid={`popover-runtime-query-param-${fingerprint}`}
      >
        <p className="font-medium text-foreground">Other query params</p>
        <p className="text-xs text-muted-foreground">
          Other keys on the 404 request (e.g. utm_content). Click ids (gclid, fbclid) are hashed on
          recent samples, not listed here. utm_* keys are listed first. Staff preview URLs
          (force_variant, edit, etc.) are not recorded.
        </p>
        <ul className="text-muted-foreground space-y-1 max-h-48 overflow-y-auto">
          {lines.map((line) => (
            <li key={line} className="font-mono text-xs break-all">
              {line}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function RuntimeIssueQueryBadges({
  attribution,
  fingerprint,
  issuePath,
}: {
  attribution?: RuntimeQueryAttribution;
  fingerprint: string;
  /** Runtime-issue path — used to highlight match/mismatch in the campaign modal. */
  issuePath?: string;
}) {
  if (!attribution) return null;
  const source = attribution.source ?? [];
  const medium = attribution.medium ?? [];
  const campaign = attribution.campaign ?? [];
  const other = attribution.other ?? {};
  if (source.length === 0 && medium.length === 0 && campaign.length === 0 && Object.keys(other).length === 0) {
    return null;
  }

  return (
    <>
      <QueryAttributionBadge kind="source" values={source} fingerprint={fingerprint} />
      <QueryAttributionBadge kind="medium" values={medium} fingerprint={fingerprint} />
      <QueryAttributionBadge
        kind="campaign"
        values={campaign}
        fingerprint={fingerprint}
        issuePath={issuePath}
        sourceHints={source}
      />
      <ParamBadge other={other} fingerprint={fingerprint} />
    </>
  );
}
