import { Button } from "@/components/ui/button";
import { Globe, MapPin, Monitor, Smartphone } from "lucide-react";
import { useLocationCatalog } from "@/hooks/useLocationCatalog";
import { TagInput } from "./TagInput";
import { deslugify } from "../utils/debugHelpers";
import type { TargetingStepProps } from "../types";

export function TargetingStep({
  targetRegions, setTargetRegions,
  targetDevices, setTargetDevices,
  targetLocations, setTargetLocations,
  targetUtmSources, setTargetUtmSources,
  targetUtmCampaigns, setTargetUtmCampaigns,
  targetUtmMediums, setTargetUtmMediums,
  targetCountries, setTargetCountries,
}: TargetingStepProps) {
  const { data: locations = [] } = useLocationCatalog();
  const locationSlugs = locations.map(l => l.slug);
  
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Leave empty to target all visitors, or select specific audiences.
      </p>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Regions
          </label>
          <div className="flex flex-wrap gap-2">
            {['usa-canada', 'latam', 'europe'].map((region) => (
              <Button
                key={region}
                type="button"
                variant={targetRegions.includes(region) ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setTargetRegions(
                    targetRegions.includes(region) 
                      ? targetRegions.filter(r => r !== region)
                      : [...targetRegions, region]
                  );
                }}
                data-testid={`button-region-${region}`}
              >
                {deslugify(region)}
              </Button>
            ))}
          </div>
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            Devices
          </label>
          <div className="flex flex-wrap gap-2">
            {(['mobile', 'tablet', 'desktop'] as const).map((device) => (
              <Button
                key={device}
                type="button"
                variant={targetDevices.includes(device) ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setTargetDevices(
                    targetDevices.includes(device) 
                      ? targetDevices.filter(d => d !== device)
                      : [...targetDevices, device]
                  );
                }}
                data-testid={`button-device-${device}`}
              >
                {device === 'mobile' && <Smartphone className="h-3 w-3 mr-1" />}
                {device === 'desktop' && <Monitor className="h-3 w-3 mr-1" />}
                {device.charAt(0).toUpperCase() + device.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </div>
      
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          Campus Locations
        </label>
        <TagInput
          tags={targetLocations}
          setTags={setTargetLocations}
          placeholder="Type to search locations..."
          suggestions={locationSlugs}
          testId="input-locations"
        />
      </div>
      
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <label className="text-sm font-medium">UTM Sources</label>
          <TagInput
            tags={targetUtmSources}
            setTags={setTargetUtmSources}
            placeholder="google, facebook..."
            testId="input-utm-sources"
          />
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-medium">UTM Campaigns</label>
          <TagInput
            tags={targetUtmCampaigns}
            setTags={setTargetUtmCampaigns}
            placeholder="summer-2024..."
            testId="input-utm-campaigns"
          />
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-medium">UTM Mediums</label>
          <TagInput
            tags={targetUtmMediums}
            setTags={setTargetUtmMediums}
            placeholder="cpc, organic..."
            testId="input-utm-mediums"
          />
        </div>
      </div>
      
      <div className="space-y-2">
        <label className="text-sm font-medium">Countries (ISO codes)</label>
        <TagInput
          tags={targetCountries}
          setTags={setTargetCountries}
          placeholder="US, CA, MX..."
          testId="input-countries"
          transform={(v) => v.toUpperCase()}
        />
      </div>
    </div>
  );
}
