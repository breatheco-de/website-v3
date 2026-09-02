import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconShoppingBag,
  IconInfoCircle,
  IconSpeakerphone,
  IconTarget,
  IconShoppingCart,
  IconSchool,
  IconHash,
  IconFileText,
  IconCircleCheck,
  IconPlayerPause,
  IconLayersIntersect,
  IconChartBar,
  IconClick,
} from "@tabler/icons-react";
import { Link, useParams } from "wouter";
import { ArrowLeft, ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { isActivelySelling } from "@/lib/ecommerceProductMap";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SitemapSearch } from "@/components/menus/SitemapSearch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiFetch } from "@/lib/queryClient";
import type { SitemapSearchEntry } from "@/lib/sitemapSearch";
import { type ComponentType, type ReactNode } from "react";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import { AnimatedEllipsis } from "@/components/DebugBubble/components/PipelineCounts";
import { cn } from "@/lib/utils";
import {
  FUNNEL_STAGE_TAPER,
  FUNNEL_STAGE_TONE,
  FUNNEL_TAPER_WIDTH,
  type FunnelStageTaper,
} from "@/lib/funnel-stage-ui";
import { FUNNEL_STAGES, type FunnelBlock, type FunnelStage as FunnelStageKey } from "@shared/funnel";
import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";

interface FunnelStepRow {
  source?: "locked" | "authored" | "auto";
  content_type: string;
  slug: string;
  role?: string;
  urls: Record<string, string>;
  files: string[];
}

interface FunnelResponse {
  product: {
    product_id: string;
    name: string;
    content_type: string;
    content_slug: string;
    actively_selling?: boolean;
    active?: boolean;
    description?: string;
  };
  funnel: {
    locked: FunnelStepRow;
    stages: Record<string, FunnelStepRow[]>;
    stage_order: string[];
  };
  education: { summary: string; advanced_paths: string[] };
}

interface JourneyAnalyticsResponse {
  mode: "page_performance" | "stage_flow";
  status: "ok" | "unavailable" | "not_implemented";
  window_days?: number;
  as_of?: string;
  warnings?: Array<{ code: string; message: string }>;
  message?: string;
  pages?: Record<
    string,
    {
      sessions: number;
      views: number;
      conversions: number;
      ecommerce_intent: number;
      shared: boolean;
      paths: string[];
    }
  >;
  stages?: Record<string, { sessions_distinct: number; page_count: number }>;
  summary?: { sessions_product_specific: number; sessions_shared: number };
  product?: {
    conversions: number;
    ecommerce_intent: number;
    item_id?: string;
    content_slug: string;
  };
}

/** Must match server/ecommerce/journey-analytics.ts lead + ecommerce event lists. */
const PAGE_CONVERSION_EVENTS = ["student_application", "request_more_info"] as const;
const PAGE_ECOMMERCE_EVENTS = [
  "view_item",
  "add_to_cart",
  "view_item_list",
  "select_item",
  "click_begin_checkout",
] as const;

const STAGE_SIGNAL_NOTE =
  "We use the same action events on every stage. “Later” actions on an early-stage page (or soft leads on the product page) can mean the page is in the wrong stage, or that one page is doing more than one job. Treat it as a signal to check — not proof the catalog is wrong.";

const METRIC_HELP = {
  sessions: {
    title: "Sessions",
    body: "Separate visits that included a view of this page (about the last 28 days). If the same person leaves and comes back later, that usually counts as another session. This is not “unique people.”",
    events: ["page_view"] as readonly string[],
    note: undefined as string | undefined,
  },
  views: {
    title: "Views",
    body: "How many times this page was loaded. One visit can add more than one view if someone reloads or returns to the page in the same session.",
    events: ["page_view"] as readonly string[],
    note: undefined as string | undefined,
  },
  conversions: {
    title: "Conversions",
    body: "Form submits for this product that fired while the visitor was on this page’s URLs (not product-wide). Soft and hard leads are both included — stage does not filter the list.",
    events: PAGE_CONVERSION_EVENTS,
    note: STAGE_SIGNAL_NOTE,
  },
  ecommerce_intent: {
    title: "Ecommerce intent",
    body: "Product ecommerce events that fired while the visitor was on this page’s URLs (cart / item interest for this product). Stage does not filter the list.",
    events: PAGE_ECOMMERCE_EVENTS,
    note: STAGE_SIGNAL_NOTE,
  },
} as const;

