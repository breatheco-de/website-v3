import { useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { LocationOverrideModal } from "./LocationOverrideModal";
import { badgeVariants } from "@/components/ui/badge";
import { useSession } from "@/contexts/SessionContext";
import { useToast } from "@/hooks/use-toast";
import { useLocationCatalog } from "@/hooks/useLocationCatalog";
import { cn } from "@/lib/utils";

const REGION_LABELS: Record<string, string> = {
  "usa-canada": "USA & Canada",
  latam: "Latin America",
  europe: "Europe",
};

export function LocationOverrideBadge({
  readOnlyLlm = false,
}: {
  /** LLM crawler preview: show “all sections” and do not open the override modal. */
  readOnlyLlm?: boolean;
}) {
  const { session, refreshGeo } = useSession();
  const { toast } = useToast();
  const { data: locations = [] } = useLocationCatalog();
  const [open, setOpen] = useState(false);
  const [selectedLocationSlug, setSelectedLocationSlug] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  const currentLocationOverride =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("location")
      : null;

  const locationsByRegion = useMemo(
    () =>
      locations.reduce(
        (acc, loc) => {
          if (!acc[loc.region]) acc[loc.region] = [];
          acc[loc.region].push(loc);
          return acc;
        },
        {} as Record<string, typeof locations>,
      ),
    [locations],
  );

  if (readOnlyLlm) {
    return (
      <span
        className={cn(
          badgeVariants({ variant: "outline" }),
          "text-xs gap-1 pointer-events-none",
        )}
        data-testid="badge-location-llm-readonly"
        title="AI crawler preview shows every regional section at once"
      >
        <MapPin className="h-3 w-3" />
        <span className="max-w-[160px] truncate">All sections visible at once</span>
      </span>
    );
  }

  const handleLocationOverride = () => {
    if (!selectedLocationSlug) return;
    const url = new URL(window.location.href);
    url.searchParams.set("location", selectedLocationSlug);
    window.location.href = url.toString();
  };

  const handleClearLocationOverride = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("location");
    window.location.href = url.toString();
  };

  const handleResetLocation = async () => {
    setIsResetting(true);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("location")) {
        url.searchParams.delete("location");
        window.history.replaceState({}, "", url.toString());
      }
      await refreshGeo();
      toast({
        title: "Location auto-detected",
        description: "Campus was recalculated like an anonymous visitor. URL override removed if present.",
      });
      setOpen(false);
    } catch {
      toast({
        title: "Could not auto-detect location",
        description: "Re-detect failed. Try again or reload the page.",
        variant: "destructive",
      });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={cn(
          badgeVariants({ variant: "outline" }),
          "cursor-pointer text-xs gap-1 no-default-active-elevate",
        )}
        onClick={() => {
          setSelectedLocationSlug(session.location?.slug || "");
          setOpen(true);
        }}
        data-testid="button-location-override"
        title={
          currentLocationOverride
            ? `Location override: ${currentLocationOverride}`
            : "Click to override location"
        }
      >
        <MapPin className="h-3 w-3" />
        <span className="max-w-[80px] truncate">{session.location?.name || "Detecting..."}</span>
      </button>
      <LocationOverrideModal
        open={open}
        onOpenChange={setOpen}
        currentLocation={session.location}
        selectedLocationSlug={selectedLocationSlug}
        setSelectedLocationSlug={setSelectedLocationSlug}
        currentLocationOverride={currentLocationOverride}
        handleLocationOverride={handleLocationOverride}
        handleClearLocationOverride={handleClearLocationOverride}
        handleResetLocation={handleResetLocation}
        isResetting={isResetting}
        locationsByRegion={locationsByRegion}
        regionLabels={REGION_LABELS}
      />
    </>
  );
}
