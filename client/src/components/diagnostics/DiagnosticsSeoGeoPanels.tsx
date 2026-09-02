import { useQuery } from "@tanstack/react-query";
import { SeoTab, GeoTab, DiagnosticsFunnelTab } from "@/pages/SeoGeoPage";
import { Skeleton } from "@/components/ui/skeleton";

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
