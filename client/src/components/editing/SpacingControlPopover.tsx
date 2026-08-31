import { useState } from "react";
import { ArrowDown, ArrowUp, Info, Monitor, Smartphone } from "lucide-react";
import { AlignVerticalSpaceAround } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import { emitContentUpdated } from "@/lib/contentEvents";
import type { Section, SectionLayout, ResponsiveSpacing } from "@shared/schema";

interface SpacingControlPopoverProps {
  insertIndex: number;
  sections: Section[];
  contentType?: string;
  slug?: string;
  locale?: string;
  variant?: string;
  version?: number;
}

const SPACING_PRESETS = [
  { label: "None", value: "none" },
  { label: "S", value: "sm" },
  { label: "M", value: "md" },
  { label: "L", value: "lg" },
  { label: "XL", value: "xl" },
];

type Breakpoint = "mobile" | "desktop";

// Mobile values can be undefined (inherits from desktop) or explicitly set
interface ResponsiveSpacingValues {
  mobile: { top: string | undefined; bottom: string | undefined };
  desktop: { top: string; bottom: string };
}

async function updateSectionField(
  contentType: string,
  slug: string,
  locale: string,
  sectionIndex: number,
  field: string,
  value: ResponsiveSpacing,
  variant?: string,
  version?: number,
  layoutTarget?: "entry" | "type_single" | "type_template"
): Promise<{ success: boolean; error?: string }> {
  const token = getDebugToken();
  const author = await resolveAuthorName();
  const response = await fetch("/api/content/edit-sections", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
    body: JSON.stringify({
      contentType,
      slug,
      locale,
      author,
      ...(variant ? { variant } : {}),
      ...(version !== undefined ? { version } : {}),
      ...(layoutTarget ? { layoutTarget } : {}),
      operations: [
        {
          action: "update_field",
          path: `sections.${sectionIndex}.${field}`,
          value,
        },
      ],
    }),
  });
  return response.json();
}

function parseTopBottom(value: string | undefined): { top: string; bottom: string } {
  if (!value) return { top: "none", bottom: "none" };
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1) {
    return { top: parts[0], bottom: parts[0] };
  }
  return { top: parts[0], bottom: parts[1] };
}

function combineTopBottom(top: string, bottom: string): string {
  const t = top || "none";
  const b = bottom || "none";
  if (t === b) return t;
  return `${t} ${b}`;
}

function parseResponsiveSpacing(value: ResponsiveSpacing | undefined): ResponsiveSpacingValues {
  if (!value) {
    return {
      mobile: { top: undefined, bottom: undefined },
      desktop: { top: "none", bottom: "none" },
    };
  }
  
  // Desktop is always required, fallback to "none"
  const desktopValue = value.desktop ?? value.mobile ?? "none";
  const desktopParsed = parseTopBottom(desktopValue);
  
  // Mobile: keep as undefined if not explicitly set in YAML
  // This tracks whether it was explicitly set or inheriting
  if (value.mobile === undefined) {
    return {
      mobile: { top: undefined, bottom: undefined },
      desktop: desktopParsed,
    };
  }
  
  const mobileParsed = parseTopBottom(value.mobile);
  return {
    mobile: { top: mobileParsed.top, bottom: mobileParsed.bottom },
    desktop: desktopParsed,
  };
}

function parseSpacingValue(section: Section | undefined): {
  padding: ResponsiveSpacingValues;
  margin: ResponsiveSpacingValues;
} {
  if (!section) {
    return {
      padding: { mobile: { top: undefined, bottom: undefined }, desktop: { top: "none", bottom: "none" } },
      margin: { mobile: { top: undefined, bottom: undefined }, desktop: { top: "none", bottom: "none" } },
    };
  }
  const layout = section as SectionLayout;
  return {
    padding: parseResponsiveSpacing(layout.paddingY),
    margin: parseResponsiveSpacing(layout.marginY),
  };
}

// Get the effective value for a position (uses desktop if mobile is undefined)
function getEffectiveValue(values: ResponsiveSpacingValues, breakpoint: Breakpoint, position: "top" | "bottom"): string {
  if (breakpoint === "mobile") {
    return values.mobile[position] ?? values.desktop[position];
  }
  return values.desktop[position];
}

// Check if mobile is inheriting (undefined) for a position
function isMobileInheriting(values: ResponsiveSpacingValues, position: "top" | "bottom"): boolean {
  return values.mobile[position] === undefined;
}

