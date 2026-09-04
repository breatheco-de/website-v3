import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Calculator, ChevronDown, Info, Link2, Loader2, Pencil, RotateCcw } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { ItemEditModal } from "@/components/databases/ItemEditModal";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import { queryClient } from "@/lib/queryClient";
import type { EditorHint } from "@/components/editing/EditorTypeDialog";
import { deslugifyLabel } from "@shared/relation-field";
import { NotMetaFieldBadge } from "@/components/editing/NotMetaFieldBadge";

type FieldSource = "original" | "db_override" | "ct_override" | "entry_default";

type FieldProvenance = {
  field: string;
  effective: unknown;
  source: FieldSource;
  baseline?: unknown;
  db_value?: unknown;
  ct_value?: unknown;
  calculated?: boolean;
  layer_has_key?: boolean;
  writable?: boolean;
  group?: "seo";
};

type ProvenanceResponse = {
  hasDatabase: boolean;
  fields: FieldProvenance[];
  layerFileName?: string;
  isVariantLayer?: boolean;
  resolvedVariant?: string | null;
  canonicalPath?: string | null;
  indexRebuilt?: boolean;
  seoFileMissing?: boolean;
  seoWriteAllowed?: boolean;
  seoWriteBlockReason?: string;
};

type ContentTypeConfig = {
  label?: string;
  name?: string;
  directory?: string;
  editor?: Record<string, EditorHint>;
  field_mapping?: Record<string, string | { source: string; default: string }>;
  database?: { slug?: string } | null;
  seo_monitoring?: { enabled?: boolean; require_cluster?: boolean } | null;
};

function metricFromProvenance(row: FieldProvenance | undefined): string {
  if (row?.effective == null || row.effective === "") return "";
  if (typeof row.effective === "number" && Number.isFinite(row.effective)) {
    return String(row.effective);
  }
  if (typeof row.effective === "string" && /^-?\d+$/.test(row.effective.trim())) {
    return row.effective.trim();
  }
  return "";
}

function parseMetricInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^-?\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

function isSystemSpecialField(field: string): boolean {
  return field.startsWith("_");
}

