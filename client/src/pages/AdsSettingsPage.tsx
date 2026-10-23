import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { IconBrandGoogle, IconBrandMeta, IconSpeakerphone, IconTarget } from "@tabler/icons-react";
import { SettingsShell, type SettingsSecondaryTab } from "@/components/settings/SettingsShell";
import { MetaAdsTab } from "@/components/settings/MetaAdsTab";
import { GoogleAdsTab } from "@/components/settings/GoogleAdsTab";
import { StageTargetsTab } from "@/components/settings/StageTargetsTab";

type AdsTab = "meta" | "google" | "targets";

const ADS_TABS: SettingsSecondaryTab<AdsTab>[] = [
  { id: "meta", href: "/private/settings/ads/meta", label: "Meta", Icon: IconBrandMeta },
  { id: "google", href: "/private/settings/ads/google", label: "Google Ads", Icon: IconBrandGoogle },
  { id: "targets", href: "/private/settings/ads/targets", label: "Targets", Icon: IconTarget },
];

function resolveAdsTab(pathname: string): AdsTab | null {
  if (pathname === "/private/settings/ads/meta") return "meta";
  if (pathname === "/private/settings/ads/google") return "google";
  if (pathname === "/private/settings/ads/targets") return "targets";
  return null;
}

export default function AdsSettingsPage() {
  const [pathname, setLocation] = useLocation();
  const activeTab = resolveAdsTab(pathname);

  useEffect(() => {
    if (pathname === "/private/settings/ads" || pathname === "/private/settings/ads/") {
      setLocation("/private/settings/ads/meta", { replace: true });
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
      section="ads"
      icon={IconSpeakerphone}
      title="Ads"
      titleTestId="text-ads-settings-title"
      backTestId="button-ads-settings-back"
      description={
        <>
          Connect ad platforms so paid visits, spend and leads show up next to your pages. Reports live in{" "}
          <Link href="/private/diagnostics/ads" className="underline underline-offset-2 hover:text-foreground">
            Diagnostics → Ads
          </Link>
          .
        </>
      }
      secondary={{
        value: activeTab,
        tabs: ADS_TABS,
        listTestId: "ads-settings-tablist",
        triggerTestId: (id) => `tab-ads-${id}`,
      }}
    >
      <div role="tabpanel">
        {activeTab === "meta" && <MetaAdsTab />}
        {activeTab === "google" && <GoogleAdsTab />}
        {activeTab === "targets" && <StageTargetsTab />}
      </div>
    </SettingsShell>
  );
}