function SpacingPresetButtons({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const isCustom = value && !SPACING_PRESETS.some((p) => p.value === value);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1">
        {SPACING_PRESETS.map((preset) => (
          <Button
            key={preset.value}
            variant={value === preset.value ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onChange(preset.value)}
            data-testid={`spacing-preset-${label.toLowerCase().replace(/\s/g, "-")}-${preset.value}`}
          >
            {preset.label}
          </Button>
        ))}
        <Input
          type="text"
          placeholder="Custom"
          value={isCustom ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-16 text-xs px-2"
          data-testid={`spacing-custom-${label.toLowerCase().replace(/\s/g, "-")}`}
        />
      </div>
    </div>
  );
}

function BreakpointToggle({
  activeBreakpoint,
  onChange,
}: {
  activeBreakpoint: Breakpoint;
  onChange: (breakpoint: Breakpoint) => void;
}) {
  return (
    <div className="flex rounded-md overflow-hidden border">
      <button
        onClick={() => onChange("mobile")}
        className={`flex items-center justify-center p-2 transition-colors ${
          activeBreakpoint === "mobile"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/80"
        }`}
        data-testid="toggle-breakpoint-mobile"
      >
        <Smartphone className="h-4 w-4" />
      </button>
      <button
        onClick={() => onChange("desktop")}
        className={`flex items-center justify-center p-2 transition-colors ${
          activeBreakpoint === "desktop"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/80"
        }`}
        data-testid="toggle-breakpoint-desktop"
      >
        <Monitor className="h-4 w-4" />
      </button>
    </div>
  );
}


export function SpacingControlPopover({
  insertIndex,
  sections,
  contentType,
  slug,
  locale,
  variant,
  version,
}: SpacingControlPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeBreakpoint, setActiveBreakpoint] = useState<Breakpoint>("desktop");
  const { toast } = useToast();

  const aboveIndex = insertIndex - 1;
  const belowIndex = insertIndex;
  const sectionAbove = aboveIndex >= 0 ? sections[aboveIndex] : undefined;
  const sectionBelow = belowIndex < sections.length ? sections[belowIndex] : undefined;

  const aboveInitial = parseSpacingValue(sectionAbove);
  const belowInitial = parseSpacingValue(sectionBelow);

  const [abovePadding, setAbovePadding] = useState<ResponsiveSpacingValues>(aboveInitial.padding);
  const [aboveMargin, setAboveMargin] = useState<ResponsiveSpacingValues>(aboveInitial.margin);
  const [belowPadding, setBelowPadding] = useState<ResponsiveSpacingValues>(belowInitial.padding);
  const [belowMargin, setBelowMargin] = useState<ResponsiveSpacingValues>(belowInitial.margin);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      const above = parseSpacingValue(sectionAbove);
      const below = parseSpacingValue(sectionBelow);
      setAbovePadding(above.padding);
      setAboveMargin(above.margin);
      setBelowPadding(below.padding);
      setBelowMargin(below.margin);
    }
  };

  // Update a spacing value
  // - Editing desktop: keeps mobile undefined (inheriting) - no explicit sync needed
  // - Editing mobile: sets mobile to explicit value (breaks inheritance)
  const updateResponsiveValue = (
    setter: React.Dispatch<React.SetStateAction<ResponsiveSpacingValues>>,
    breakpoint: Breakpoint,
    position: "top" | "bottom",
    value: string
  ) => {
    setter(prev => {
      if (breakpoint === "desktop") {
        // Only update desktop - mobile stays undefined (inheriting) or keeps its explicit value
        return {
          ...prev,
          desktop: { ...prev.desktop, [position]: value },
        };
      }
      // Editing mobile: set explicit value (breaks inheritance)
      return {
        ...prev,
        mobile: { ...prev.mobile, [position]: value },
      };
    });
  };

  // Convert to ResponsiveSpacing for saving
  // Only include mobile if it was explicitly set (not undefined)
  const toResponsiveSpacing = (values: ResponsiveSpacingValues): ResponsiveSpacing => {
    const desktopStr = combineTopBottom(values.desktop.top, values.desktop.bottom);
    
    // If mobile values are all undefined, only save desktop
    if (values.mobile.top === undefined && values.mobile.bottom === undefined) {
      return { desktop: desktopStr };
    }
    
    // If any mobile value is set, save both (use desktop as fallback for undefined positions)
    const mobileTop = values.mobile.top ?? values.desktop.top;
    const mobileBottom = values.mobile.bottom ?? values.desktop.bottom;
    const mobileStr = combineTopBottom(mobileTop, mobileBottom);
    
    return {
      mobile: mobileStr,
      desktop: desktopStr,
    };
  };

  const hasChanged = (original: ResponsiveSpacingValues, current: ResponsiveSpacingValues): boolean => {
    return (
      original.mobile.top !== current.mobile.top ||
      original.mobile.bottom !== current.mobile.bottom ||
      original.desktop.top !== current.desktop.top ||
      original.desktop.bottom !== current.desktop.bottom
    );
  };

  const handleApply = async () => {
    if (!contentType || !slug || !locale) return;

    setIsSaving(true);
    const operations: Promise<{ success: boolean; error?: string }>[] = [];

    const spacingLayoutTarget = variant ? "type_template" : undefined;

    if (sectionAbove) {
      const originalAbove = parseSpacingValue(sectionAbove);
      if (hasChanged(originalAbove.padding, abovePadding)) {
        operations.push(updateSectionField(contentType, slug, locale, aboveIndex, "paddingY", toResponsiveSpacing(abovePadding), variant, version, spacingLayoutTarget));
      }
      if (hasChanged(originalAbove.margin, aboveMargin)) {
        operations.push(updateSectionField(contentType, slug, locale, aboveIndex, "marginY", toResponsiveSpacing(aboveMargin), variant, version, spacingLayoutTarget));
      }
    }

    if (sectionBelow) {
      const originalBelow = parseSpacingValue(sectionBelow);
      if (hasChanged(originalBelow.padding, belowPadding)) {
        operations.push(updateSectionField(contentType, slug, locale, belowIndex, "paddingY", toResponsiveSpacing(belowPadding), variant, version, spacingLayoutTarget));
      }
      if (hasChanged(originalBelow.margin, belowMargin)) {
        operations.push(updateSectionField(contentType, slug, locale, belowIndex, "marginY", toResponsiveSpacing(belowMargin), variant, version, spacingLayoutTarget));
      }
    }

    try {
      const results = await Promise.all(operations);
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        toast({
          title: "Failed to update spacing",
          description: failed[0].error,
          variant: "destructive",
        });
      } else if (operations.length > 0) {
        toast({ title: "Spacing updated" });
        emitContentUpdated({ contentType, slug, locale });
      }
      setIsOpen(false);
    } catch (error) {
      toast({
        title: "Error updating spacing",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!sectionAbove && !sectionBelow) {
    return null;
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-primary text-primary bg-background shadow-sm hover:bg-primary/10 hover:px-4 hover:py-2 hover:gap-2 transition-all duration-200"
          data-testid={`button-spacing-${insertIndex}`}
        >
          <AlignVerticalSpaceAround className="h-4 w-4" />
          <span className="text-xs font-medium">Spacing</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="center">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Adjust Spacing</h4>
            <div className="flex items-center gap-2">
              <BreakpointToggle
                activeBreakpoint={activeBreakpoint}
                onChange={setActiveBreakpoint}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  <p className="mb-1"><strong>Padding:</strong> Adds space inside the section (may break full-bleed backgrounds)</p>
                  <p className="mb-1"><strong>Margin:</strong> Adds space outside the section (preserves backgrounds)</p>
                  <p><strong>Breakpoint:</strong> Mobile applies below 768px, Desktop at 768px+</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {sectionAbove && (
            <div className="space-y-3 p-3 rounded-lg bg-muted/50 border">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ArrowUp className="h-3.5 w-3.5" />
                <span>Section Above ({sectionAbove.type})</span>
              </div>
              <SpacingPresetButtons
                label="Padding Bottom"
                value={getEffectiveValue(abovePadding, activeBreakpoint, "bottom")}
                onChange={(val) => updateResponsiveValue(setAbovePadding, activeBreakpoint, "bottom", val)}
              />
              <SpacingPresetButtons
                label="Margin Bottom"
                value={getEffectiveValue(aboveMargin, activeBreakpoint, "bottom")}
                onChange={(val) => updateResponsiveValue(setAboveMargin, activeBreakpoint, "bottom", val)}
              />
            </div>
          )}

          {sectionBelow && (
            <div className="space-y-3 p-3 rounded-lg bg-muted/50 border">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ArrowDown className="h-3.5 w-3.5" />
                <span>Section Below ({sectionBelow.type})</span>
              </div>
              <SpacingPresetButtons
                label="Padding Top"
                value={getEffectiveValue(belowPadding, activeBreakpoint, "top")}
                onChange={(val) => updateResponsiveValue(setBelowPadding, activeBreakpoint, "top", val)}
              />
              <SpacingPresetButtons
                label="Margin Top"
                value={getEffectiveValue(belowMargin, activeBreakpoint, "top")}
                onChange={(val) => updateResponsiveValue(setBelowMargin, activeBreakpoint, "top", val)}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={isSaving}
              data-testid={`button-apply-spacing-${insertIndex}`}
            >
              {isSaving ? "Saving..." : "Apply"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