function FieldsEducationBlock({
  hasDatabase,
  directory,
  databaseSlug,
  slug,
  locale,
  layerFileName,
}: {
  hasDatabase: boolean;
  directory: string;
  databaseSlug?: string;
  slug: string;
  locale: string;
  layerFileName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const dbPath = `db/${databaseSlug || "<database>"}/overrides.json`;
  const ctPath = `${directory}/${slug}/${layerFileName || `${locale}.yml`}`;

  return (
    <div
      className="rounded-md border border-border bg-muted/20 p-3 space-y-3 text-sm text-muted-foreground"
      data-testid="fields-education"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="button-toggle-fields-education"
      >
        <p className="font-medium text-foreground">How Fields work</p>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <>
          <div className="space-y-2">
            <p>
              Fields are the content-type schema (Manage → Fields). Custom fields appear here and as{" "}
              <code className="text-xs bg-muted px-1 rounded font-mono">{`{{ entry.fieldName }}`}</code>.
              SEO cluster fields (
              <code className="text-xs font-mono">{`{{ seo.main_keyword }}`}</code>
              ) live on the <strong>SEO Meta</strong> tab. Use that tab for head keys too (
              <code className="text-xs font-mono">{`{{ meta.* }}`}</code>). System identity is auto-available as{" "}
              <code className="text-xs font-mono">{`{{ entry.slug }}`}</code> /{" "}
              <code className="text-xs font-mono">{`{{ entry.locale }}`}</code> /{" "}
              <code className="text-xs font-mono">{`{{ entry.image }}`}</code> (and underscore forms).{" "}
              <code className="text-xs font-mono">_hreflangs</code> is routing-only. Change DB identity sources on
              Manage → Fields when a database is attached.
            </p>
            {hasDatabase ? (
              <div className="space-y-1.5">
                <p>
                  <span className="font-medium text-foreground">Database override</span> — Updates the cached
                  database value (listings and this page). Shared across locales.
                </p>
                <p>
                  <span className="font-medium text-foreground">Content type override</span> — Writes under{" "}
                  <code className="text-xs bg-muted px-1 rounded font-mono">field_overrides</code> on this
                  page&apos;s YAML for <strong className="text-foreground">this locale ({locale})</strong>.
                </p>
                <p>
                  <span className="font-medium text-foreground">Precedence:</span> Content type override →
                  Database override → Original database value.
                </p>
              </div>
            ) : (
              <p>
                <span className="font-medium text-foreground">Static fields</span> — Writes{" "}
                <strong className="text-foreground">top-level keys</strong> on{" "}
                <code className="text-xs bg-muted px-1 rounded font-mono">{ctPath}</code> (same idea as{" "}
                <code className="text-xs font-mono">title</code> / <code className="text-xs font-mono">content</code>
                ). The API path is still named <code className="text-xs font-mono">field-overrides</code>, but
                static types do not store a <code className="text-xs font-mono">field_overrides</code> bag.
              </p>
            )}
            <p>
              <span className="font-medium text-foreground">Published date</span> (
              <code className="text-xs font-mono">published_at</code>) is set when the entry first goes live
              (create for blog / shared-layout; publish for drafts). Edit here to backdate — saves to{" "}
              <code className="text-xs font-mono">_common.yml</code>. Cannot clear; later content edits do not
              change it.
            </p>
            <p>
              Edits write to disk
              {hasDatabase ? ` (${dbPath} and/or ${ctPath})` : ` (${ctPath})`} — open advanced for path rules.
            </p>
          </div>

          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
            data-testid="button-toggle-fields-advanced"
          >
            {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
          </button>

          {showAdvanced && (
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3 text-xs">
              <div>
                <p className="font-medium text-foreground mb-1">Files written</p>
                <ul className="list-disc pl-5 space-y-1">
                  {hasDatabase && (
                    <li>
                      Database override: <code className="text-[11px] font-mono">{dbPath}</code>
                    </li>
                  )}
                  <li>
                    {hasDatabase ? (
                      <>
                        Content type override:{" "}
                        <code className="text-[11px] font-mono">{ctPath}</code> under{" "}
                        <code className="text-[11px] font-mono">field_overrides</code>
                      </>
                    ) : (
                      <>
                        Static mapped fields: top-level keys on{" "}
                        <code className="text-[11px] font-mono">{ctPath}</code> via{" "}
                        <code className="text-[11px] font-mono">PUT .../field-overrides/:slug</code> →{" "}
                        <code className="text-[11px] font-mono">server/field-overrides.ts</code> (
                        <code className="text-[11px] font-mono">writeMappedFields</code>)
                      </>
                    )}
                  </li>
                  <li>
                    <code className="text-[11px] font-mono">published_at</code> (static):{" "}
                    <code className="text-[11px] font-mono">{directory}/{slug}/_common.yml</code> via{" "}
                    <code className="text-[11px] font-mono">server/published-at.ts</code> — not locale
                    overrides. Create stamps in <code className="text-[11px] font-mono">createContentEntry</code>;
                    draft go-live via versioning publish/promote.
                  </li>
                  <li>
                    Live SEO/required gate:{" "}
                    <code className="text-[11px] font-mono">server/live-entry-seo-gate.ts</code> (skipped for
                    variant/draft layer writes).
                  </li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">System fields</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Remap sources only on Manage → Fields.{" "}
                    <code className="text-[11px] font-mono">_slug</code> aliases to{" "}
                    <code className="text-[11px] font-mono">{`{{ entry.slug }}`}</code>;{" "}
                    <code className="text-[11px] font-mono">_image</code> drives preview/OG and aliases to{" "}
                    <code className="text-[11px] font-mono">{`{{ entry.image }}`}</code>.
                  </li>
                  {!hasDatabase && (
                    <li>
                      Static <code className="text-[11px] font-mono">_hreflangs</code> is unused — alternates
                      use locale files / slug overrides.
                    </li>
                  )}
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">Reset</p>
                {hasDatabase ? (
                  <p>
                    Reset clears content-type and database overrides for a custom field, restoring the
                    original database value. For SEO fields, Reset removes the locale{" "}
                    <code className="text-[11px] font-mono">seo:</code> key so the{" "}
                    <code className="text-[11px] font-mono">seo_*</code> DB baseline shows through (no DB
                    write-back).
                  </p>
                ) : (
                  <p>
                    Reset removes the key from this layer file only (
                    <code className="text-[11px] font-mono">{layerFileName || `${locale}.yml`}</code>
                    ). If the value only exists on <code className="text-[11px] font-mono">_common.yml</code>,
                    reset is a no-op. SEO Reset removes the nested{" "}
                    <code className="text-[11px] font-mono">seo:</code> key on the locale file.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type SeoOverviewClusters = {
  clusters: {
    pillarUrl: string;
    clusterCount: number;
    hubId?: string;
    keyword?: string | null;
  }[];
};

function pathLocalePrefix(urlPath: string): string | null {
  const m = urlPath.trim().match(/^\/([a-z]{2})(?:\/|$)/i);
  return m ? m[1].toLowerCase() : null;
}

function seoSourceBadge(row: FieldProvenance | undefined): { label: string; variant: "default" | "secondary" | "outline" } | null {
  if (!row) return null;
  if (row.layer_has_key) {
    return { label: "Locale YAML", variant: "secondary" };
  }
  if (row.source === "original") {
    return { label: "Database baseline", variant: "outline" };
  }
  return { label: "Entry default", variant: "outline" };
}

function isPillarPathOptedOut(row: FieldProvenance | undefined): boolean {
  return row?.layer_has_key === true && row.effective === null;
}

function SeoFieldsEditor({
  rows,
  disabled,
  canonicalPath,
  isVariantLayer,
  layerFileName,
  locale,
  directory,
  slug,
  contentType,
  seoMonitoringEnabled,
  seoWriteBlocked,
  seoWriteBlockReason,
  onSave,
  onResetField,
  portalContainer,
}: {
  rows: FieldProvenance[];
  disabled: boolean;
  canonicalPath?: string | null;
  isVariantLayer: boolean;
  layerFileName?: string;
  locale: string;
  directory: string;
  slug: string;
  contentType: string;
  seoMonitoringEnabled: boolean;
  seoWriteBlocked?: boolean;
  seoWriteBlockReason?: string;
  onSave: (built: Record<string, unknown>) => Promise<void>;
  onResetField: (fieldPath: string) => Promise<void>;
  portalContainer?: HTMLElement | null;
}) {
  const { toast } = useToast();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resettingField, setResettingField] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [seoFieldsEditing, setSeoFieldsEditing] = useState(false);
  const kwRow = rows.find((r) => r.field === "seo.main_keyword");
  const volumeRow = rows.find((r) => r.field === "seo.kw_monthly_volume");
  const difficultyRow = rows.find((r) => r.field === "seo.kw_difficulty");
  const pillarRow = rows.find((r) => r.field === "seo.pillar_path");
  const hubRow = rows.find((r) => r.field === "seo.is_pillar");
  const [clusterSeoOn, setClusterSeoOn] = useState(() => !isPillarPathOptedOut(pillarRow));
  const [mainKeyword, setMainKeyword] = useState(
    kwRow?.effective == null ? "" : String(kwRow.effective),
  );
  const [kwMonthlyVolume, setKwMonthlyVolume] = useState(() => metricFromProvenance(volumeRow));
  const [kwDifficulty, setKwDifficulty] = useState(() => metricFromProvenance(difficultyRow));
  const [pillarPath, setPillarPath] = useState(
    typeof pillarRow?.effective === "string" ? pillarRow.effective : "",
  );
  const [isPillar, setIsPillar] = useState(hubRow?.effective === true || hubRow?.effective === "true");

  useEffect(() => {
    if (seoFieldsEditing) return;
    setClusterSeoOn(!isPillarPathOptedOut(pillarRow));
    setMainKeyword(kwRow?.effective == null ? "" : String(kwRow.effective));
    setKwMonthlyVolume(metricFromProvenance(volumeRow));
    setKwDifficulty(metricFromProvenance(difficultyRow));
    setPillarPath(typeof pillarRow?.effective === "string" ? pillarRow.effective : "");
    setIsPillar(hubRow?.effective === true || hubRow?.effective === "true");
  }, [
    seoFieldsEditing,
    kwRow?.effective,
    volumeRow?.effective,
    difficultyRow?.effective,
    pillarRow?.effective,
    pillarRow?.layer_has_key,
    hubRow?.effective,
  ]);

  const researchFieldsPayload = () => ({
    "seo.main_keyword": mainKeyword,
    "seo.kw_monthly_volume": parseMetricInput(kwMonthlyVolume),
    "seo.kw_difficulty": parseMetricInput(kwDifficulty),
  });

  const researchIncomplete =
    seoMonitoringEnabled &&
    mainKeyword.trim() !== "" &&
    (parseMetricInput(kwMonthlyVolume) === null || parseMetricInput(kwDifficulty) === null);

  const { data: overview } = useQuery<SeoOverviewClusters>({
    queryKey: ["/api/seo/overview"],
  });

  const { data: entryKeywordMetrics } = useQuery<{
    keyword_metrics?: {
      openrush_configured: boolean;
      source: string;
      kw_monthly_volume: number | null;
      kw_difficulty: number | null;
      may_not_be_recent: boolean;
      notes: string | null;
      fetched_at: string | null;
      stale: boolean;
    };
  }>({
    queryKey: ["/api/seo/entry", contentType, slug, locale, "keyword-metrics-preview"],
    enabled: !!contentType && !!slug && !!locale && !isVariantLayer,
    staleTime: 60_000,
    queryFn: async () => {
      const params = new URLSearchParams({ locale });
      const res = await fetch(
        `/api/seo/entry/${encodeURIComponent(contentType)}/${encodeURIComponent(slug)}?${params}`,
        { credentials: "include" },
      );
      if (!res.ok) return {};
      return res.json();
    },
  });
  const resolvedKm = entryKeywordMetrics?.keyword_metrics;
  const researchIncompleteForDisplay =
    researchIncomplete &&
    !(
      resolvedKm?.source === "openrush_cache" &&
      typeof resolvedKm.kw_monthly_volume === "number" &&
      typeof resolvedKm.kw_difficulty === "number"
    );

  const localeHubs = useMemo(() => {
    const loc = locale.toLowerCase();
    const prefix = `/${loc}/`;
    return (overview?.clusters ?? []).filter((c) => {
      const p = (c.pillarUrl || "").toLowerCase();
      return p === `/${loc}` || p.startsWith(prefix);
    });
  }, [overview?.clusters, locale]);

  const trimmedPath = pillarPath.trim();
  const typedLocale = pathLocalePrefix(trimmedPath);
  const localeMismatch = !!typedLocale && typedLocale !== locale.toLowerCase();
  const knownHub = localeHubs.some((c) => c.pillarUrl === trimmedPath);
  const unknownHub =
    !isPillar &&
    trimmedPath !== "" &&
    !localeMismatch &&
    overview != null &&
    !knownHub;

  const pathLocked = disabled || saving || isPillar;

  const handleTogglePillar = (checked: boolean) => {
    setIsPillar(checked);
    if (checked && canonicalPath) setPillarPath(canonicalPath);
  };

  const handleClusterSeoToggle = async (checked: boolean) => {
    if (disabled || saving) return;
    const previous = clusterSeoOn;
    setClusterSeoOn(checked);
    if (!checked) {
      setIsPillar(false);
      setChooserOpen(false);
    }
    setSaving(true);
    try {
      if (!checked) {
        await onSave({
          "seo.pillar_path": null,
          "seo.is_pillar": false,
        });
        setSeoFieldsEditing(false);
      } else {
        await onSave({
          ...researchFieldsPayload(),
          "seo.pillar_path": typeof pillarPath === "string" ? pillarPath : "",
          "seo.is_pillar": isPillar,
        });
      }
    } catch (err) {
      setClusterSeoOn(previous);
      toast({
        title: "SEO save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="seo-fields-block">
      {seoWriteBlocked ? (
        <p
          className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
          data-testid="banner-seo-write-blocked"
        >
          {seoWriteBlockReason ||
            "Cluster SEO is edited on the live page. Draft SEO is only for brand-new pages that are not live yet. Experiment variants cannot change cluster fields."}
        </p>
      ) : isVariantLayer ? (
        <p
          className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
          data-testid="banner-seo-draft-unpublished"
        >
          Editing draft SEO on {layerFileName || `draft.${locale}.yml`} before the page goes live. The
          cluster map updates when you publish.
        </p>
      ) : null}
      {disabled && (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          SEO fields need a locale YAML file. Create {locale}.yml before editing.
        </p>
      )}
      {!seoFieldsEditing ? (
      <div
        className={
          "relative rounded-md border border-border bg-muted/20 p-3 pr-10 space-y-3 text-sm" +
          (!disabled && !seoWriteBlocked ? " cursor-pointer hover-elevate" : "")
        }
        onClick={() => {
          if (disabled || seoWriteBlocked) return;
          setSeoFieldsEditing(true);
        }}
        data-testid="card-seo-fields-preview"
        title={seoWriteBlocked ? undefined : "Click to edit"}
      >
        <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setSeoFieldsEditing(true)}
            data-testid="button-edit-seo-fields"
            title="Edit SEO fields"
            aria-label="Edit SEO fields"
            disabled={disabled || seoWriteBlocked}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="font-medium text-foreground">SEO fields</p>
        <dl className="space-y-2">
          <div>
            <dt className="text-xs text-muted-foreground">Include in SEO clustering</dt>
            <dd className="text-sm text-foreground" data-testid="text-seo-cluster-on-preview">
              {clusterSeoOn ? "On" : "Off — opted out of cluster monitoring"}
            </dd>
          </div>
          {clusterSeoOn ? (
            <>
              <div>
                <dt className="text-xs text-muted-foreground flex items-center gap-2">
                  Main keyword
                  {seoSourceBadge(kwRow) && (
                    <Badge variant={seoSourceBadge(kwRow)!.variant} className="text-[10px] font-normal">
                      {seoSourceBadge(kwRow)!.label}
                    </Badge>
                  )}
                </dt>
                <dd className="text-sm text-foreground" data-testid="text-seo-main-keyword-preview">
                  {mainKeyword.trim() || (
                    <span className="italic text-muted-foreground font-normal">Not set</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Monthly search volume</dt>
                <dd className="text-sm text-foreground" data-testid="text-seo-kw-monthly-volume-preview">
                  {typeof resolvedKm?.kw_monthly_volume === "number" ? (
                    resolvedKm.kw_monthly_volume.toLocaleString()
                  ) : kwMonthlyVolume.trim() ? (
                    Number(kwMonthlyVolume).toLocaleString()
                  ) : (
                    <span className="italic text-muted-foreground font-normal">Not set</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Keyword difficulty (0–100)</dt>
                <dd className="text-sm text-foreground" data-testid="text-seo-kw-difficulty-preview">
                  {typeof resolvedKm?.kw_difficulty === "number" ? (
                    resolvedKm.kw_difficulty
                  ) : kwDifficulty.trim() ? (
                    kwDifficulty
                  ) : (
                    <span className="italic text-muted-foreground font-normal">Not set</span>
                  )}
                </dd>
              </div>
              {resolvedKm?.source === "openrush_cache" ? (
                <p className="text-xs text-muted-foreground" data-testid="hint-seo-openrush-source">
                  Live numbers come from OpenRush when it is active. YAML below is the backup if OpenRush is off.
                </p>
              ) : null}
              {resolvedKm?.may_not_be_recent ? (
                <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="hint-seo-may-not-be-recent">
                  May not be recent — saved YAML estimates (OpenRush cache empty or inactive).
                </p>
              ) : null}
              {resolvedKm?.notes ? (
                <p className="text-[11px] text-muted-foreground" data-testid="hint-seo-keyword-notes">
                  {resolvedKm.notes}
                </p>
              ) : null}
              {researchIncompleteForDisplay ? (
                <p
                  className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5"
                  data-testid="hint-seo-research-incomplete-preview"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  Monitoring is on and this keyword is missing monthly volume or difficulty estimates.
                </p>
              ) : null}
              <div>
                <dt className="text-xs text-muted-foreground flex items-center gap-2">
                  Is pillar
                  {seoSourceBadge(hubRow) && (
                    <Badge variant={seoSourceBadge(hubRow)!.variant} className="text-[10px] font-normal">
                      {seoSourceBadge(hubRow)!.label}
                    </Badge>
                  )}
                </dt>
                <dd className="text-sm text-foreground" data-testid="text-seo-is-pillar-preview">
                  {isPillar ? "Yes — this page is the hub" : "No"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground flex items-center gap-2">
                  Pillar path
                  {seoSourceBadge(pillarRow) && (
                    <Badge variant={seoSourceBadge(pillarRow)!.variant} className="text-[10px] font-normal">
                      {seoSourceBadge(pillarRow)!.label}
                    </Badge>
                  )}
                </dt>
                <dd className="text-sm text-foreground font-mono truncate" data-testid="text-seo-pillar-path-preview">
                  {pillarPath.trim() || (
                    <span className="italic text-muted-foreground font-sans font-normal">Not in a cluster</span>
                  )}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      </div>
      ) : (
      <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">SEO fields</p>
        <p>
          <span className="font-medium text-foreground">Include in SEO clustering</span> saves
          immediately. Off excludes this page from cluster monitoring (writes{" "}
          <code className="font-mono text-xs">pillar_path: null</code>) even when the content type has SEO
          monitoring on. When on, set keyword and hub below, then save. Monthly volume and difficulty are
          planning estimates for the main keyword — not live traffic. Leaving either blank on save clears
          that estimate.
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
          onClick={() => setShowAdvanced((v) => !v)}
          data-testid="button-toggle-seo-fields-advanced"
        >
          {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
        </button>
        {showAdvanced && (
          <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2 text-xs">
            <p>
              Nested <code className="font-mono">seo:</code> on{" "}
              <code className="font-mono">
                {directory}/{slug}/{layerFileName || `${locale}.yml`}
              </code>
              . Cluster SEO is writable only on live{" "}
              <code className="font-mono">{`{locale}.yml`}</code> or{" "}
              <code className="font-mono">{`draft.${locale}.yml`}</code> before any live locale exists.
              Promoting an experiment keeps live <code className="font-mono">seo:</code>. Opt-out
              persists as <code className="font-mono">seo.pillar_path: null</code> (empty string is a
              cluster gap, not opt-out). Research keys:{" "}
              <code className="font-mono">seo.kw_monthly_volume</code> (integer ≥ 0) and{" "}
              <code className="font-mono">seo.kw_difficulty</code> (0–100) — not GSC, not template tokens. DB
              baselines via <code className="font-mono">field_mapping</code>{" "}
              <code className="font-mono">seo_main_keyword</code> /{" "}
              <code className="font-mono">seo_is_pillar</code> /{" "}
              <code className="font-mono">seo_pillar_path</code> only (
              <code className="font-mono">server/seo-effective-seo.ts</code>). Index:{" "}
              <code className="font-mono">{"{contentRoot}/seo-index.json"}</code>. Rejected on{" "}
              <code className="font-mono">_common.yml</code>.
            </p>
          </div>
        )}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/50 px-3 py-2">
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor="seo-cluster-on" className="text-xs text-foreground">
                Include in SEO clustering
              </Label>
              <p className="text-xs text-muted-foreground">
                {saving
                  ? "Saving…"
                  : clusterSeoOn
                    ? "Keyword and pillar fields are editable."
                    : "Page is excluded from cluster monitoring."}
              </p>
            </div>
            <Switch
              id="seo-cluster-on"
              checked={clusterSeoOn}
              disabled={disabled || saving}
              onCheckedChange={(checked) => void handleClusterSeoToggle(checked)}
              data-testid="switch-seo-cluster-on"
            />
          </div>
          {clusterSeoOn ? (
            <>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="seo-main-keyword" className="text-xs text-foreground flex items-center gap-2">
                Main keyword
                {seoSourceBadge(kwRow) && (
                  <Badge variant={seoSourceBadge(kwRow)!.variant} className="text-[10px] font-normal">
                    {seoSourceBadge(kwRow)!.label}
                  </Badge>
                )}
              </Label>
              {onResetField && kwRow?.layer_has_key && !disabled && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title="Reset to database baseline"
                  disabled={!!resettingField || saving}
                  data-testid="button-reset-seo-main_keyword"
                  onClick={() => {
                    setResettingField("seo.main_keyword");
                    void onResetField("seo.main_keyword")
                      .then(() => {
                        setMainKeyword(
                          kwRow?.baseline != null && kwRow.baseline !== ""
                            ? String(kwRow.baseline)
                            : "",
                        );
                      })
                      .finally(() => setResettingField(null));
                  }}
                >
                  {resettingField === "seo.main_keyword" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
            <Input
              id="seo-main-keyword"
              className="bg-background"
              value={mainKeyword}
              disabled={disabled || saving}
              onChange={(e) => setMainKeyword(e.target.value)}
              data-testid="input-seo-main-keyword"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="seo-kw-monthly-volume" className="text-xs text-foreground">
                  Monthly search volume
                </Label>
                {onResetField && volumeRow?.layer_has_key && !disabled && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Reset locale estimate"
                    disabled={!!resettingField || saving}
                    data-testid="button-reset-seo-kw_monthly_volume"
                    onClick={() => {
                      setResettingField("seo.kw_monthly_volume");
                      void onResetField("seo.kw_monthly_volume")
                        .then(() => setKwMonthlyVolume(""))
                        .finally(() => setResettingField(null));
                    }}
                  >
                    {resettingField === "seo.kw_monthly_volume" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </div>
              <Input
                id="seo-kw-monthly-volume"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                className="bg-background"
                value={kwMonthlyVolume}
                disabled={disabled || saving}
                onChange={(e) => setKwMonthlyVolume(e.target.value)}
                placeholder="e.g. 1200"
                data-testid="input-seo-kw-monthly-volume"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="seo-kw-difficulty" className="text-xs text-foreground">
                  Keyword difficulty (0–100)
                </Label>
                {onResetField && difficultyRow?.layer_has_key && !disabled && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Reset locale estimate"
                    disabled={!!resettingField || saving}
                    data-testid="button-reset-seo-kw_difficulty"
                    onClick={() => {
                      setResettingField("seo.kw_difficulty");
                      void onResetField("seo.kw_difficulty")
                        .then(() => setKwDifficulty(""))
                        .finally(() => setResettingField(null));
                    }}
                  >
                    {resettingField === "seo.kw_difficulty" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </div>
              <Input
                id="seo-kw-difficulty"
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                className="bg-background"
                value={kwDifficulty}
                disabled={disabled || saving}
                onChange={(e) => setKwDifficulty(e.target.value)}
                placeholder="e.g. 42"
                data-testid="input-seo-kw-difficulty"
              />
            </div>
          </div>
          {researchIncomplete ? (
            <p
              className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5"
              data-testid="hint-seo-research-incomplete"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Monitoring is on — add both monthly volume and difficulty for this keyword (or clear the
              keyword). Blank fields clear the saved estimate on save.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Checkbox
              id="seo-is-pillar"
              checked={isPillar}
              disabled={disabled || saving}
              onCheckedChange={(v) => handleTogglePillar(v === true)}
              data-testid="checkbox-seo-is-pillar"
            />
            <Label htmlFor="seo-is-pillar" className="text-xs text-foreground flex items-center gap-2 flex-1">
              Is pillar
              {seoSourceBadge(hubRow) && (
                <Badge variant={seoSourceBadge(hubRow)!.variant} className="text-[10px] font-normal">
                  {seoSourceBadge(hubRow)!.label}
                </Badge>
              )}
            </Label>
            {onResetField && hubRow?.layer_has_key && !disabled && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="Reset to database baseline"
                disabled={!!resettingField || saving}
                data-testid="button-reset-seo-is_pillar"
                onClick={() => {
                  setResettingField("seo.is_pillar");
                  void onResetField("seo.is_pillar")
                    .then(() => {
                      setIsPillar(hubRow?.baseline === true || hubRow?.baseline === "true");
                    })
                    .finally(() => setResettingField(null));
                }}
              >
                {resettingField === "seo.is_pillar" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="seo-pillar-path" className="text-xs text-foreground flex items-center gap-2">
                Pillar path
                {seoSourceBadge(pillarRow) && (
                  <Badge variant={seoSourceBadge(pillarRow)!.variant} className="text-[10px] font-normal">
                    {seoSourceBadge(pillarRow)!.label}
                  </Badge>
                )}
              </Label>
              {onResetField && pillarRow?.layer_has_key && !disabled && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title="Reset to database baseline"
                  disabled={!!resettingField || saving || pathLocked}
                  data-testid="button-reset-seo-pillar_path"
                  onClick={() => {
                    setResettingField("seo.pillar_path");
                    void onResetField("seo.pillar_path")
                      .then(() => {
                        setPillarPath(
                          typeof pillarRow?.baseline === "string" ? pillarRow.baseline : "",
                        );
                      })
                      .finally(() => setResettingField(null));
                  }}
                >
                  {resettingField === "seo.pillar_path" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
            <div className="flex gap-2 min-w-0">
              <Input
                id="seo-pillar-path"
                className="bg-background font-mono text-xs flex-1 min-w-0"
                value={pillarPath}
                disabled={pathLocked}
                onChange={(e) => setPillarPath(e.target.value)}
                data-testid="input-seo-pillar-path"
              />
              <Popover open={chooserOpen} onOpenChange={setChooserOpen} modal={false}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={pathLocked}
                    data-testid="button-choose-pillar"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    Choose pillar
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-80 p-0 z-[10001] pointer-events-auto"
                  align="end"
                  container={portalContainer}
                  onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.querySelector<HTMLInputElement>("input");
                    input?.focus({ preventScroll: true });
                  }}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Command>
                    <CommandInput
                      placeholder="Search hubs…"
                      data-testid="input-choose-pillar-search"
                    />
                    <CommandList>
                      <CommandEmpty data-testid="empty-choose-pillar">
                        {localeHubs.length === 0
                          ? "No pillar pages for this locale yet"
                          : "No matching pillars."}
                      </CommandEmpty>
                      {localeHubs.length > 0 && (
                        <CommandGroup>
                          {localeHubs.map((cluster) => {
                            const keyword =
                              typeof cluster.keyword === "string" ? cluster.keyword.trim() : "";
                            const slugLabel = deslugifyLabel(
                              cluster.pillarUrl.replace(/\/+$/, "").split("/").filter(Boolean).pop() || "",
                            );
                            const label = keyword
                              ? deslugifyLabel(keyword)
                              : slugLabel || cluster.pillarUrl;
                            return (
                              <CommandItem
                                key={cluster.hubId || cluster.pillarUrl}
                                value={`${label} ${keyword} ${cluster.pillarUrl} ${cluster.hubId ?? ""}`}
                                onSelect={() => {
                                  setPillarPath(cluster.pillarUrl);
                                  setChooserOpen(false);
                                }}
                                data-testid={`option-pillar-${cluster.pillarUrl}`}
                              >
                                <span className="flex-1 min-w-0 text-xs truncate">
                                  {label}
                                </span>
                                <span className="text-[10px] text-muted-foreground ml-2 shrink-0">
                                  {cluster.clusterCount} member{cluster.clusterCount === 1 ? "" : "s"}
                                </span>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <p className="text-xs">
              Choose a hub or type a path. Empty path = cluster gap (still monitored).
            </p>
            {isVariantLayer && !seoWriteBlocked && (
              <p className="text-xs" data-testid="text-pillar-chooser-variant-live">
                List is live hubs. This draft SEO applies when you publish the page.
              </p>
            )}
            {localeMismatch && (
              <p
                className="text-xs text-destructive flex items-center gap-1"
                data-testid="text-pillar-locale-mismatch"
              >
                <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                Path locale prefix must match this file ({locale}).
              </p>
            )}
            {unknownHub && (
              <p
                className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1"
                data-testid="text-pillar-unknown-hub"
              >
                <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                This URL isn&apos;t a known pillar yet. Save is still allowed.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={disabled || saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave({
                    ...researchFieldsPayload(),
                    "seo.pillar_path": pillarPath,
                    "seo.is_pillar": isPillar,
                  });
                  setSeoFieldsEditing(false);
                } catch (err) {
                  toast({
                    title: "SEO save failed",
                    description: err instanceof Error ? err.message : String(err),
                    variant: "destructive",
                  });
                } finally {
                  setSaving(false);
                }
              }}
              data-testid="button-save-seo-fields"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Save SEO fields
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSeoFieldsEditing(false)}
              disabled={saving}
              data-testid="button-seo-fields-done"
            >
              Done editing
            </Button>
          </div>
            </>
          ) : null}
        </div>
        {contentType === "blog" && clusterSeoOn ? (
          <p className="text-xs">
            Cluster keyword/URL on the <strong>Fields</strong> tab are temporary holding columns — not the hub.
          </p>
        ) : null}
      </div>
      )}
    </div>
  );
}

/** Keyword / pillar / cluster fields (`seo:*` in locale YAML). Used on SEO Meta tab and optionally Fields tab. */
export function EntrySeoClusterFields({
  contentType,
  slug,
  locale,
  variant,
  portalContainer,
}: {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
  portalContainer?: HTMLElement | null;
}) {
  const { toast } = useToast();

  const variantParam =
    typeof variant === "string" && variant.trim() && variant.trim() !== "default"
      ? variant.trim()
      : undefined;

  const provenanceKey = [
    "/api/content-types",
    contentType,
    "field-provenance",
    slug,
    locale,
    variantParam || "",
  ] as const;

  const { data: provenance, isLoading } = useQuery<ProvenanceResponse>({
    queryKey: provenanceKey,
    queryFn: () => {
      const q = new URLSearchParams({ locale });
      if (variantParam) q.set("variant", variantParam);
      return fetch(
        `/api/content-types/${encodeURIComponent(contentType)}/field-provenance/${encodeURIComponent(slug)}?${q}`,
      ).then((r) => {
        if (!r.ok) throw new Error("Failed to load SEO fields");
        return r.json();
      });
    },
  });

  const { data: ctConfig } = useQuery<ContentTypeConfig>({
    queryKey: ["/api/content-types", contentType, "config"],
    queryFn: () => fetch(`/api/content-types/${contentType}/config`).then((r) => r.json()),
  });

  const seoRows = (provenance?.fields ?? []).filter((f) => f.group === "seo");
  const directory = ctConfig?.directory || contentType;
  const layerFileName = provenance?.layerFileName;
  const isVariantLayer = !!provenance?.isVariantLayer || !!variantParam;
  const seoDisabled = !!provenance?.seoFileMissing;
  const seoWriteBlocked = provenance?.seoWriteAllowed === false;
  const seoWriteBlockReason = provenance?.seoWriteBlockReason;

  const authHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getDebugToken();
    if (token) headers["X-Debug-Token"] = token;
    return headers;
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [...provenanceKey] });
  };

  const saveSeoFields = async (built: Record<string, unknown>) => {
    if (seoWriteBlocked) {
      throw new Error(seoWriteBlockReason || "SEO writes are not allowed on this layer.");
    }
    const headers = await authHeaders();
    const author = await resolveAuthorName();
    const res = await fetch(
      `/api/content-types/${encodeURIComponent(contentType)}/field-overrides/${encodeURIComponent(slug)}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          locale,
          variant: variantParam,
          fields: built,
          author: author || undefined,
        }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || "Failed to save SEO fields");
    }
    toast({ title: "SEO fields saved" });
    invalidate();
  };

  const resetSeoOverlayField = async (fieldPath: string) => {
    if (seoWriteBlocked) {
      throw new Error(seoWriteBlockReason || "SEO writes are not allowed on this layer.");
    }
    const headers = await authHeaders();
    const author = await resolveAuthorName();
    const res = await fetch(
      `/api/content-types/${encodeURIComponent(contentType)}/field-reset/${encodeURIComponent(slug)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          field: fieldPath,
          locale,
          variant: variantParam,
          author: author || undefined,
        }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      noop?: boolean;
      message?: string;
    };
    if (!res.ok) {
      throw new Error(body.error || "Failed to reset SEO field");
    }
    if (body.noop) {
      toast({
        title: "Nothing to reset",
        description: body.message || body.error || "Field is not set on locale seo:.",
      });
    } else {
      toast({
        title: "SEO field reset",
        description: `"${fieldPath}" restored to the database baseline (locale YAML key removed).`,
      });
    }
    invalidate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-2" data-testid="seo-fields-loading">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading cluster fields…
      </div>
    );
  }

  return (
    <SeoFieldsEditor
      rows={seoRows}
      disabled={seoDisabled}
      canonicalPath={provenance?.canonicalPath}
      isVariantLayer={isVariantLayer}
      layerFileName={layerFileName}
      locale={locale}
      directory={directory}
      slug={slug}
      contentType={contentType}
      seoMonitoringEnabled={ctConfig?.seo_monitoring?.enabled === true}
      seoWriteBlocked={seoWriteBlocked}
      seoWriteBlockReason={seoWriteBlockReason}
      onSave={saveSeoFields}
      onResetField={async (fieldPath) => {
        try {
          await resetSeoOverlayField(fieldPath);
        } catch (err) {
          toast({
            title: "SEO reset failed",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
          throw err;
        }
      }}
      portalContainer={portalContainer}
    />
  );
}

const VALUE_PREVIEW_MAX = 100;

function formatDisplayValue(value: unknown, maxLength?: number): string {
  if (value === null || value === undefined || value === "") return "—";
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof value === "number" || typeof value === "boolean") text = String(value);
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  if (maxLength != null && text.length > maxLength) {
    return `${text.slice(0, maxLength).trimEnd()}…`;
  }
  return text;
}

function sourceBadge(source: FieldSource): { label: string; variant: "default" | "secondary" | "outline" } {
  switch (source) {
    case "db_override":
      return { label: "Database override", variant: "default" };
    case "ct_override":
      return { label: "Content type override", variant: "secondary" };
    case "entry_default":
      return { label: "Entry default", variant: "outline" };
    default:
      return { label: "Original database", variant: "outline" };
  }
}

export function MappingFieldsTab({
  contentType,
  slug,
  locale,
  typeLabel,
  variant,
  hideSeoFields = false,
  onOpenSeoMeta,
  portalContainer,
}: {
  contentType: string;
  slug: string;
  locale: string;
  typeLabel: string;
  /** Preview/Debug variant slug (e.g. draft, lumi-version). Omit for live locale file. */
  variant?: string | null;
  /** When true, cluster/keyword SEO fields are omitted (shown on SEO Meta tab instead). */
  hideSeoFields?: boolean;
  /** Switch to SEO Meta tab in the parent modal (share preview). */
  onOpenSeoMeta?: () => void;
  portalContainer?: HTMLElement | null;
}) {
  const { toast } = useToast();
  const [levelChooserField, setLevelChooserField] = useState<FieldProvenance | null>(null);
  const [editing, setEditing] = useState<{
    field: string;
    level: "database" | "content_type";
    value: unknown;
  } | null>(null);
  const [resetTarget, setResetTarget] = useState<FieldProvenance | null>(null);
  const [resetting, setResetting] = useState(false);
  const [variantConfirmOpen, setVariantConfirmOpen] = useState(false);
  const variantConfirmRef = useRef<{
    resolve: (ok: boolean) => void;
  } | null>(null);

  const variantParam =
    typeof variant === "string" && variant.trim() && variant.trim() !== "default"
      ? variant.trim()
      : undefined;

  const { data: attachStatus } = useQuery<{ detached?: boolean }>({
    queryKey: ["/api/content", contentType, slug, "attach-status", locale],
    queryFn: async () => {
      const res = await fetch(
        `/api/content/${encodeURIComponent(contentType)}/${encodeURIComponent(slug)}/attach-status?locale=${encodeURIComponent(locale)}`,
      );
      if (!res.ok) return { detached: false };
      return res.json();
    },
    staleTime: 30_000,
  });
  const entryDetached = !!attachStatus?.detached;

  const provenanceKey = [
    "/api/content-types",
    contentType,
    "field-provenance",
    slug,
    locale,
    variantParam || "",
  ] as const;

  const { data: provenance, isLoading } = useQuery<ProvenanceResponse>({
    queryKey: provenanceKey,
    queryFn: () => {
      const q = new URLSearchParams({ locale });
      if (variantParam) q.set("variant", variantParam);
      return fetch(
        `/api/content-types/${encodeURIComponent(contentType)}/field-provenance/${encodeURIComponent(slug)}?${q}`,
      ).then((r) => {
        if (!r.ok) throw new Error("Failed to load fields");
        return r.json();
      });
    },
  });

  const { data: ctConfig } = useQuery<ContentTypeConfig>({
    queryKey: ["/api/content-types", contentType, "config"],
    queryFn: () => fetch(`/api/content-types/${contentType}/config`).then((r) => r.json()),
  });

  const { data: dbEditor } = useQuery<Record<string, EditorHint>>({
    queryKey: ["/api/databases", ctConfig?.database?.slug, "editor-config"],
    queryFn: async () => {
      const dbSlug = ctConfig?.database?.slug;
      if (!dbSlug) return {};
      const res = await fetch(`/api/databases/${dbSlug}`);
      if (!res.ok) return {};
      const data = await res.json();
      return (data.config?.editor as Record<string, EditorHint>) || {};
    },
    enabled: !!ctConfig?.database?.slug,
  });

  const editorMap = useMemo(() => {
    return { ...(dbEditor || {}), ...(ctConfig?.editor || {}) };
  }, [ctConfig?.editor, dbEditor]);

  const fields = provenance?.fields ?? [];
  const mappedFields = fields.filter((f) => f.group !== "seo");
  const hasDatabase = !!provenance?.hasDatabase;
  const hasMappings = mappedFields.length > 0;
  const directory = ctConfig?.directory || contentType;
  const databaseSlug = ctConfig?.database?.slug;
  const layerFileName = provenance?.layerFileName;
  const isVariantLayer = !!provenance?.isVariantLayer || !!variantParam;

  const variantWarning =
    isVariantLayer && layerFileName ? (
      <p
        className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100"
        data-testid="banner-fields-variant-layer"
      >
        Editing <code className="font-mono text-xs">{layerFileName}</code> — not the published{" "}
        <code className="font-mono text-xs">{locale}.yml</code>. Changes stay on this variant until
        promote/publish.
      </p>
    ) : null;

  const education = (
    <FieldsEducationBlock
      hasDatabase={hasDatabase}
      directory={directory}
      databaseSlug={databaseSlug}
      slug={slug}
      locale={locale}
      layerFileName={layerFileName}
    />
  );

  const authHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getDebugToken();
    if (token) headers["X-Debug-Token"] = token;
    return headers;
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [...provenanceKey] });
  };

  const confirmVariantSaveIfNeeded = async (): Promise<boolean> => {
    if (!isVariantLayer) return true;
    return new Promise((resolve) => {
      variantConfirmRef.current = { resolve };
      setVariantConfirmOpen(true);
    });
  };

  const openPencil = (row: FieldProvenance) => {
    if (row.calculated || isSystemSpecialField(row.field) || row.group === "seo") return;
    if (row.source === "ct_override" || (!hasDatabase && row.source === "entry_default")) {
      setEditing({ field: row.field, level: "content_type", value: row.effective });
      return;
    }
    if (row.source === "db_override") {
      setEditing({ field: row.field, level: "database", value: row.effective });
      return;
    }
    if (!hasDatabase) {
      setEditing({ field: row.field, level: "content_type", value: row.effective });
      return;
    }
    setLevelChooserField(row);
  };

  const handleReset = async () => {
    if (!resetTarget || isSystemSpecialField(resetTarget.field)) return;
    if (hasDatabase) {
      // DB path
    } else if (!resetTarget.layer_has_key) {
      toast({
        title: "Nothing to reset",
        description: `"${resetTarget.field}" is not set on this layer file (may come from _common.yml).`,
      });
      setResetTarget(null);
      return;
    }
    setResetting(true);
    try {
      const headers = await authHeaders();
      const author = await resolveAuthorName();
      const res = await fetch(
        `/api/content-types/${encodeURIComponent(contentType)}/field-reset/${encodeURIComponent(slug)}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            field: resetTarget.field,
            locale,
            variant: variantParam,
            author: author || undefined,
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        noop?: boolean;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(body.error || "Reset failed");
      }
      if (body.noop) {
        toast({
          title: "Nothing to reset",
          description: body.message || body.error || "Field is not set on this layer.",
        });
      } else {
        toast({
          title: "Field reset",
          description: hasDatabase
            ? `"${resetTarget.field}" restored to the original database value.`
            : `"${resetTarget.field}" removed from ${layerFileName || `${locale}.yml`}.`,
        });
      }
      setResetTarget(null);
      invalidate();
    } catch (err) {
      toast({
        title: "Reset failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  };

  const seoBlock = hideSeoFields ? null : (
    <EntrySeoClusterFields
      contentType={contentType}
      slug={slug}
      locale={locale}
      variant={variant}
    />
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading fields…</span>
      </div>
    );
  }

  if (!hasMappings) {
    const label = typeLabel || contentType;
    return (
      <div className="space-y-3 pt-4" data-testid="fields-tab-empty">
        {variantWarning}
        {seoBlock}
        {education}
        <p className="text-sm text-muted-foreground">
          {label} entries don&apos;t have any fields declared yet. Declare fields on the content type
          (for example <code className="font-mono text-xs bg-muted px-1 rounded">author_name</code>),
          then come back here to set each entry&apos;s values.
        </p>
        <Button variant="outline" size="sm" asChild data-testid="link-configure-fields">
          <Link href={`/private/type/${encodeURIComponent(contentType)}`}>
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
            Declare fields for {label}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-4" data-testid="fields-tab-table">
      {variantWarning}
      {seoBlock}
      {education}
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">Value</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium w-[88px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {mappedFields.map((row) => {
              const badge = sourceBadge(row.source);
              const special = isSystemSpecialField(row.field);
              const localeEmptyNote =
                row.field === "_locale" && !hasDatabase && (row.effective === undefined || row.effective === "");
              const hreflangsStaticNote = row.field === "_hreflangs" && !hasDatabase;
              const canReset =
                !row.calculated &&
                !special &&
                (hasDatabase ? row.source !== "original" : !!row.layer_has_key);
              return (
                <tr key={row.field} className="border-b last:border-b-0" data-testid={`row-field-${row.field}`}>
                  <td className="px-3 py-2 font-mono text-xs align-top">
                    <span className="inline-flex items-center gap-1">
                      {row.field}
                      {special && (
                        <Badge variant="outline" className="text-[9px] font-sans font-normal">
                          system
                        </Badge>
                      )}
                      {row.calculated && (
                        <Calculator
                          className="h-3 w-3 text-muted-foreground"
                        />
                      )}
                      {(row.field === "title" || row.field === "description") && (
                        <NotMetaFieldBadge
                          field={row.field}
                          onOpenSeoMeta={onOpenSeoMeta}
                          portalContainer={portalContainer}
                        />
                      )}
                    </span>
                    {(localeEmptyNote || hreflangsStaticNote) && (
                      <p className="text-[10px] text-muted-foreground font-sans mt-0.5 max-w-[160px]">
                        {localeEmptyNote
                          ? "Usually from file/URL — map a source on Manage → Fields if needed."
                          : "Static alternates use locale files — not set here."}
                      </p>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 text-xs align-top break-all max-w-[220px]"
                    title={formatDisplayValue(row.effective)}
                  >
                    {formatDisplayValue(row.effective, VALUE_PREVIEW_MAX)}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {special ? (
                      <Badge variant="outline" className="text-[10px] font-normal gap-1">
                        <Info className="h-3 w-3" />
                        Read-only
                      </Badge>
                    ) : (
                      <Badge variant={badge.variant} className="text-[10px] font-normal">
                        {badge.label}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-0.5">
                      {!row.calculated && !special && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Edit"
                          onClick={() => openPencil(row)}
                          data-testid={`button-edit-field-${row.field}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canReset && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Reset"
                          onClick={() => setResetTarget(row)}
                          data-testid={`button-reset-field-${row.field}`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog
        open={!!levelChooserField}
        onOpenChange={(v) => {
          if (!v) setLevelChooserField(null);
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="dialog-override-level">
          <DialogHeader>
            <DialogTitle>Where should this override live?</DialogTitle>
            <DialogDescription>
              Choose how <code className="font-mono text-xs">{levelChooserField?.field}</code> is stored.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Database override</span> — Updates the cached
              database value across listings and this page.
            </p>
            <p>
              <span className="font-medium text-foreground">Content type override</span> — Updates this
              page&apos;s YAML only for this locale.
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                if (!levelChooserField) return;
                setEditing({
                  field: levelChooserField.field,
                  level: "database",
                  value: levelChooserField.effective,
                });
                setLevelChooserField(null);
              }}
              data-testid="button-choose-db-level"
            >
              Database override
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                if (!levelChooserField) return;
                setEditing({
                  field: levelChooserField.field,
                  level: "content_type",
                  value: levelChooserField.effective,
                });
                setLevelChooserField(null);
              }}
              data-testid="button-choose-ct-level"
            >
              Content type override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!resetTarget} onOpenChange={(v) => { if (!v) setResetTarget(null); }}>
        <AlertDialogContent data-testid="dialog-reset-field">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset field?</AlertDialogTitle>
            <AlertDialogDescription>
              {hasDatabase ? (
                <>
                  <code className="font-mono text-xs">{resetTarget?.field}</code> will go back to{" "}
                  <span className="font-medium text-foreground">
                    {formatDisplayValue(resetTarget?.baseline)}
                  </span>
                  . All database and content type overrides for this field will be removed.
                </>
              ) : (
                <>
                  Remove <code className="font-mono text-xs">{resetTarget?.field}</code> from{" "}
                  <code className="font-mono text-xs">{layerFileName || `${locale}.yml`}</code>. Values that
                  only exist on <code className="font-mono text-xs">_common.yml</code> are left unchanged.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleReset()} disabled={resetting}>
              {resetting ? "Resetting…" : "Reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={variantConfirmOpen}
        onOpenChange={(v) => {
          if (!v) {
            variantConfirmRef.current?.resolve(false);
            variantConfirmRef.current = null;
            setVariantConfirmOpen(false);
          }
        }}
      >
        <AlertDialogContent data-testid="dialog-variant-save-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Save to variant file?</AlertDialogTitle>
            <AlertDialogDescription>
              You are editing{" "}
              <code className="font-mono text-xs">{layerFileName || variantParam}</code>, not the published{" "}
              <code className="font-mono text-xs">{locale}.yml</code>. Continue saving to the variant layer?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                variantConfirmRef.current?.resolve(false);
                variantConfirmRef.current = null;
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                variantConfirmRef.current?.resolve(true);
                variantConfirmRef.current = null;
                setVariantConfirmOpen(false);
              }}
            >
              Save to variant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editing && (
        <ItemEditModal
          onlyFields={[editing.field]}
          editorOverrides={editorMap}
          overrideLevel={editing.level}
          contentType={contentType}
          dbName={editing.level === "database" ? ctConfig?.database?.slug : undefined}
          item={{ [editing.field]: editing.value }}
          title={`Edit ${editing.field}`}
          entryDetached={entryDetached}
          onClose={() => setEditing(null)}
          onSave={async (built) => {
            if (editing.level === "content_type") {
              const ok = await confirmVariantSaveIfNeeded();
              if (!ok) {
                throw new Error("Save cancelled — no changes written.");
              }
            }
            const headers = await authHeaders();
            const author = await resolveAuthorName();
            if (editing.level === "database") {
              const res = await fetch(
                `/api/content-types/${encodeURIComponent(contentType)}/db-overrides/${encodeURIComponent(slug)}`,
                {
                  method: "PUT",
                  headers,
                  body: JSON.stringify({ fields: built, author: author || undefined }),
                },
              );
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error((err as { error?: string }).error || "Failed to save database override");
              }
            } else {
              const res = await fetch(
                `/api/content-types/${encodeURIComponent(contentType)}/field-overrides/${encodeURIComponent(slug)}`,
                {
                  method: "PUT",
                  headers,
                  body: JSON.stringify({
                    locale,
                    variant: variantParam,
                    fields: built,
                    author: author || undefined,
                  }),
                },
              );
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error((err as { error?: string }).error || "Failed to save field");
              }
            }
            invalidate();
          }}
        />
      )}
    </div>
  );
}
