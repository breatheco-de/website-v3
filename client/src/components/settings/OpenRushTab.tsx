import { useDebugAuth } from "@/hooks/useDebugAuth";
import { SearchConsoleOpenRushCard } from "@/components/settings/SearchConsoleOpenRushCard";

export function OpenRushTab() {
  const { hasCapability } = useDebugAuth();
  const canEdit = hasCapability("seo_settings");

  return (
    <div className="space-y-4" data-testid="tab-panel-openrush">
      <SearchConsoleOpenRushCard canEdit={canEdit} />
    </div>
  );
}
