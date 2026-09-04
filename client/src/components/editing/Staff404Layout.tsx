import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { useSearch } from "wouter";
import {
  formatRedirectMatchLabel,
  type RedirectTraceHop,
} from "@shared/redirect-trace";
import { useRedirectTraceHops } from "@/hooks/useRedirectTraceHops";
import {
  buildStaff404Model,
  hasRebuiltQueryParam,
  staff404DashboardHref,
  staff404RedirectsHref,
  STAFF_404_UNKNOWN_PUBLIC_PAGE,
  type Staff404Surface,
} from "@/lib/staff404";
import Staff404Actions from "@/components/editing/Staff404Actions";
import {
  RebuildUrlsConfirmDialog,
  useRebuildContentUrls,
} from "@/components/editing/RebuildContentUrlsHint";
import { openDebugBubble } from "@/components/DebugBubble/utils/debugHelpers";

function sourceFile(source?: string): string {
  if (!source) return "";
  const parts = source.split("/");
  return parts[parts.length - 1] || source;
}

function hopMeta(hop: RedirectTraceHop): string {
  const bits = [String(hop.status), formatRedirectMatchLabel(hop)];
  const file = sourceFile(hop.source);
  if (file) bits.push(file);
  return bits.join(" · ");
}

export default function Staff404Layout({
  surface,
  typeLabel,
  slug,
  contentType,
  isValidType = true,
  listingSharedTemplate = false,
  isDraftOnly = false,
  hasEntryVariants = false,
  variantsLoading = false,
  hasTemplateVariants = false,
  requestedVariantMissing = false,
  requestedVariant,
  locale,
  yamlExists = false,
  yamlLoadFailed = false,
  yamlLoadDetails = null,
  yamlLoadFile = null,
  staffOrEditMode = true,
  headingOverride,
  compact = false,
  onEditYaml,
  onEditTemplates,
  onOpenDraft,
}: {
  surface: Staff404Surface;
  typeLabel: string;
  slug?: string;
  contentType?: string;
  isValidType?: boolean;
  listingSharedTemplate?: boolean;
  isDraftOnly?: boolean;
  hasEntryVariants?: boolean;
  variantsLoading?: boolean;
  hasTemplateVariants?: boolean;
  requestedVariantMissing?: boolean;
  requestedVariant?: string | null;
  locale?: string;
  yamlExists?: boolean;
  yamlLoadFailed?: boolean;
  yamlLoadDetails?: string | null;
  yamlLoadFile?: string | null;
  staffOrEditMode?: boolean;
  headingOverride?: string;
  compact?: boolean;
  onEditYaml?: () => void;
  onEditTemplates?: () => void;
  onOpenDraft?: () => void;
}) {
  const hops = useRedirectTraceHops();
  const { busy, rebuild, confirmOpen, setConfirmOpen, requestRebuild } = useRebuildContentUrls();
  const [hopsExpanded, setHopsExpanded] = useState(false);
  const [yamlAdvancedOpen, setYamlAdvancedOpen] = useState(false);
  const [historyLength, setHistoryLength] = useState(1);
  const searchString = useSearch();
  const rebuilt = hasRebuiltQueryParam(searchString);

  useEffect(() => {
    setHistoryLength(window.history.length);
  }, []);

  const facts = useMemo(
    () => ({
      surface,
      typeLabel,
      slug,
      contentType,
      isValidType,
      listingSharedTemplate,
      isDraftOnly,
      hasEntryVariants,
      variantsLoading,
      hasTemplateVariants,
      requestedVariantMissing,
      requestedVariant,
      locale,
      yamlExists,
      yamlLoadFailed,
      yamlLoadDetails,
      yamlLoadFile,
      hops,
      rebuilt,
      historyLength,
      staffOrEditMode,
    }),
    [
      surface,
      typeLabel,
      slug,
      contentType,
      isValidType,
      listingSharedTemplate,
      isDraftOnly,
      hasEntryVariants,
      variantsLoading,
      hasTemplateVariants,
      requestedVariantMissing,
      requestedVariant,
      locale,
      yamlExists,
      yamlLoadFailed,
      yamlLoadDetails,
      yamlLoadFile,
      hops,
      rebuilt,
      historyLength,
      staffOrEditMode,
    ],
  );

  const model = useMemo(() => buildStaff404Model(facts), [facts]);
  const lastHop = hops[hops.length - 1];
  const multiHop = hops.length > 1;

  return (
    <div className="w-full text-left" data-testid="staff-404-layout">
      {!compact && (
        <div className="text-center mb-6">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground" data-testid="staff-404-title">
            {headingOverride ?? model.title}
          </h1>
        </div>
      )}

      <section className="mb-6" data-testid="staff-404-what-happened">
        <h2 className="text-sm font-medium text-foreground mb-2">What happened</h2>
        <div className="space-y-2">
          {model.happened.map((sentence) =>
            sentence === STAFF_404_UNKNOWN_PUBLIC_PAGE ? (
              <p key={sentence} className="text-sm text-muted-foreground">
                This URL is not a known page on our{" "}
                <button
                  type="button"
                  className="underline underline-offset-2 text-foreground hover:text-primary"
                  onClick={() => openDebugBubble("sitemap")}
                  data-testid="link-open-content-urls"
                >
                  Content URLs
                </button>
                .
              </p>
            ) : (
              <p key={sentence} className="text-sm text-muted-foreground">
                {sentence}
              </p>
            ),
          )}
        </div>
        {yamlLoadFailed && (yamlLoadDetails || yamlLoadFile) && (
          <div className="mt-3">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setYamlAdvancedOpen((v) => !v)}
              data-testid="button-toggle-yaml-advanced"
            >
              {yamlAdvancedOpen ? "Hide details" : "Read more (advanced)"}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${yamlAdvancedOpen ? "rotate-180" : ""}`}
              />
            </button>
            {yamlAdvancedOpen && (
              <div
                className="mt-2 rounded-md border border-border bg-card p-3 space-y-1.5 text-left"
                data-testid="staff-404-yaml-advanced"
              >
                {yamlLoadFile && (
                  <p className="text-xs font-mono text-foreground break-all">{yamlLoadFile}</p>
                )}
                {yamlLoadDetails && (
                  <p className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-words">
                    {yamlLoadDetails}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        {hops.length > 0 && lastHop && (
          <div className="mt-3 rounded-md border border-border bg-card p-3">
            {!multiHop ? (
              <div className="space-y-1">
                <p className="text-sm text-foreground font-mono break-all">
                  {lastHop.from} → {lastHop.to}
                </p>
                <p className="text-xs text-muted-foreground">{hopMeta(lastHop)}</p>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setHopsExpanded((v) => !v)}
                  data-testid="button-toggle-redirect-trace"
                >
                  {hopsExpanded
                    ? "Hide hops"
                    : `Review the redirect trace (${hops.length} hops)`}
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${hopsExpanded ? "rotate-180" : ""}`}
                  />
                </button>
                {hopsExpanded && (
                  <ol className="mt-2 space-y-2 list-decimal list-inside text-left">
                    {hops.map((item, i) => (
                      <li key={`${item.from}:${item.to}:${i}`} className="text-sm">
                        <span className="font-mono break-all text-foreground">
                          {item.from} → {item.to}
                        </span>
                        <p className="text-xs text-muted-foreground ml-5">{hopMeta(item)}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-foreground mb-3">What you can do</h2>
        <Staff404Actions
          actions={model.actions}
          facts={facts}
          handlers={{
            onGoBack: () => window.history.back(),
            dashboardHref: contentType ? staff404DashboardHref(contentType) : undefined,
            onEditTemplates,
            templatesDisabled: variantsLoading && !hasTemplateVariants,
            onOpenDraft,
            onRebuild: requestRebuild,
            rebuildBusy: busy,
            onEditYaml,
            redirectsHref: hops.length ? staff404RedirectsHref(hops) : undefined,
          }}
        />
        <RebuildUrlsConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          busy={busy}
          onConfirm={() => void rebuild()}
        />
      </section>
    </div>
  );
}
