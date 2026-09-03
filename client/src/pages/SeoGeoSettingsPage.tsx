import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  IconArrowLeft,
  IconBrandGoogle,
  IconPhoto,
  IconCode,
  IconSearch,
  IconWorldSearch,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { OgImageTab } from "@/components/settings/OgImageTab";
import { SchemaOrgTab } from "@/components/settings/SchemaOrgTab";
import { SearchConsoleTab } from "@/components/settings/SearchConsoleTab";
import { OpenRushTab } from "@/components/settings/OpenRushTab";

type SeoGeoTab = "og" | "schema" | "search-console" | "openrush";

const SEO_TABS: {
  id: SeoGeoTab;
  href: string;
  label: string;
  Icon: typeof IconPhoto;
}[] = [
  { id: "og", href: "/private/settings/seo/og", label: "OG Image", Icon: IconPhoto },
  { id: "schema", href: "/private/settings/seo/schema", label: "Schema org", Icon: IconCode },
  { id: "search-console", href: "/private/settings/seo/search-console", label: "Search Console", Icon: IconBrandGoogle },
  { id: "openrush", href: "/private/settings/seo/openrush", label: "OpenRush", Icon: IconWorldSearch },
];

function resolveSeoTab(pathname: string): SeoGeoTab | null {
  if (pathname === "/private/settings/seo/og") return "og";
  if (pathname === "/private/settings/seo/schema") return "schema";
  if (pathname === "/private/settings/seo/search-console") return "search-console";
  if (pathname === "/private/settings/seo/openrush") return "openrush";
  return null;
}

export default function SeoGeoSettingsPage() {
  const [pathname, setLocation] = useLocation();
  const activeTab = resolveSeoTab(pathname);

  useEffect(() => {
    if (pathname === "/private/settings/seo" || pathname === "/private/settings/seo/") {
      setLocation("/private/settings/seo/og");
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
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 pt-8 pb-24 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <Button variant="ghost" size="icon" asChild data-testid="button-seo-geo-settings-back">
              <Link href="/private/settings">
                <IconArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <IconSearch className="h-5 w-5 text-muted-foreground" />
                <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-seo-geo-settings-title">
                  SEO/GEO
                </h1>
              </div>
              <p className="text-sm text-muted-foreground">
                Open Graph capture credentials, Schema.org site definitions, Search Console inspection,
                and OpenRush SERP snapshots. Brand logos, social links, and the default social image stay under{" "}
                <Link href="/private/settings?tab=brand" className="underline underline-offset-2 hover:text-foreground">
                  General → Brand
                </Link>
                .
              </p>
            </div>
          </div>

          <ToggleButtonBar
            className="shrink-0"
            value={activeTab}
            onValueChange={(id) => {
              const tab = SEO_TABS.find((t) => t.id === id);
              if (!tab) return;
              setLocation(tab.href);
            }}
            listTestId="seo-geo-settings-tablist"
            listClassName="flex"
          >
            {SEO_TABS.map(({ id, label, Icon }) => (
              <ToggleButtonBarTrigger
                key={id}
                value={id}
                data-testid={`tab-seo-${id}`}
                className="gap-1.5"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </ToggleButtonBarTrigger>
            ))}
          </ToggleButtonBar>
        </div>

        <div role="tabpanel">
          {activeTab === "og" && <OgImageTab />}
          {activeTab === "schema" && <SchemaOrgTab />}
          {activeTab === "search-console" && <SearchConsoleTab />}
          {activeTab === "openrush" && <OpenRushTab />}
        </div>
      </div>
    </div>
  );
}