const STAGE_META: Record<
  string,
  { label: string; description: string; icon: ComponentType<{ className?: string }>; taper: FunnelStageTaper }
> = {
  awareness: {
    label: "Awareness",
    description: "Top of funnel (TOFU) — widest audience, most general.",
    icon: IconSpeakerphone,
    taper: FUNNEL_STAGE_TAPER.awareness,
  },
  consideration: {
    label: "Consideration",
    description: "Middle of funnel (MOFU) — target audience / buyer persona.",
    icon: IconTarget,
    taper: FUNNEL_STAGE_TAPER.consideration,
  },
  decision: {
    label: "Decision",
    description: "Bottom of funnel (BOFU) — ready to buy; includes the locked product page.",
    icon: IconShoppingCart,
    taper: FUNNEL_STAGE_TAPER.decision,
  },
  "post-enrollment": {
    label: "Post-enrollment",
    description: "After purchase — onboarding and upsell paths.",
    icon: IconSchool,
    taper: FUNNEL_STAGE_TAPER["post-enrollment"],
  },
};

function LocaleFlags({ urls }: { urls: Record<string, string> }) {
  const locales = Object.keys(urls);
  if (locales.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1" title={locales.join(", ")}>
      {locales.map((loc) => (
        <LocaleFlag key={loc} locale={loc} className="w-4 h-3 rounded-sm" />
      ))}
    </span>
  );
}

function mergeProductIntoStageFunnel(
  existing: FunnelBlock,
  productSlug: string,
  stageKey: FunnelStageKey,
): { stage: FunnelStageKey; products: string[] | "all" } {
  const products = existing.products;
  let nextProducts: string[] | "all";
  if (products === "all") {
    nextProducts = "all";
  } else if (Array.isArray(products)) {
    nextProducts = products.includes(productSlug) ? products : [...products, productSlug];
  } else {
    nextProducts = [productSlug];
  }
  return { stage: stageKey, products: nextProducts };
}

