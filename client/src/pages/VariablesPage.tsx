import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  BookOpen,
  Braces,
  Check,
  ChevronDown,
  ChevronsUpDown,
  ExternalLink,
  Info,
  MapPin,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
} from "@/components/ui/tabs";
import {
  ToggleButtonBarList,
  ToggleButtonBarTrigger,
} from "@/components/ui/toggle-button-bar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import {
  useVariableDefinitions,
  useVariableContext,
} from "@/hooks/useVariables";
import {
  resolveVariable,
  type VariableDefinition,
} from "@/lib/variable-manager";
import {
  getListedLocations,
  getLocationBySlug,
  getRegionForLocation,
  getRegionLabel,
  REGION_SLUGS,
  type RegionSlug,
} from "@/lib/locations";
import { useContentTypes, getTypeFromFolder } from "@/hooks/useContentTypes";
import {
  isVariableOverridden,
  otherLocationDiffs,
  otherLocationDiffLocationCount,
} from "@/lib/variable-badges";
import { variableUsagePathToStaffHref } from "@/lib/variable-usage-href";
import { VariableDetailModal } from "@/components/editing/VariableDetailModal";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { Location } from "@shared/session";

type DashTab = "globals" | "brand" | "how";

function countryCodeToFlag(code: string): string {
  return code
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

function ColumnInfoHeader({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <th className="px-3 py-2 font-medium">
      <span className="inline-flex items-center gap-1">
        {label}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center h-4 w-4 rounded-sm text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`About ${label}`}
              data-testid={testId}
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-80 space-y-2 text-sm text-muted-foreground"
            align="start"
            side="top"
          >
            {children}
          </PopoverContent>
        </Popover>
      </span>
    </th>
  );
}

