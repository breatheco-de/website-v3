import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { SeoTab, GeoTab, DiagnosticsFunnelTab } from "@/pages/SeoGeoPage";
import { Skeleton } from "@/components/ui/skeleton";
import { DiagnosticsOrganicPanel } from "@/components/diagnostics/DiagnosticsOrganicPanel";
import { isDiagnosticsSeoOrganic } from "@/lib/diagnostics-tab";
import { cn } from "@/lib/utils";

interface SeoOverview {
  intentDistribution: Record<string, Record<string, number>>;
  clusters: {
    pillarUrl: string;
    clusterSlugs: string[];
    clusterCount: number;
    keyword?: string | null;
    locale?: string;
    members?: {
      id: string;
      slug: string;
      contentType: string;
      locale: string;
      path: string;
      keyword?: string | null;
      lastmod?: string | null;
      updated_at?: string | null;
    }[];
  }[];
  orphanPages: {
    slug: string;
    contentType: string;
    intent: string;
    filePath: string;
    locale?: string;
    pillar_path?: string;
    reason?: "hub_not_found" | "hub_not_pillar";
  }[];
  clusterHealth?: {
    emptyHubCount: number;
    stats: Record<string, number>;
    byContentType: Record<string, Record<string, number>>;
    byLocale: Record<string, Record<string, number>>;
  };
  brokenClusterRefs?: Array<{
    slug: string;
    contentType: string;
    locale: string;
    reason: "hub_not_found" | "hub_not_pillar";
  }>;
  featureCoverage: Record<string, number>;
  faqCoverage: { slug: string; contentType: string; locale: string; faqCount: number }[];
  schemaCoverage: Record<string, number>;
  totals: {
    totalPages: number;
    withPillar: number;
    withIntent: number;
    withFocusFeatures: number;
    withFaq: number;
    withSchema: number;
    withKeyword?: number;
  };
}

interface BrandContext {
  brand?: { name?: string; tagline?: string; mission?: string };
  voice?: { tone?: string; style?: string; personality?: string };
  key_differentiators?: string[];
  forbidden_phrases?: { phrase: string; reason: string }[];
  target_audience?: {
    primary?: { description?: string; age_range?: string; motivations?: string[]; concerns?: string[] };
  };
}

function LoadingSection() {
  return (
    <div className="space-y-4 py-4">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function DiagnosticsSeoPanel() {
  const [pathname] = useLocation();
  const organic = isDiagnosticsSeoOrganic(pathname);

  return (
    <div className="space-y-4">
      <nav
        className="inline-flex h-auto items-center gap-0.5 rounded-md border border-muted-foreground/20 bg-muted/40 p-0.5"
        data-testid="seo-subnav"
      >
        <Link
          href="/private/diagnostics/seo"
          className={cn(
            "inline-flex items-center justify-center rounded-sm px-2 py-1.5 text-xs font-medium",
            !organic ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          data-testid="seo-subnav-overview"
        >
          Overview
        </Link>
        <Link
          href="/private/diagnostics/seo/organic"
          className={cn(
            "inline-flex items-center justify-center rounded-sm px-2 py-1.5 text-xs font-medium",
            organic ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          data-testid="seo-subnav-organic"
        >
          Opportunities
        </Link>
      </nav>
      {organic ? <DiagnosticsOrganicPanel /> : <DiagnosticsSeoOverview />}
    </div>
  );
}

function DiagnosticsSeoOverview() {
  const { data: overview, isLoading } = useQuery<SeoOverview>({
    queryKey: ["/api/seo/overview"],
  });
  if (isLoading) return <LoadingSection />;
  if (!overview) {
    return <p className="text-muted-foreground text-sm text-center py-12">Failed to load SEO data</p>;
  }
  return <SeoTab data={overview} />;
}

export function DiagnosticsFunnelPanel() {
  const { data: overview, isLoading } = useQuery<SeoOverview>({
    queryKey: ["/api/seo/overview"],
  });
  if (isLoading) return <LoadingSection />;
  if (!overview) {
    return <p className="text-muted-foreground text-sm text-center py-12">Failed to load funnel data</p>;
  }
  return <DiagnosticsFunnelTab data={overview} />;
}

export function DiagnosticsGeoPanel() {
  const { data: overview, isLoading: overviewLoading } = useQuery<SeoOverview>({
    queryKey: ["/api/seo/overview"],
  });
  const { data: brandRaw, isLoading: brandLoading } = useQuery<BrandContext>({
    queryKey: ["/api/brand-context"],
  });
  const brand = brandRaw as BrandContext | null | undefined;
  if (overviewLoading || brandLoading) return <LoadingSection />;
  if (!overview) {
    return <p className="text-muted-foreground text-sm text-center py-12">Failed to load GEO data</p>;
  }
  return <GeoTab data={overview} brand={brand} />;
}
