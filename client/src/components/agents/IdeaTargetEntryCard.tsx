import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { IconChevronDown, IconPackage, IconUser } from "@tabler/icons-react";
import { AlertTriangle, Filter, Hash } from "lucide-react";
import { PersonaReminderPopover } from "@/components/DebugBubble/components/FunnelTab";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { badgeVariants } from "@/components/ui/badge";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ToggleButtonBarList, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import {
  FUNNEL_STAGE_ICON,
  FUNNEL_STAGE_ICON_TONE,
  FUNNEL_STAGE_LABEL,
  FUNNEL_STAGE_TAPER,
  FUNNEL_STAGE_TONE,
} from "@/lib/funnel-stage-ui";
import { FUNNEL_STAGES, type FunnelStage } from "@shared/funnel";
import { cn } from "@/lib/utils";

export type IdeaContentTypeStrategyPayload = {
  contentType: string;
  role: "pitched" | "accepted";
  purpose?: string;
  constraints?: string[];
  missing?: true;
};

type TargetEntry = { contentType: string; slug: string; locale: string };

export type IdeaFunnel = {
  stage: string;
  products: "all" | Array<{ product: string; persona?: string }>;
};

function typeLabel(contentType: string): string {
  const words = contentType.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : contentType;
}

const FIELD_LABEL = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

function isFunnelStage(stage: string): stage is FunnelStage {
  return (FUNNEL_STAGES as readonly string[]).includes(stage);
}

