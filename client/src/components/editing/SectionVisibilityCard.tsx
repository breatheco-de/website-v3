import { useMemo, useState } from "react";
import { Eye, Laptop, MapPin, Monitor, Smartphone } from "lucide-react";
import { IconPencil, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { useLocationCatalog } from "@/hooks/useLocationCatalog";
import { cn } from "@/lib/utils";

function countryCodeToFlag(code: string): string {
  return code
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

function ShowOnPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const options = [
    { id: "all", label: "Both", icon: Laptop },
    { id: "desktop", label: "Desktop", icon: Monitor },
    { id: "mobile", label: "Mobile", icon: Smartphone },
  ];
  const currentValue = value || "all";

  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-sm font-medium whitespace-nowrap">Show on</Label>
      <div className="flex rounded-md border border-border overflow-hidden">
        {options.map((option) => {
          const Icon = option.icon;
          const isSelected = currentValue === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id === "all" ? "" : option.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-muted",
                option.id !== "all" ? "border-l border-border" : "",
              )}
              data-testid={`props-showon-${option.id}`}
            >
              <Icon className="h-4 w-4" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ShowOnLocationsPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const { data: allLocations = [] } = useLocationCatalog();
  const options = allLocations
    .filter((loc) => loc.visibility === "listed")
    .map((loc) => ({
      value: loc.slug,
      label: `${loc.name}, ${loc.country}`,
      group: loc.region,
      prefix: (
        <span className="text-base leading-none">
          {countryCodeToFlag(loc.country_code)}
        </span>
      ),
      badgeLabel: loc.name,
      searchTerms: [loc.slug, loc.country],
    }));

  return (
    <SearchableMultiSelect
      options={options}
      value={value}
      onChange={onChange}
      label={
        <>
          <MapPin className="h-3.5 w-3.5" />
          Show on locations
        </>
      }
      searchPlaceholder="Search locations..."
      groupLabels={{
        "usa-canada": "USA & Canada",
        latam: "Latin America",
        europe: "Europe",
        online: "Online",
      }}
      testIdPrefix="location"
      emptyMessage="No locations found"
    />
  );
}

function deviceSummary(showOn: string): string {
  if (showOn === "desktop") return "Desktop";
  if (showOn === "mobile") return "Mobile";
  return "Desktop & mobile";
}

function locationsSummary(slugs: string[], allLocations: { slug: string; name: string }[]): string {
  if (!slugs.length) return "All locations";
  if (slugs.length === 1) {
    const loc = allLocations.find((l) => l.slug === slugs[0]);
    return loc?.name || slugs[0];
  }
  return `${slugs.length} locations`;
}

export function SectionVisibilityCard({
  showOn,
  showOnLocations,
  onShowOnChange,
  onShowOnLocationsChange,
}: {
  showOn: string;
  showOnLocations: string[];
  onShowOnChange: (value: string) => void;
  onShowOnLocationsChange: (value: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const { data: allLocations = [] } = useLocationCatalog();

  const summary = useMemo(() => {
    return [deviceSummary(showOn), locationsSummary(showOnLocations, allLocations)].join(" · ");
  }, [showOn, showOnLocations, allLocations]);

  return (
    <div
      className="rounded-md border border-input bg-background"
      data-testid="card-section-visibility"
    >
      <div className="flex items-center justify-between gap-2 border-b border-input bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">Visibility</span>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6 flex-shrink-0"
          onClick={() => setEditing((v) => !v)}
          data-testid="button-edit-section-visibility"
          aria-label={editing ? "Done editing visibility" : "Edit visibility"}
        >
          {editing ? <IconX className="h-3.5 w-3.5" /> : <IconPencil className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="px-3 py-3 space-y-3">
        {!editing ? (
          <p className="text-xs text-muted-foreground" data-testid="text-visibility-summary">
            {summary}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Who sees this section on the live site: by device and by campus.
            </p>
            <ShowOnPicker value={showOn} onChange={onShowOnChange} />
            <ShowOnLocationsPicker value={showOnLocations} onChange={onShowOnLocationsChange} />
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">Read more (advanced)</summary>
              <p className="mt-1 leading-snug">
                YAML: <code className="text-[10px]">showOn</code>,{" "}
                <code className="text-[10px]">showOnLocations</code>.
              </p>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