function MockLocationCombobox({
  value,
  onChange,
  locations,
  locale,
}: {
  value: string;
  onChange: (slug: string) => void;
  locations: Location[];
  locale: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? getLocationBySlug(value) : undefined;

  const byRegion = useMemo(() => {
    const map = new Map<string, Location[]>();
    for (const loc of locations) {
      const key = loc.region || "other";
      const list = map.get(key) || [];
      list.push(loc);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    const ordered: { region: string; locs: Location[] }[] = [];
    for (const region of REGION_SLUGS) {
      const locs = map.get(region);
      if (locs?.length) ordered.push({ region, locs });
      map.delete(region);
    }
    for (const [region, locs] of map) {
      if (locs.length) ordered.push({ region, locs });
    }
    return ordered;
  }, [locations]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-between font-normal"
          data-testid="select-mock-location"
        >
          {selected ? (
            <span className="flex items-center gap-2 truncate">
              <span aria-hidden="true">{countryCodeToFlag(selected.country_code)}</span>
              <span className="truncate">{selected.name}</span>
              <span className="text-muted-foreground truncate hidden sm:inline">
                · {selected.country}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">Choose location</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search location or country…"
            data-testid="input-search-mock-location"
          />
          <CommandList>
            <CommandEmpty>No location found.</CommandEmpty>
            {byRegion.map(({ region, locs }) => (
              <CommandGroup
                key={region}
                heading={getRegionLabel(region as RegionSlug, locale) || region}
              >
                {locs.map((loc) => (
                  <CommandItem
                    key={loc.slug}
                    value={`${loc.name} ${loc.country} ${loc.slug} ${loc.region}`}
                    onSelect={() => {
                      onChange(loc.slug);
                      setOpen(false);
                    }}
                    data-testid={`mock-location-option-${loc.slug}`}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        value === loc.slug ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span aria-hidden="true" className="mr-2">
                      {countryCodeToFlag(loc.country_code)}
                    </span>
                    <span className="flex-1 truncate">
                      {loc.name}
                      <span className="text-muted-foreground">, {loc.country}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function stripContentRootPrefix(filePath: string): string {
  return filePath.replace(/^site_[^/]+\//, "");
}

function UsagePopover({
  variableName,
  count,
  resolveContentType,
}: {
  variableName: string;
  count: number;
  resolveContentType: (directory: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery<{ variable: string; files: string[] }>({
    queryKey: ["/api/variables", variableName, "usage"],
    queryFn: async () => {
      const res = await fetch(`/api/variables/${encodeURIComponent(variableName)}/usage`);
      if (!res.ok) throw new Error("Failed to fetch usage");
      return res.json();
    },
    enabled: open,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-xs font-medium tabular-nums underline-offset-2 hover:underline text-foreground"
          data-testid={`button-usage-${variableName}`}
        >
          {count}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-2" align="end">
        <p className="text-sm font-medium">Used in {count} file{count !== 1 ? "s" : ""}</p>
        <p className="text-xs text-muted-foreground">
          Open each place, remove the variable reference, then you can delete it here.
        </p>
        {isLoading && (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
        {isError && (
          <p className="text-xs text-destructive">Could not load usage list.</p>
        )}
        {data?.files && data.files.length > 0 && (
          <ul className="max-h-64 overflow-y-auto space-y-0.5">
            {data.files.map((file) => {
              const href = variableUsagePathToStaffHref(file, resolveContentType);
              const displayPath = stripContentRootPrefix(file);
              return (
                <li
                  key={file}
                  className="flex items-center gap-1 min-h-0"
                >
                  <code className="flex-1 min-w-0 text-[10px] leading-4 font-mono truncate text-muted-foreground" title={file}>
                    {displayPath}
                  </code>
                  {href ? (
                    <button
                      type="button"
                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                      onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
                      aria-label={`Open ${displayPath}`}
                      data-testid={`button-open-usage-${file}`}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {data?.files && data.files.length === 0 && (
          <p className="text-xs text-muted-foreground">No indexed references (count may be stale).</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function VariablesPage() {
  const { toast } = useToast();
  const { data: definitions, isLoading: defsLoading } = useVariableDefinitions();
  const sessionContext = useVariableContext();
  const contentTypes = useContentTypes();

  const { data: usageSummary } = useQuery<{ counts: Record<string, number> }>({
    queryKey: ["/api/variables/usage-summary"],
    staleTime: 30_000,
  });

  const { data: localeSettings } = useQuery<{
    default_locale: string;
    supported_locales: { code: string; label: string }[];
  }>({
    queryKey: ["/api/settings/locales"],
    staleTime: Infinity,
  });

  const listedLocations = useMemo(() => getListedLocations(), []);
  const localeOptions = localeSettings?.supported_locales ?? [
    { code: "en", label: "English" },
    { code: "es", label: "Spanish" },
  ];

  const [mockLocation, setMockLocation] = useState(
    () => sessionContext.location || listedLocations[0]?.slug || "",
  );
  const [mockLocale, setMockLocale] = useState(
    () => sessionContext.locale || localeSettings?.default_locale || "en",
  );
  const [tab, setTab] = useState<DashTab>("globals");
  const [search, setSearch] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"inspect" | "create">("inspect");
  const [modalVarName, setModalVarName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const mockRegion = mockLocation ? getRegionForLocation(mockLocation) : null;
  const mockContext = useMemo(
    () => ({
      location: mockLocation || undefined,
      region: mockRegion || undefined,
      locale: mockLocale || undefined,
    }),
    [mockLocation, mockRegion, mockLocale],
  );

  const resolveContentType = useMemo(() => {
    return (directory: string) => {
      if (!contentTypes) return directory;
      return getTypeFromFolder(contentTypes, directory);
    };
  }, [contentTypes]);

  const counts = usageSummary?.counts ?? {};

  const { globals, brandRows, reservedRows } = useMemo(() => {
    const defs = definitions || {};
    const globalsList: { name: string; def: VariableDefinition }[] = [];
    const brand: { name: string; def: VariableDefinition }[] = [];
    const reserved: { name: string; def: VariableDefinition }[] = [];

    for (const [name, def] of Object.entries(defs)) {
      if (name.startsWith("brand.")) {
        brand.push({ name, def });
      } else if (name.startsWith("reserved.")) {
        reserved.push({ name, def });
      } else if (name.startsWith("global.") && !def.isReserved) {
        globalsList.push({ name, def });
      }
    }

    globalsList.sort((a, b) => a.name.localeCompare(b.name));
    brand.sort((a, b) => a.name.localeCompare(b.name));
    reserved.sort((a, b) => a.name.localeCompare(b.name));
    return { globals: globalsList, brandRows: brand, reservedRows: reserved };
  }, [definitions]);

  const filteredGlobals = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return globals;
    return globals.filter(({ name, def }) => {
      if (name.toLowerCase().includes(q)) return true;
      const resolved = definitions
        ? resolveVariable(name, definitions, mockContext)?.value
        : def.default;
      return (resolved || "").toLowerCase().includes(q);
    });
  }, [globals, search, definitions, mockContext]);

  const openCreate = () => {
    setModalMode("create");
    setModalVarName("");
    setModalOpen(true);
  };

  const openEdit = (name: string) => {
    setModalMode("inspect");
    setModalVarName(name);
    setModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest("DELETE", `/api/variables/${encodeURIComponent(deleteTarget)}`, {
        action: "delete_definition",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/variables"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/variables/usage-summary"] });
      toast({ title: "Variable deleted", description: `"${deleteTarget}" was removed.` });
      setDeleteTarget(null);
    } catch (err: any) {
      const msg = err?.message || "Failed to delete variable";
      toast({ title: "Could not delete", description: msg, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="icon" data-testid="link-back-home">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold flex items-center gap-2">
                  <Braces className="w-5 h-5" />
                  Variables
                </h1>
                <p className="text-sm text-muted-foreground">
                  {globals.length} global{globals.length !== 1 ? "s" : ""} · site-wide values
                </p>
              </div>
            </div>
            <Button onClick={openCreate} data-testid="button-create-variable" className="gap-1.5">
              <Plus className="h-4 w-4" />
              Create global
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 space-y-6 max-w-6xl">
        <div className="rounded-md border bg-muted/30 p-4 space-y-2" data-testid="section-variables-intro">
          <p className="text-sm text-foreground">
            Manage site-wide globals used in templates as{" "}
            <code className="font-mono text-xs">{"{{ global.* }}"}</code>. Preview how they
            resolve for a campus and language below. Brand and legal values are listed read-only —
            edit them in Settings. Entry, SEO, and URL variables work differently; see{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => setTab("how")}
            >
              How variables work
            </button>
            .
          </p>
        </div>

        <div
          className="rounded-lg border-2 border-primary/30 bg-card p-4 space-y-3"
          data-testid="section-mock-context"
        >
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">Preview as location &amp; locale</p>
              <p className="text-xs text-muted-foreground">
                Does not change your real session — only how values resolve on this page.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5 min-w-[220px] flex-1">
              <label className="text-xs font-medium text-muted-foreground">Location</label>
              <MockLocationCombobox
                value={mockLocation}
                onChange={setMockLocation}
                locations={listedLocations}
                locale={mockLocale}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Locale</label>
              <div className="flex gap-1" data-testid="toggle-mock-locale">
                {localeOptions.map((l) => (
                  <Button
                    key={l.code}
                    type="button"
                    size="sm"
                    variant={mockLocale === l.code ? "default" : "outline"}
                    onClick={() => setMockLocale(l.code)}
                    data-testid={`button-mock-locale-${l.code}`}
                  >
                    {l.code.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>
            {mockRegion && (
              <p className="text-xs text-muted-foreground pb-2">
                Region: {getRegionLabel(mockRegion, mockLocale)}{" "}
                <span className="font-mono">({mockRegion})</span>
              </p>
            )}
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as DashTab)}>
          <ToggleButtonBarList data-testid="tabs-variables">
            <ToggleButtonBarTrigger value="globals" data-testid="tab-globals">
              Globals
            </ToggleButtonBarTrigger>
            <ToggleButtonBarTrigger value="brand" data-testid="tab-brand-legal">
              Brand &amp; legal
            </ToggleButtonBarTrigger>
            <ToggleButtonBarTrigger value="how" data-testid="tab-how">
              How variables work
            </ToggleButtonBarTrigger>
          </ToggleButtonBarList>

          <TabsContent value="globals" className="mt-4 space-y-3">
            <div className="relative max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search name or value…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-variables"
              />
            </div>

            {defsLoading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading variables…</p>
            ) : filteredGlobals.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {search ? "No globals match your search." : "No global variables yet. Create one to get started."}
              </p>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-globals">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Resolved value</th>
                        <ColumnInfoHeader
                          label="Conditions"
                          testId="info-column-conditions"
                        >
                          <p className="font-medium text-foreground">Conditions</p>
                          <p>
                            How many location, region, or language overrides this
                            variable has beyond its default value.
                          </p>
                          <p>
                            Open the variable (edit) to add or reorder conditions.
                            The first matching rule for the preview location and
                            locale above wins; otherwise the default is used.
                          </p>
                        </ColumnInfoHeader>
                        <ColumnInfoHeader label="Uses" testId="info-column-uses">
                          <p className="font-medium text-foreground">Uses</p>
                          <p>
                            How many content files reference this variable (for
                            example{" "}
                            <code className="font-mono text-xs">
                              {"{{ global.name }}"}
                            </code>
                            ).
                          </p>
                          <p>
                            Click the number to see each file and open it in a new
                            window. You can only delete a variable when Uses is 0 —
                            remove every reference first.
                          </p>
                        </ColumnInfoHeader>
                        <th className="px-3 py-2 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGlobals.map(({ name, def }) => {
                        const resolution = definitions
                          ? resolveVariable(name, definitions, mockContext)
                          : null;
                        const resolvedValue = resolution?.value ?? def.default ?? "—";
                        const overridden =
                          !!definitions &&
                          isVariableOverridden(def, name, definitions, mockContext);
                        const diffs = otherLocationDiffs(def, String(resolvedValue));
                        const otherLocCount = otherLocationDiffLocationCount(
                          def,
                          String(resolvedValue),
                        );
                        const mockLoc = mockLocation
                          ? getLocationBySlug(mockLocation)
                          : undefined;
                        const usageCount = counts[name] ?? 0;
                        const canDelete = usageCount === 0;

                        return (
                          <tr
                            key={name}
                            className="border-b last:border-0 hover:bg-muted/20"
                            data-testid={`row-variable-${name}`}
                          >
                            <td className="px-3 py-2 align-top">
                              <code className="text-xs font-mono">{name}</code>
                            </td>
                            <td className="px-3 py-2 align-top max-w-[320px]">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="line-clamp-2 break-words">{resolvedValue}</span>
                                {overridden && mockLoc && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge
                                        variant="secondary"
                                        className="text-[10px] font-normal gap-1 max-w-full"
                                        data-testid={`badge-overridden-${name}`}
                                      >
                                        <span>
                                          Overridden in{" "}
                                          <span aria-hidden="true">
                                            {countryCodeToFlag(mockLoc.country_code)}
                                          </span>{" "}
                                          {mockLoc.name}
                                          {otherLocCount > 0
                                            ? ` and ${otherLocCount} other${otherLocCount !== 1 ? "s" : ""}`
                                            : ""}
                                        </span>
                                      </Badge>
                                    </TooltipTrigger>
                                    {diffs.length > 0 ? (
                                      <TooltipContent className="max-w-xs space-y-1">
                                        {diffs.slice(0, 8).map((d) => {
                                          const loc = getLocationBySlug(d.location);
                                          return (
                                            <p key={`${d.location}-${d.value}`} className="text-xs">
                                              {loc
                                                ? `${countryCodeToFlag(loc.country_code)} ${loc.name}`
                                                : d.location}
                                              : {d.value}
                                            </p>
                                          );
                                        })}
                                        {diffs.length > 8 && (
                                          <p className="text-xs text-muted-foreground">
                                            +{diffs.length - 8} more
                                          </p>
                                        )}
                                      </TooltipContent>
                                    ) : null}
                                  </Tooltip>
                                )}
                                {!overridden && otherLocCount > 0 && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] font-normal cursor-help"
                                        data-testid={`badge-other-locations-${name}`}
                                      >
                                        {otherLocCount} other location
                                        {otherLocCount !== 1 ? "s" : ""} differ
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs space-y-1">
                                      {diffs.slice(0, 8).map((d) => {
                                        const loc = getLocationBySlug(d.location);
                                        return (
                                          <p key={`${d.location}-${d.value}`} className="text-xs">
                                            {loc
                                              ? `${countryCodeToFlag(loc.country_code)} ${loc.name}`
                                              : d.location}
                                            : {d.value}
                                          </p>
                                        );
                                      })}
                                      {diffs.length > 8 && (
                                        <p className="text-xs text-muted-foreground">
                                          +{diffs.length - 8} more
                                        </p>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 align-top tabular-nums text-muted-foreground">
                              {def.conditions?.length ?? 0}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <UsagePopover
                                variableName={name}
                                count={usageCount}
                                resolveContentType={resolveContentType}
                              />
                            </td>
                            <td className="px-3 py-2 align-top">
                              <div className="flex justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => openEdit(name)}
                                  data-testid={`button-edit-${name}`}
                                  title="Edit"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                {canDelete ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive"
                                    onClick={() => setDeleteTarget(name)}
                                    data-testid={`button-delete-${name}`}
                                    title="Delete"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                ) : (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8"
                                          disabled
                                          data-testid={`button-delete-${name}`}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      Remove all references first (click the usage count).
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="brand" className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              These are protected. Edit them in Settings — changes here would risk conflicting
              editors.
            </p>
            <div className="rounded-md border divide-y">
              <div className="px-3 py-2 flex items-center justify-between bg-muted/30">
                <p className="text-sm font-medium">Brand</p>
                <Link href="/private/settings?tab=brand">
                  <Button variant="outline" size="sm" data-testid="link-settings-brand">
                    Open Brand settings
                  </Button>
                </Link>
              </div>
              {brandRows.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">No brand variables.</p>
              ) : (
                brandRows.map(({ name, def }) => {
                  const val = definitions
                    ? resolveVariable(name, definitions, mockContext)?.value ?? def.default
                    : def.default;
                  return (
                    <div key={name} className="px-3 py-2 flex flex-wrap gap-2 justify-between">
                      <code className="text-xs font-mono">{name}</code>
                      <span className="text-sm text-muted-foreground line-clamp-1 max-w-md">
                        {val || "—"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
            <div className="rounded-md border divide-y">
              <div className="px-3 py-2 flex items-center justify-between bg-muted/30">
                <p className="text-sm font-medium">Legal &amp; consent</p>
                <Link href="/private/settings?tab=legal">
                  <Button variant="outline" size="sm" data-testid="link-settings-legal">
                    Open Legal settings
                  </Button>
                </Link>
              </div>
              {reservedRows.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">No reserved variables.</p>
              ) : (
                reservedRows.map(({ name, def }) => {
                  const val = definitions
                    ? resolveVariable(name, definitions, mockContext)?.value ?? def.default
                    : def.default;
                  return (
                    <div key={name} className="px-3 py-2 flex flex-wrap gap-2 justify-between">
                      <code className="text-xs font-mono">{name}</code>
                      <span className="text-sm text-muted-foreground line-clamp-1 max-w-md">
                        {typeof val === "string" ? val || "—" : "—"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </TabsContent>

          <TabsContent value="how" className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  title: "Entry fields",
                  syntax: "{{ entry.title }}",
                  body: "Values from the current page or list row (Fields / field mapping). Prefer entry.* over legacy single.*.",
                },
                {
                  title: "SEO meta",
                  syntax: "{{ meta.page_title }}",
                  body: "From this page’s SEO head block (SEO Meta tab).",
                },
                {
                  title: "URL params",
                  syntax: "{{ param.category }}",
                  body: "From the URL path and query string (path wins on conflict).",
                },
                {
                  title: "Globals",
                  syntax: "{{ global.campus_phone }}",
                  body: "Site-wide values in this dashboard. Can vary by location, region, or locale.",
                },
                {
                  title: "Hiring rate",
                  syntax: "{{ global.global_job_placement_rate | 84 }}%",
                  body: "The sitewide hiring-rate claim for programs, locations, landings, and SEO. It can differ by region; changing it updates wired pages. Keep the token in SEO fields — the preview is not what gets saved.",
                },
                {
                  title: "Brand",
                  syntax: "{{ brand.logo }}",
                  body: "Site identity (title, logos). Edit in Settings → Brand.",
                },
              ].map((card) => (
                <div key={card.title} className="rounded-md border p-3 space-y-1.5">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    {card.title}
                  </p>
                  <code className="text-xs font-mono text-muted-foreground">{card.syntax}</code>
                  <p className="text-xs text-muted-foreground">{card.body}</p>
                </div>
              ))}
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
                Pipe fallbacks
              </p>
              <p className="text-xs text-muted-foreground">
                Use{" "}
                <code className="font-mono">{"{{ entry.title | Fallback text }}"}</code> when the
                field might be empty — the text after{" "}
                <code className="font-mono">|</code> is shown instead.
              </p>
              <p className="text-xs text-muted-foreground">
                Delivery order: entry → meta → param; site vars (brand / global) resolve in the
                page renderer (and for menus / SEO consumers).
              </p>
            </div>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5" data-testid="button-advanced-variables">
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                  />
                  Read more (advanced)
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                <p>
                  Stored in <code className="font-mono">variables.yml</code> under the site content
                  root. <code className="font-mono">reserved.*</code> keys (legal URLs, consent) are
                  aliased into <code className="font-mono">global.*</code> at load time so templates
                  can use either shape for those values.
                </p>
                <p>
                  Conditions match the visitor session (location → region → locale) in order; first
                  match wins. Unused globals can be deleted here; used ones must be cleared from
                  content first (usage index includes dotted names like{" "}
                  <code className="font-mono">global.*</code>).
                </p>
                <p>
                  <code className="font-mono">global.global_job_placement_rate</code> defaults to{" "}
                  <code className="font-mono">84</code> (usa-canada), with region overrides europe{" "}
                  <code className="font-mono">75</code> and latam <code className="font-mono">81</code>.
                  Prefer{" "}
                  <code className="font-mono">
                    {"{{ global.global_job_placement_rate | 84 }}%"}
                  </code>{" "}
                  (number-only pipe default). Do not hardcode those percentages for the sitewide claim.
                  Historical Outcomes year charts, press cohort stats, and cohort FAQ stay literal.
                </p>
                <p>
                  Menu YAML is not part of the usage index yet — references there may not appear in
                  the uses count.
                </p>
              </CollapsibleContent>
            </Collapsible>
          </TabsContent>
        </Tabs>
      </div>

      <VariableDetailModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        variableName={modalVarName}
        inlineDefault=""
        mode={modalMode}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/variables"] });
          queryClient.invalidateQueries({ queryKey: ["/api/variables/usage-summary"] });
        }}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete variable?</DialogTitle>
            <DialogDescription>
              This removes <code className="font-mono">{deleteTarget}</code> from{" "}
              <code className="font-mono">variables.yml</code>. It is unused in indexed content.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
              data-testid="button-confirm-delete-variable"
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