function PageTypePopover({
  contentType,
  strategy,
  typeChanged,
}: {
  contentType: string;
  strategy: IdeaContentTypeStrategyPayload | null;
  typeChanged: boolean;
}) {
  const [advanced, setAdvanced] = useState(false);
  const label = typeLabel(contentType);
  const hasPurpose = Boolean(strategy && !strategy.missing && strategy.purpose);
  const pitchedOnly = typeChanged && strategy?.role === "pitched";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            badgeVariants({ variant: "outline" }),
            "cursor-pointer gap-1 font-medium",
            pitchedOnly && "text-muted-foreground",
          )}
          data-testid={`button-idea-type-${contentType}`}
          aria-label={`${label} — what this page type is for`}
        >
          {label}
          <IconChevronDown className="h-3 w-3 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-3 text-sm"
        align="start"
        data-testid={`popover-idea-type-${contentType}`}
      >
        <p className="font-medium text-foreground">{label} — what this page type is for</p>
        {hasPurpose ? (
          <p className="text-muted-foreground leading-5" data-testid={`text-idea-type-purpose-${contentType}`}>
            {strategy!.purpose}
          </p>
        ) : (
          <p className="text-muted-foreground leading-5" data-testid={`text-idea-type-missing-${contentType}`}>
            This page type has no strategy yet, so there is nothing to check the idea against. Set one with the{" "}
            <Link href={`/private/type/${contentType}`} className="text-primary hover:underline">
              Strategy button on the {label} page
            </Link>
            .
          </p>
        )}
        <p className="text-muted-foreground leading-5">
          <span className="font-medium text-foreground">How to use it: </span>
          {pitchedOnly
            ? "This is the type the idea was pitched as. It was accepted as a different type, and follow-up edits must fit that one."
            : "Accept only if the idea fits this purpose. The follow-up edit for the reserved page must fit it too."}
        </p>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          data-testid={`button-idea-type-advanced-${contentType}`}
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? "Hide advanced" : "Read more (advanced)"}
        </button>
        {advanced ? (
          <div className="space-y-2 border-t pt-2 text-xs text-muted-foreground leading-5">
            {strategy?.constraints?.length ? (
              <div>
                <p className="font-medium text-foreground">Constraints</p>
                <ul className="list-disc pl-4">
                  {strategy.constraints.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p>
              From <code className="font-mono">strategy</code> in{" "}
              <code className="font-mono">content-types.yml</code> for{" "}
              <code className="font-mono">{contentType}</code>. Reviewers see the same text as a &quot;fits page
              type&quot; check. Editing it does not change existing pages.
            </p>
            <Link href={`/private/type/${contentType}`} className="text-primary hover:underline">
              Open {label} page type
            </Link>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

type ProductMapRow = {
  content_slug: string;
  name: string;
  personas?: { id: string; label: string }[];
};

function humanizeSlug(slug: string): string {
  return typeLabel(slug.replace(/^the[-_]/, ""));
}

function AudienceCards({ bindings }: { bindings: Array<{ product: string; persona?: string }> }) {
  const { data } = useQuery<{ products: ProductMapRow[] }>({
    queryKey: ["/api/ecommerce/product-map"],
    staleTime: 5 * 60 * 1000,
  });
  const bySlug = new Map((data?.products ?? []).map((p) => [p.content_slug, p]));

  return (
    <div className="grid gap-2 @xl:grid-cols-2" data-testid="badge-idea-funnel">
      {bindings.map((b) => {
        const product = bySlug.get(b.product);
        const productName = product?.name || b.product;
        const personaLabel = b.persona
          ? product?.personas?.find((p) => p.id === b.persona)?.label || humanizeSlug(b.persona)
          : null;
        return (
          <div
            key={`${b.product}/${b.persona ?? ""}`}
            className="flex min-w-0 items-start gap-2.5 rounded-md border border-card-border bg-card px-3 py-2"
            data-testid={`card-idea-audience-${b.product}${b.persona ? `-${b.persona}` : ""}`}
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <IconUser className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <p className="truncate text-sm font-medium text-foreground" title={b.persona}>
                  {personaLabel ?? "Any persona"}
                </p>
                {b.persona ? (
                  <PersonaReminderPopover
                    productSlug={b.product}
                    personaId={b.persona}
                    label={personaLabel ?? b.persona}
                  />
                ) : null}
              </div>
              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground" title={b.product}>
                <IconPackage className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{productName}</span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FunnelSummary({
  funnel,
  locked,
  editor,
}: {
  funnel: IdeaFunnel | null | undefined;
  locked: boolean;
  editor?: ReactNode;
}) {
  const stage = funnel && isFunnelStage(funnel.stage) ? funnel.stage : null;
  const StageIcon = stage ? FUNNEL_STAGE_ICON[stage] : null;
  const taper = stage ? FUNNEL_STAGE_TAPER[stage] : null;

  return (
    <div className="space-y-3" data-testid="proposal-idea-funnel">
      <p className="text-xs text-muted-foreground">
        {locked
          ? "Funnel locked at accept (read-only). It was copied into the new page."
          : "Where this page sits in the buyer journey and who it is for. Locked when the idea is accepted and copied into the new page."}
      </p>
      <dl className="grid gap-x-6 gap-y-3 @xl:grid-cols-3">
        <div className="min-w-0 space-y-1" data-testid="meta-idea-funnel-stage">
          <dt className={FIELD_LABEL}>Stage</dt>
          {stage && StageIcon && taper ? (
            <dd
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm font-medium",
                FUNNEL_STAGE_TONE[taper],
              )}
              data-testid="text-idea-funnel-stage"
            >
              <StageIcon className={cn("h-4 w-4 shrink-0", FUNNEL_STAGE_ICON_TONE[taper])} />
              {FUNNEL_STAGE_LABEL[stage]}
            </dd>
          ) : funnel ? (
            <dd className="text-sm text-foreground" data-testid="text-idea-funnel-stage">
              {funnel.stage}
            </dd>
          ) : (
            <dd className="text-sm text-status-away" data-testid="text-idea-funnel-missing">
              Not set
            </dd>
          )}
        </div>
        <div className="min-w-0 space-y-1 @xl:col-span-2" data-testid="meta-idea-funnel-audience">
          <dt className={FIELD_LABEL}>Audience</dt>
          {!funnel ? (
            <dd className="text-sm text-muted-foreground">Not set</dd>
          ) : funnel.products === "all" ? (
            <dd className="text-sm text-foreground">Everyone · all products</dd>
          ) : (
            <dd>
              <AudienceCards bindings={funnel.products} />
            </dd>
          )}
        </div>
      </dl>
      {!funnel && !locked ? (
        <p className="text-xs text-muted-foreground">
          New pages need a stage and products. Accept won&apos;t reserve a new page without them.
        </p>
      ) : null}
      {editor ? <div className="border-t border-card-border pt-3">{editor}</div> : null}
    </div>
  );
}

/**
 * The page an idea will become: page type (click for its strategy), reserved slug and locale,
 * then Keywords and Funnel tabs laid out like the entry meta modal.
 */
export function IdeaTargetEntryCard({
  strategies,
  acceptedEntry,
  pitchedTypes,
  createModeNote,
  reservedInfo,
  keywordsPanel,
  keywordsMissing,
  funnel,
  funnelLocked,
  funnelEditor,
}: {
  strategies: IdeaContentTypeStrategyPayload[];
  acceptedEntry: TargetEntry | null;
  /** Fallback when the server sends no strategies (types named in related entries). */
  pitchedTypes: string[];
  createModeNote?: string | null;
  reservedInfo?: ReactNode;
  keywordsPanel: ReactNode;
  keywordsMissing: boolean;
  funnel: IdeaFunnel | null | undefined;
  funnelLocked: boolean;
  funnelEditor?: ReactNode;
}) {
  const funnelMissing = !funnel && !funnelLocked;
  const [tab, setTab] = useState<"keywords" | "funnel">(
    !keywordsMissing && funnelMissing ? "funnel" : "keywords",
  );
  const byType = new Map(strategies.map((s) => [s.contentType, s]));
  const acceptedType = acceptedEntry?.contentType ?? null;
  const pitched = strategies.length
    ? strategies.filter((s) => s.role === "pitched").map((s) => s.contentType)
    : pitchedTypes.filter((ct) => ct !== acceptedType);
  const typeChanged = Boolean(acceptedType && pitched.length);
  const shownTypes = acceptedType ? [acceptedType] : pitched;
  const missingStrategy = shownTypes.filter((ct) => byType.get(ct)?.missing);

  return (
    <div
      className="basis-full space-y-3 rounded-md border border-card-border bg-muted/30 px-4 py-3"
      data-testid="card-idea-target-entry"
    >
      <p className="text-xs font-semibold text-foreground">Target entry</p>
      <dl className="grid gap-x-6 gap-y-3 @xl:grid-cols-3">
        <div className="min-w-0 space-y-1" data-testid="meta-idea-target-type">
          <dt className={FIELD_LABEL}>{shownTypes.length > 1 ? "Types" : "Type"}</dt>
          {shownTypes.length ? (
            <dd className="flex flex-wrap items-center gap-1.5">
              {shownTypes.map((ct) => (
                <PageTypePopover
                  key={ct}
                  contentType={ct}
                  strategy={byType.get(ct) ?? null}
                  typeChanged={typeChanged}
                />
              ))}
            </dd>
          ) : (
            <dd className="text-sm text-muted-foreground">Not named yet</dd>
          )}
          {typeChanged ? (
            <dd className="text-xs text-muted-foreground" data-testid="text-idea-type-changed">
              Pitched as{" "}
              {pitched.map((ct, i) => (
                <span key={ct}>
                  {i > 0 ? ", " : null}
                  <PageTypePopover contentType={ct} strategy={byType.get(ct) ?? null} typeChanged />
                </span>
              ))}
            </dd>
          ) : null}
          {missingStrategy.length ? (
            <dd className="text-xs text-muted-foreground" data-testid="text-idea-type-no-strategy">
              No strategy yet
            </dd>
          ) : null}
        </div>
        <div className="min-w-0 space-y-1" data-testid="meta-idea-target-slug">
          <dt className={cn(FIELD_LABEL, "inline-flex items-center gap-0.5")}>
            Reserved slug
            {acceptedEntry ? reservedInfo : null}
          </dt>
          {acceptedEntry ? (
            <dd className="break-all font-mono text-sm text-foreground" data-testid="text-idea-target-slug">
              {acceptedEntry.slug}
            </dd>
          ) : (
            <>
              <dd className="text-sm text-muted-foreground">Not reserved yet</dd>
              <dd className="text-xs text-muted-foreground">Set when the idea is accepted</dd>
            </>
          )}
        </div>
        {acceptedEntry ? (
          <div className="min-w-0 space-y-1" data-testid="meta-idea-target-locale">
            <dt className={FIELD_LABEL}>Locale</dt>
            <dd className="inline-flex items-center gap-1.5 text-sm text-foreground">
              <LocaleFlag locale={acceptedEntry.locale} className="w-4 h-3 rounded-sm" />
              {acceptedEntry.locale}
            </dd>
          </div>
        ) : null}
      </dl>
      {acceptedEntry && createModeNote ? (
        <p className="text-xs text-muted-foreground" data-testid="text-idea-target-create-mode">
          {createModeNote}
        </p>
      ) : null}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "keywords" | "funnel")}
        className="border-t border-card-border pt-3"
      >
        <ToggleButtonBarList className="inline-flex w-auto max-w-full" data-testid="tabs-idea-target">
          <ToggleButtonBarTrigger value="keywords" className="gap-1.5" data-testid="tab-idea-keywords">
            <Hash className="h-3.5 w-3.5 shrink-0" />
            Keywords
            {keywordsMissing ? (
              <AlertTriangle className="h-3 w-3 shrink-0 text-status-away" aria-label="Not set" />
            ) : null}
          </ToggleButtonBarTrigger>
          <ToggleButtonBarTrigger value="funnel" className="gap-1.5" data-testid="tab-idea-funnel">
            <Filter className="h-3.5 w-3.5 shrink-0" />
            Funnel
            {funnelMissing ? (
              <AlertTriangle className="h-3 w-3 shrink-0 text-status-away" aria-label="Not set" />
            ) : null}
          </ToggleButtonBarTrigger>
        </ToggleButtonBarList>
        <TabsContent value="keywords" className="mt-0 pt-3">
          {keywordsPanel}
        </TabsContent>
        <TabsContent value="funnel" className="mt-0 pt-3">
          <FunnelSummary funnel={funnel} locked={funnelLocked} editor={funnelEditor} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