function AddFunnelContentButton({
  stageKey,
  stageLabel,
  productSlug,
  onSuccess,
}: {
  stageKey: FunnelStageKey;
  stageLabel: string;
  productSlug: string;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const [adding, setAdding] = useState(false);

  const handleSelectEntry = async (entry: SitemapSearchEntry) => {
    const contentType = entry.content_type;
    const slug = entry.slug;
    if (!contentType || !slug) {
      toast({
        title: "Cannot add page",
        description: "Pick a CMS page from search — this URL is not linked to a content entry.",
        variant: "destructive",
      });
      return;
    }

    setAdding(true);
    try {
      const getRes = await apiRequest("GET", `/api/content-types/${contentType}/funnel/${slug}`);
      const getJson = (await getRes.json()) as { funnel?: FunnelBlock; error?: string };
      if (!getRes.ok) throw new Error(getJson.error || "Failed to load page funnel");

      const body = mergeProductIntoStageFunnel(getJson.funnel ?? {}, productSlug, stageKey);
      const putRes = await apiRequest(
        "PUT",
        `/api/content-types/${contentType}/funnel/${slug}`,
        body,
      );
      const putJson = (await putRes.json()) as { error?: string };
      if (!putRes.ok) throw new Error(putJson.error || "Failed to save funnel");

      toast({
        title: "Page added",
        description: `${contentType}/${slug} is now at ${stageLabel} for this product.`,
      });
      setOpen(false);
      setPickerKey((k) => k + 1);
      onSuccess();
    } catch (err) {
      toast({
        title: "Could not add page",
        description: err instanceof Error ? err.message : "Save failed",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={adding}
          className="ml-auto shrink-0 inline-flex h-6 items-center gap-1 rounded-md border border-dashed px-2 text-[11px] text-muted-foreground hover-elevate disabled:opacity-50"
          data-testid={`button-funnel-add-content-${stageKey}`}
        >
          <Plus className="h-3 w-3" />
          Add content +
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 z-50 pointer-events-auto" align="end">
        <SitemapSearch
          key={pickerKey}
          value=""
          onChange={() => {}}
          embedded
          onClose={() => setOpen(false)}
          onSelectEntry={(entry) => void handleSelectEntry(entry)}
          placeholder="Search pages…"
          testId={`funnel-add-${stageKey}`}
          showLocaleFilter
        />
      </PopoverContent>
    </Popover>
  );
}

function FunnelStage({
  label,
  description,
  icon: Icon,
  index,
  isLast,
  children,
  taper = "full",
  headerAction,
}: {
  label: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  index: number;
  isLast?: boolean;
  children: ReactNode;
  taper?: FunnelStageTaper;
  headerAction?: ReactNode;
}) {
  return (
    <div
      className={cn("pb-5", isLast && "pb-0")}
      data-testid={`funnel-stage-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div
        className={cn(
          "mx-auto rounded-lg border px-3 py-3",
          FUNNEL_TAPER_WIDTH[taper],
          FUNNEL_STAGE_TONE[taper],
        )}
      >
        <div className="flex items-start gap-2 mb-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border/80 bg-background/60 text-[10px] font-mono text-muted-foreground shrink-0">
            {index}
          </span>
          {Icon && <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />}
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
            {description && (
              <p className="text-xs text-muted-foreground/80 mt-0.5 leading-snug">{description}</p>
            )}
          </div>
          {headerAction}
        </div>
        {children}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  testId,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ComponentType<{ className?: string }>;
  testId: string;
  valueClassName?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="pt-4 pb-3 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span>{label}</span>
        </div>
        <p className={cn("text-sm font-medium truncate", valueClassName)}>{value}</p>
        {hint != null && (
          <p className="text-xs text-muted-foreground truncate">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MetricHint({
  metricKey,
  value,
  label,
  testId,
}: {
  metricKey: keyof typeof METRIC_HELP;
  value: number;
  label: string;
  testId: string;
}) {
  const help = METRIC_HELP[metricKey];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 hover:text-foreground hover:decoration-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
          data-testid={testId}
          aria-label={`What does ${label} mean?`}
        >
          {value.toLocaleString()} {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-3 text-sm">
        <p className="font-medium text-foreground">{help.title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{help.body}</p>
        <p className="text-[11px] font-mono text-muted-foreground break-all">
          Events: {help.events.join(" · ")}
        </p>
        {help.note ? (
          <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-2">
            {help.note}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Animated dots only — for compact KPI values while BigQuery loads. */
function TrafficLoadingDots({ testId }: { testId?: string }) {
  return (
    <AnimatedEllipsis
      className="inline-block w-[1.5em] text-left"
      data-testid={testId}
    />
  );
}

/** Label + animated dots — for session/views/conversions metric rows. */
function CalculatingTraffic({ testId }: { testId?: string }) {
  return (
    <p
      className="text-[11px] text-muted-foreground tabular-nums"
      aria-live="polite"
      data-testid={testId}
    >
      Calculating Traffic
      <AnimatedEllipsis className="inline-block w-[1.5em] text-left" />
    </p>
  );
}

type StepMetrics = {
  sessions: number;
  views: number;
  conversions: number;
  ecommerce_intent: number;
  shared?: boolean;
};

const STAGE_GROUP_THRESHOLD = 8;

/** Awareness always groups; other stages group only when page count exceeds the threshold. */
function shouldGroupByContentType(stageKey: string, pageCount: number): boolean {
  if (stageKey === "awareness") return pageCount > 0;
  return pageCount > STAGE_GROUP_THRESHOLD;
}

type ContentTypeGroupData = {
  contentType: string;
  pages: FunnelStepRow[];
  metrics: {
    sessions: number;
    views: number;
    conversions: number;
    ecommerce_intent: number;
  };
  sharedCount: number;
};

function groupPagesByContentType(
  pages: FunnelStepRow[],
  getMetrics: (step: FunnelStepRow) => StepMetrics | undefined,
): ContentTypeGroupData[] {
  const byType = new Map<string, FunnelStepRow[]>();
  for (const step of pages) {
    const list = byType.get(step.content_type) ?? [];
    list.push(step);
    byType.set(step.content_type, list);
  }

  const groups: ContentTypeGroupData[] = [];
  for (const [contentType, typePages] of byType) {
    let sessions = 0;
    let views = 0;
    let conversions = 0;
    let ecommerce_intent = 0;
    let sharedCount = 0;
    for (const step of typePages) {
      const m = getMetrics(step);
      if (!m) continue;
      sessions += m.sessions;
      views += m.views;
      conversions += m.conversions;
      ecommerce_intent += m.ecommerce_intent;
      if (m.shared) sharedCount += 1;
    }
    const sortedPages = [...typePages].sort((a, b) => {
      const sa = getMetrics(a)?.sessions ?? 0;
      const sb = getMetrics(b)?.sessions ?? 0;
      if (sb !== sa) return sb - sa;
      return a.slug.localeCompare(b.slug);
    });
    groups.push({
      contentType,
      pages: sortedPages,
      metrics: { sessions, views, conversions, ecommerce_intent },
      sharedCount,
    });
  }

  groups.sort((a, b) => {
    if (b.metrics.sessions !== a.metrics.sessions) {
      return b.metrics.sessions - a.metrics.sessions;
    }
    return a.contentType.localeCompare(b.contentType);
  });
  return groups;
}

function ContentTypeGroup({
  group,
  getMetrics,
}: {
  group: ContentTypeGroupData;
  getMetrics: (step: FunnelStepRow) => StepMetrics | undefined;
}) {
  const [open, setOpen] = useState(false);
  const pageLabel = group.pages.length === 1 ? "1 page" : `${group.pages.length} pages`;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className="rounded-md border border-border/80 bg-background/40"
        data-testid={`funnel-type-group-${group.contentType}`}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover-elevate rounded-md"
            aria-expanded={open}
            data-testid={`button-funnel-type-${group.contentType}`}
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground mt-0.5 transition-transform",
                open && "rotate-180",
              )}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium font-mono text-sm">{group.contentType}</span>
                <Badge variant="secondary">{pageLabel}</Badge>
                {group.sharedCount > 0 && (
                  <Badge variant="outline">
                    {group.sharedCount === group.pages.length
                      ? "Shared"
                      : `${group.sharedCount} shared`}
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground tabular-nums flex flex-wrap items-center gap-x-1 gap-y-0.5">
                <MetricHint
                  metricKey="sessions"
                  value={group.metrics.sessions}
                  label="sessions"
                  testId={`metric-type-sessions-${group.contentType}`}
                />
                <span aria-hidden>·</span>
                <MetricHint
                  metricKey="views"
                  value={group.metrics.views}
                  label="views"
                  testId={`metric-type-views-${group.contentType}`}
                />
                <span aria-hidden>·</span>
                <MetricHint
                  metricKey="conversions"
                  value={group.metrics.conversions}
                  label="conversions"
                  testId={`metric-type-conversions-${group.contentType}`}
                />
                <span aria-hidden>·</span>
                <MetricHint
                  metricKey="ecommerce_intent"
                  value={group.metrics.ecommerce_intent}
                  label="intent"
                  testId={`metric-type-intent-${group.contentType}`}
                />
              </p>
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 px-2 pb-2 pt-0">
            {group.pages.map((step) => (
              <StepCard
                key={`${step.content_type}/${step.slug}`}
                step={step}
                metrics={getMetrics(step)}
              />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function StagePagesList({
  stageKey,
  pages,
  getMetrics,
}: {
  stageKey: string;
  pages: FunnelStepRow[];
  getMetrics: (step: FunnelStepRow) => StepMetrics | undefined;
}) {
  if (shouldGroupByContentType(stageKey, pages.length)) {
    const groups = groupPagesByContentType(pages, getMetrics);
    return (
      <div className="space-y-2">
        {groups.map((group) => (
          <ContentTypeGroup key={group.contentType} group={group} getMetrics={getMetrics} />
        ))}
      </div>
    );
  }

  const sorted = [...pages].sort((a, b) => {
    const sa = getMetrics(a)?.sessions ?? 0;
    const sb = getMetrics(b)?.sessions ?? 0;
    if (sb !== sa) return sb - sa;
    return a.slug.localeCompare(b.slug);
  });

  return (
    <div className="space-y-2">
      {sorted.map((step) => (
        <StepCard
          key={`${step.content_type}/${step.slug}`}
          step={step}
          metrics={getMetrics(step)}
        />
      ))}
    </div>
  );
}

function StepCard({
  step,
  badge,
  metrics,
}: {
  step: FunnelStepRow;
  badge?: string;
  metrics?: StepMetrics;
}) {
  const primaryUrl = step.urls.en || step.urls.es || Object.values(step.urls)[0];
  return (
    <Card data-testid={`card-funnel-step-${step.slug}`}>
      <CardContent className="py-2.5 text-sm space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium font-mono text-sm truncate">
            {step.content_type}/{step.slug}
          </p>
          <LocaleFlags urls={step.urls} />
          {badge && <Badge variant="secondary">{badge}</Badge>}
          {metrics?.shared && <Badge variant="outline">Shared</Badge>}
          {primaryUrl && (
            <a
              href={primaryUrl}
              className="text-xs text-primary hover:underline ml-auto"
              target="_blank"
              rel="noreferrer"
            >
              Open
            </a>
          )}
        </div>
        {metrics && (
          <p className="text-[11px] text-muted-foreground tabular-nums flex flex-wrap items-center gap-x-1 gap-y-0.5">
            <MetricHint
              metricKey="sessions"
              value={metrics.sessions}
              label="sessions"
              testId={`metric-sessions-${step.slug}`}
            />
            <span aria-hidden>·</span>
            <MetricHint
              metricKey="views"
              value={metrics.views}
              label="views"
              testId={`metric-views-${step.slug}`}
            />
            <span aria-hidden>·</span>
            <MetricHint
              metricKey="conversions"
              value={metrics.conversions}
              label="conversions"
              testId={`metric-conversions-${step.slug}`}
            />
            <span aria-hidden>·</span>
            <MetricHint
              metricKey="ecommerce_intent"
              value={metrics.ecommerce_intent}
              label="intent"
              testId={`metric-intent-${step.slug}`}
            />
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function StoreProductDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";
  const queryClient = useQueryClient();
  const [educationOpen, setEducationOpen] = useState(false);
  const [analyticsMode, setAnalyticsMode] = useState<"page_performance" | "stage_flow">(
    "page_performance",
  );

  const { data, isLoading, isError } = useQuery<FunnelResponse>({
    queryKey: [`/api/ecommerce/funnel/${slug}`],
    enabled: !!slug,
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery<JourneyAnalyticsResponse>({
    queryKey: [`/api/ecommerce/funnel/${slug}/analytics`, analyticsMode],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/ecommerce/funnel/${encodeURIComponent(slug)}/analytics?mode=${analyticsMode}&days=28`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: !!slug && !!data,
  });

  const refreshJourney = () => {
    void queryClient.invalidateQueries({ queryKey: [`/api/ecommerce/funnel/${slug}`] });
    void queryClient.invalidateQueries({
      queryKey: [`/api/ecommerce/funnel/${slug}/analytics`],
    });
  };

  const stageOrder = data?.funnel.stage_order ?? [...FUNNEL_STAGES];
  const selling = data ? isActivelySelling(data.product) : false;
  const journeyPages = data
    ? stageOrder.reduce((n, key) => n + (data.funnel.stages[key]?.length ?? 0), 1)
    : 0;
  let stageIndex = 1;

  const pageMetrics = (step: FunnelStepRow) => {
    const key = `${step.content_type}/${step.slug}`;
    return analytics?.pages?.[key];
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/private/store/ecommerce">
            <button className="p-1.5 rounded-md hover-elevate" data-testid="button-back">
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </button>
          </Link>
          <IconShoppingBag className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold" data-testid="heading-product-funnel">
            {data?.product.name ?? slug}
          </h1>
        </div>

        {isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {isError && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Product not found or not purchasable. Enable{" "}
              <code className="bg-muted px-1 rounded">_ecommerce.yml</code> with{" "}
              <code className="bg-muted px-1 rounded">purchasable: true</code>.
            </CardContent>
          </Card>
        )}

        {data && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <KpiCard
                label="Product ID"
                value={data.product.product_id}
                hint={data.product.name}
                icon={IconHash}
                testId="card-kpi-product-id"
                valueClassName="font-mono"
              />
              <KpiCard
                label="CMS entry"
                value={`${data.product.content_type}/${data.product.content_slug}`}
                hint="Source content entry"
                icon={IconFileText}
                testId="card-kpi-cms-entry"
                valueClassName="font-mono"
              />
              <KpiCard
                label="Status"
                value={selling ? "Selling" : "Paused"}
                hint={selling ? "Visible in the store journey" : "Hidden from the store journey"}
                icon={selling ? IconCircleCheck : IconPlayerPause}
                testId="card-kpi-selling"
              />
              <KpiCard
                label="Journey pages"
                value={journeyPages}
                hint={`across ${stageOrder.length} stages`}
                icon={IconLayersIntersect}
                testId="card-kpi-journey-pages"
                valueClassName="tabular-nums"
              />
              <KpiCard
                label="Product conversions (28d)"
                value={
                  analyticsLoading
                    ? "…"
                    : (analytics?.product?.conversions ?? "—")
                }
                hint="Tagged with this product item_id — not everything on a URL"
                icon={IconChartBar}
                testId="card-kpi-conversions"
                valueClassName="tabular-nums"
              />
              <KpiCard
                label="Ecommerce intent (28d)"
                value={
                  analyticsLoading
                    ? "…"
                    : (analytics?.product?.ecommerce_intent ?? "—")
                }
                hint="view_item / cart / begin-checkout for this product"
                icon={IconClick}
                testId="card-kpi-ecommerce-intent"
                valueClassName="tabular-nums"
              />
            </div>

            <section className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Conversion journey
                </h2>
                <ToggleButtonBar
                  value={analyticsMode}
                  onValueChange={(v) => {
                    if (v === "page_performance" || v === "stage_flow") setAnalyticsMode(v);
                  }}
                  listTestId="toggle-journey-analytics-mode"
                >
                  <ToggleButtonBarTrigger value="page_performance" data-testid="tab-page-performance">
                    Page performance
                  </ToggleButtonBarTrigger>
                  <ToggleButtonBarTrigger value="stage_flow" data-testid="tab-stage-flow">
                    Stage flow
                  </ToggleButtonBarTrigger>
                </ToggleButtonBar>
              </div>

              {analyticsMode === "page_performance" ? (
                <p className="text-xs text-muted-foreground mb-2">
                  Traffic and clicks on these pages. Numbers are not proof that one stage fed the next.
                  {analytics?.as_of ? (
                    <>
                      {" "}
                      As of <span className="font-mono">{analytics.as_of}</span>
                      {analytics.window_days ? ` (${analytics.window_days}d)` : null}.
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mb-2">
                  Coming soon — will show only sessions that moved between stages in this journey.
                </p>
              )}

              {analyticsMode === "page_performance" && analytics?.summary && (
                <p className="text-xs text-muted-foreground mb-3 tabular-nums">
                  Sessions on product-specific pages:{" "}
                  {analytics.summary.sessions_product_specific.toLocaleString()} · on shared pages:{" "}
                  {analytics.summary.sessions_shared.toLocaleString()}
                  {analytics.status === "unavailable" ? (
                    <>
                      {" "}
                      —{" "}
                      <Link href="/private/tracking/bigquery" className="text-primary underline">
                        Configure BigQuery
                      </Link>
                    </>
                  ) : null}
                </p>
              )}

              {analytics?.warnings && analytics.warnings.length > 0 && analyticsMode === "page_performance" && (
                <ul className="text-xs text-amber-600 dark:text-amber-400 mb-3 list-disc pl-4 space-y-0.5">
                  {analytics.warnings.slice(0, 3).map((w) => (
                    <li key={w.code + w.message}>{w.message}</li>
                  ))}
                </ul>
              )}

              <Card data-testid="card-education" className="mb-4">
                <Collapsible open={educationOpen} onOpenChange={setEducationOpen}>
                  <div className="px-3 py-2 space-y-2 text-sm text-muted-foreground">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 text-foreground font-medium text-left"
                        aria-expanded={educationOpen}
                        data-testid="button-how-it-works"
                      >
                        <IconInfoCircle className="h-4 w-4 shrink-0" />
                        <span className="flex-1">How it works</span>
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${educationOpen ? "rotate-180" : ""}`}
                        />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2">
                      <p>{data.education.summary}</p>
                      <p>
                        Shared badge means the page is tagged for all products — its traffic is not exclusive
                        to this SKU. Stage session totals count unique sessions in that stage (not the sum of
                        page cards).
                      </p>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-foreground font-medium">Read more (advanced)</summary>
                        <ul className="mt-2 list-disc pl-5 font-mono space-y-1">
                          {data.education.advanced_paths.map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                          <li>GET /api/ecommerce/funnel/:slug/analytics</li>
                          <li>server/ecommerce/journey-analytics.ts</li>
                          <li>/private/tracking/bigquery</li>
                        </ul>
                      </details>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </Card>
              <p className="text-xs text-muted-foreground mb-4">
                Pages appear here when their{" "}
                <code className="bg-muted px-1 rounded">funnel.stage</code> and{" "}
                <code className="bg-muted px-1 rounded">funnel.products</code> include this SKU.
                Use <strong>Add content +</strong> on a stage to attach a page from the sitemap.
                Awareness is grouped by content type so large lists stay scannable; other stages
                group the same way once they grow past {STAGE_GROUP_THRESHOLD} pages.
              </p>

              {analyticsMode === "stage_flow" ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground space-y-2">
                    <p>{analytics?.message || "Stage flow is not implemented yet."}</p>
                    <p className="text-xs">
                      Switch to <strong>Page performance</strong> for on-page traffic and product-scoped KPIs.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                stageOrder.map((stageKey, i) => {
                  const meta = STAGE_META[stageKey] ?? {
                    label: stageKey,
                    description: "",
                    icon: IconTarget,
                    taper: "mid" as const,
                  };
                  const pages = data.funnel.stages[stageKey] ?? [];
                  const isDecision = stageKey === "decision";
                  const locked = isDecision ? data.funnel.locked : null;
                  const isLast = i === stageOrder.length - 1;
                  const funnelStageKey = stageKey as FunnelStageKey;
                  const stageSessions = analytics?.stages?.[stageKey]?.sessions_distinct;

                  return (
                    <FunnelStage
                      key={stageKey}
                      label={meta.label}
                      description={
                        stageSessions != null
                          ? `${meta.description} · ${stageSessions.toLocaleString()} unique sessions`
                          : meta.description
                      }
                      icon={meta.icon}
                      index={stageIndex++}
                      taper={meta.taper}
                      isLast={isLast}
                      headerAction={
                        FUNNEL_STAGES.includes(funnelStageKey) ? (
                          <AddFunnelContentButton
                            stageKey={funnelStageKey}
                            stageLabel={meta.label}
                            productSlug={slug}
                            onSuccess={refreshJourney}
                          />
                        ) : null
                      }
                    >
                      {locked && (
                        <div className="space-y-2 mb-2">
                          <StepCard
                            step={locked}
                            badge="locked product page"
                            metrics={pageMetrics(locked)}
                          />
                        </div>
                      )}
                      {pages.length === 0 ? (
                        <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-3">
                          No pages at this stage yet. Click <strong>Add content +</strong> to pick a page
                          from the sitemap.
                        </p>
                      ) : (
                        <StagePagesList
                          stageKey={stageKey}
                          pages={pages}
                          getMetrics={pageMetrics}
                        />
                      )}
                    </FunnelStage>
                  );
                })
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
