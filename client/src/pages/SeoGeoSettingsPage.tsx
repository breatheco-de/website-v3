import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  IconBrandGoogle,
  IconPhoto,
  IconCode,
  IconSearch,
  IconWorldSearch,
  IconWorldUpload,
} from "@tabler/icons-react";
import { SettingsShell, type SettingsSecondaryTab } from "@/components/settings/SettingsShell";
import { OgImageTab } from "@/components/settings/OgImageTab";
import { SchemaOrgTab } from "@/components/settings/SchemaOrgTab";
import { SearchConsoleTab } from "@/components/settings/SearchConsoleTab";
import { OpenRushTab } from "@/components/settings/OpenRushTab";
import { IndexNowTab } from "@/components/settings/IndexNowTab";

type SeoGeoTab = "og" | "schema" | "search-console" | "indexnow" | "openrush";

const SEO_TABS: SettingsSecondaryTab<SeoGeoTab>[] = [
  { id: "og", href: "/private/settings/seo/og", label: "OG Image", Icon: IconPhoto },
  { id: "schema", href: "/private/settings/seo/schema", label: "Schema org", Icon: IconCode },
  { id: "search-console", href: "/private/settings/seo/search-console", label: "Search Console", Icon: IconBrandGoogle },
  { id: "indexnow", href: "/private/settings/seo/indexnow", label: "IndexNow", Icon: IconWorldUpload },
  { id: "openrush", href: "/private/settings/seo/openrush", label: "OpenRush", Icon: IconWorldSearch },
];

function resolveSeoTab(pathname: string): SeoGeoTab | null {
  if (pathname === "/private/settings/seo/og") return "og";
  if (pathname === "/private/settings/seo/schema") return "schema";
  if (pathname === "/private/settings/seo/search-console") return "search-console";
  if (pathname === "/private/settings/seo/indexnow") return "indexnow";
  if (pathname === "/private/settings/seo/openrush") return "openrush";
  return null;
}

export default function SeoGeoSettingsPage() {
  const [pathname, setLocation] = useLocation();
  const activeTab = resolveSeoTab(pathname);

  useEffect(() => {
    if (pathname === "/private/settings/seo" || pathname === "/private/settings/seo/") {
      setLocation("/private/settings/seo/og", { replace: true });
    }
  }, [pathname, setLocation]);

  if (!activeTab) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Redirecting…</div>
      </div>
    );
  }

  return (
    <SettingsShell
      section="seo"
      icon={IconSearch}
      title="SEO/GEO"
      titleTestId="text-seo-geo-settings-title"
      backTestId="button-seo-geo-settings-back"
      description={
        <>
          Open Graph capture credentials, Schema.org site definitions, Search Console inspection,
          IndexNow notices to Bing, and OpenRush SERP snapshots. Brand logos, social links, and the default social image stay under{" "}
          <Link href="/private/settings/brand" className="underline underline-offset-2 hover:text-foreground">
            General → Brand
          </Link>
          .
        </>
      }
      secondary={{
        value: activeTab,
        tabs: SEO_TABS,
        listTestId: "seo-geo-settings-tablist",
        triggerTestId: (id) => `tab-seo-${id}`,
      }}
    >
      <div role="tabpanel">
        {activeTab === "og" && <OgImageTab />}
        {activeTab === "schema" && <SchemaOrgTab />}
        {activeTab === "search-console" && <SearchConsoleTab />}
        {activeTab === "indexnow" && <IndexNowTab />}
        {activeTab === "openrush" && <OpenRushTab />}
      </div>
    </SettingsShell>
  );
}
