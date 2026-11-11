import { useDebugAuth } from "@/hooks/useDebugAuth";
import { DataForSeoCard } from "@/components/settings/DataForSeoCard";

export function DataForSeoTab() {
  const { hasCapability } = useDebugAuth();
  const canEdit = hasCapability("seo_settings");

  return (
    <div className="space-y-4" data-testid="tab-panel-dataforseo">
      <DataForSeoCard canEdit={canEdit} />
    </div>
  );
}
