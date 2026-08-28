import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiFetch } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ToggleButtonBarList, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { RefreshCw, BarChart2, ArrowUp, ArrowDown, ArrowUpDown, X } from "lucide-react";
import type { ComponentInsightsData, ComponentPairing, ComponentSequence } from "@shared/schema";
import ComponentGraph from "@/components/ComponentGraph";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { MetricsAccessGate } from "@/components/MetricsAccessGate";

type SortKey = "from" | "to" | "count" | "frequency" | "pmi" | "distance";
type SortDir = "asc" | "desc";

const PMI_TOOLTIP = "PMI (Pointwise Mutual Information) — measures how much more often two components appear adjacent than would happen by chance. Positive = meaningful co-occurrence; near 0 = coincidental; negative = actively avoided.";
const DISTANCE_TOOLTIP = "Distance — 1 / max(PMI, ε). Lower values mean a stronger, more predictable relationship between the two components.";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="inline ml-1 opacity-40" size={12} />;
  return sortDir === "asc"
    ? <ArrowUp className="inline ml-1" size={12} />
    : <ArrowDown className="inline ml-1" size={12} />;
}

function ColInfoPopover({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          className="border-b border-dashed border-muted-foreground/50 cursor-help"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {label}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={6}
        className="max-w-xs text-xs leading-relaxed p-3"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {text}
      </PopoverContent>
    </Popover>
  );
}

function PairingsTable({
  pairings,
  filterNode,
}: {
  pairings: ComponentPairing[];
  filterNode?: string | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = (() => {
    if (!filterNode) return pairings;
    return pairings.filter((p) => p.from === filterNode || p.to === filterNode);
  })();

  const sorted = (() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey] as string | number;
      const bv = b[sortKey] as string | number;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return arr;
  })();

  function toggle(col: SortKey) {
    if (col === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("desc");
    }
  }

  const cols: { key: SortKey; label: string; tooltip?: string }[] = [
    { key: "from", label: "From" },
    { key: "to", label: "To" },
    { key: "count", label: "Count" },
    { key: "frequency", label: "Frequency" },
    { key: "pmi", label: "PMI", tooltip: PMI_TOOLTIP },
    { key: "distance", label: "Distance", tooltip: DISTANCE_TOOLTIP },
  ];

  if (pairings.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No pairings found.</p>;
  }

  if (sorted.length === 0 && filterNode) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No pairings found for <span className="font-mono">{filterNode}</span>.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            {cols.map((col) => (
              <th
                key={col.key}
                className="px-3 py-2 text-left font-medium cursor-pointer select-none whitespace-nowrap"
                onClick={() => toggle(col.key)}
                data-testid={`th-${col.key}`}
              >
                {col.tooltip ? (
                  <ColInfoPopover label={col.label} text={col.tooltip} />
                ) : (
                  col.label
                )}
                <SortIcon col={col.key} sortKey={sortKey} sortDir={sortDir} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr
              key={`${p.from}-${p.to}-${i}`}
              className="border-b last:border-0 hover:bg-muted/30 transition-colors"
            >
              <td className="px-3 py-2 font-mono text-xs">{p.from}</td>
              <td className="px-3 py-2 font-mono text-xs">{p.to}</td>
              <td className="px-3 py-2 tabular-nums">{p.count}</td>
              <td className="px-3 py-2 tabular-nums">{(p.frequency * 100).toFixed(1)}%</td>
              <td className="px-3 py-2 tabular-nums">
                <span className={p.pmi > 0.5 ? "text-green-700 dark:text-green-400" : p.pmi < 0 ? "text-destructive" : ""}>
                  {p.pmi.toFixed(3)}
                </span>
              </td>
              <td className="px-3 py-2 tabular-nums">{p.distance.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SequencesList({ sequences }: { sequences: ComponentSequence[] }) {
  if (sequences.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No sequences found.</p>;
  }
  return (
    <ol className="space-y-2">
      {sequences.map((s, i) => (
        <li key={i} className="flex items-start gap-3 rounded-md border px-3 py-2 bg-muted/20">
          <span className="text-xs font-bold text-muted-foreground w-5 shrink-0 pt-0.5">{i + 1}.</span>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-1">
              {s.sequence.map((comp, j) => (
                <span key={j} className="flex items-center gap-1">
                  <Badge variant="secondary" className="font-mono text-xs">{comp}</Badge>
                  {j < s.sequence.length - 1 && (
                    <span className="text-muted-foreground text-xs">→</span>
                  )}
                </span>
              ))}
            </div>
          </div>
          <span className="text-xs text-muted-foreground shrink-0 pt-0.5">{s.count}×</span>
        </li>
      ))}
    </ol>
  );
}

function SuggestPanel({ data }: { data: ComponentInsightsData }) {
  const [afterType, setAfterType] = useState<string>("");
  const [intent, setIntent] = useState<string>("__global__");
  const [rankBy, setRankBy] = useState<"frequency" | "pmi">("frequency");

  const allComponentTypes = (() => {
    const types = new Set<string>();
    for (const p of data.global.pairings) {
      types.add(p.from);
      types.add(p.to);
    }
    return Array.from(types).sort();
  })();

  const suggestions = useQuery<ComponentPairing[]>({
    queryKey: ["/api/private/component-insights/suggest", afterType, intent, rankBy],
    enabled: !!afterType,
    queryFn: async () => {
      const params = new URLSearchParams({ after: afterType, rankBy });
      if (intent && intent !== "__global__") params.set("intent", intent);
      const res = await apiFetch(`/api/private/component-insights/suggest?${params}`);
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json() as Promise<ComponentPairing[]>;
    },
  });

  const intentOptions = [
    { value: "__global__", label: "Global (all intents)" },
    ...data.meta.intents.map((id) => ({ value: id, label: id })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Component after</label>
          <Select value={afterType} onValueChange={setAfterType}>
            <SelectTrigger className="w-48" data-testid="select-after-type">
              <SelectValue placeholder="Pick a component…" />
            </SelectTrigger>
            <SelectContent>
              {allComponentTypes.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Intent filter</label>
          <Select value={intent} onValueChange={setIntent}>
            <SelectTrigger className="w-44" data-testid="select-intent-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {intentOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Rank by</label>
          <Select value={rankBy} onValueChange={(v) => setRankBy(v as "frequency" | "pmi")}>
            <SelectTrigger className="w-36" data-testid="select-rank-by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="frequency">Frequency</SelectItem>
              <SelectItem value="pmi">PMI</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {afterType && (
        <div>
          {suggestions.isLoading && (
            <p className="text-sm text-muted-foreground">Loading suggestions…</p>
          )}
          {suggestions.data && suggestions.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No suggestions found for <span className="font-mono">{afterType}</span>.</p>
          )}
          {suggestions.data && suggestions.data.length > 0 && (
            <PairingsTable pairings={suggestions.data} />
          )}
        </div>
      )}

      {!afterType && (
        <p className="text-sm text-muted-foreground">Select a component type to see what typically comes next.</p>
      )}
    </div>
  );
}

function GraphLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="inline-block rounded-full bg-primary w-2.5 h-2.5 opacity-40" />
        <span className="inline-block rounded-full bg-primary w-4 h-4 opacity-90 -ml-2" />
        Node size = degree
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-px w-4 bg-muted-foreground opacity-60" />
        <span className="inline-block h-0.5 w-6 bg-muted-foreground opacity-80" />
        Edge thickness = frequency
      </span>
      <span className="text-muted-foreground/60">Edges sorted by PMI — strongest pairs shown first. Click a node to filter the table below.</span>
    </div>
  );
}

export default function ComponentInsightsPage() {
  return (
    <MetricsAccessGate>
      <ComponentInsightsPageInner />
    </MetricsAccessGate>
  );
}

function ComponentInsightsPageInner() {
  const queryClient = useQueryClient();
  const { canMutateMetrics } = useDebugAuth();

  const { data, isLoading, isError } = useQuery<ComponentInsightsData>({
    queryKey: ["/api/private/component-insights"],
  });

  const rebuild = useMutation({
    mutationFn: () => apiRequest("POST", "/api/private/component-insights/rebuild"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/private/component-insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/private/component-insights/suggest"] });
    },
  });

  const allIntents = data ? ["__global__", ...data.meta.intents] : ["__global__"];
  const [activeTab, setActiveTab] = useState("__global__");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSelectedNode(null);
  };

  const handleNodeClick = (componentName: string | null) => {
    setSelectedNode(componentName);
  };

  const getCluster = (tab: string) => {
    if (!data) return null;
    if (tab === "__global__") return data.global;
    return data.byIntent[tab] ?? null;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-6 text-center space-y-4">
        <BarChart2 size={48} className="mx-auto text-muted-foreground" />
        <h1 className="text-2xl font-bold">Component Insights</h1>
        <p className="text-muted-foreground">
          {canMutateMetrics
            ? "No insights data yet. Run the first scan to analyse component co-occurrence patterns across all page YAML files."
            : "No insights data yet. Ask a Webmaster (or staff with edit access) to run the first scan."}
        </p>
        {canMutateMetrics && (
        <Button
          onClick={() => rebuild.mutate()}
          disabled={rebuild.isPending}
          data-testid="button-run-first-scan"
        >
          {rebuild.isPending && <RefreshCw className="animate-spin mr-2" size={16} />}
          Run first scan
        </Button>
        )}
        {rebuild.isError && (
          <p className="text-sm text-destructive">Scan failed. Check server logs.</p>
        )}
      </div>
    );
  }

  const cluster = getCluster(activeTab);

  return (
    <div className="max-w-5xl mx-auto py-8 px-6 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart2 size={24} />
            Component Insights
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Last generated: <span className="font-mono">{new Date(data.generatedAt).toLocaleString()}</span>
          </p>
        </div>
        {canMutateMetrics && (
        <Button
          onClick={() => rebuild.mutate()}
          disabled={rebuild.isPending}
          variant="outline"
          data-testid="button-rebuild"
        >
          {rebuild.isPending
            ? <><RefreshCw className="animate-spin mr-2" size={16} />Rebuilding…</>
            : <><RefreshCw className="mr-2" size={16} />Rebuild</>
          }
        </Button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pages scanned</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold">{data.meta.totalPagesScanned}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total weight</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold">{data.meta.totalWeight}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Weighted pages</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold">{data.meta.weightedPagesCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Intent clusters</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold">{data.meta.intents.length}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <ToggleButtonBarList>
          <Popover>
            <PopoverTrigger asChild>
              <ToggleButtonBarTrigger value="__global__" data-testid="tab-global">
                Global
                <Badge
                  variant="secondary"
                  className={`ml-1.5 text-xs px-1.5 py-0 ${activeTab === "__global__" ? "bg-primary-foreground text-primary" : ""}`}
                >
                  {data.global.pageCount}
                </Badge>
              </ToggleButtonBarTrigger>
            </PopoverTrigger>
            <PopoverContent side="bottom" sideOffset={6} className="max-w-xs text-xs leading-relaxed p-3">
              All pages combined, regardless of intent.
            </PopoverContent>
          </Popover>
          {data.meta.intents.map((intentId) => {
            const intentDef = data.meta.pageIntents?.find((pi) => pi.id === intentId);
            const pageCount = data.byIntent[intentId]?.pageCount ?? 0;
            const isActive = activeTab === intentId;
            return (
              <Popover key={intentId}>
                <PopoverTrigger asChild>
                  <ToggleButtonBarTrigger value={intentId} data-testid={`tab-${intentId}`}>
                    {intentId}
                    <Badge
                      variant="secondary"
                      className={`ml-1.5 text-xs px-1.5 py-0 ${isActive ? "bg-primary-foreground text-primary" : ""}`}
                    >
                      {pageCount}
                    </Badge>
                  </ToggleButtonBarTrigger>
                </PopoverTrigger>
                {intentDef && (
                  <PopoverContent side="bottom" sideOffset={6} className="max-w-xs text-xs leading-relaxed p-3">
                    {intentDef.what_for}
                  </PopoverContent>
                )}
              </Popover>
            );
          })}
        </ToggleButtonBarList>

        {allIntents.map((tab) => {
          const tabCluster = getCluster(tab);
          return (
            <TabsContent key={tab} value={tab} className="space-y-8 mt-6">
              {tabCluster && (
                <>
                  <section>
                    <h2 className="text-lg font-semibold mb-3">Relationship Graph</h2>
                    <Card>
                      <CardContent className="pt-4 pb-2 px-3">
                        <ComponentGraph
                          pairings={tabCluster.pairings}
                          onNodeClick={handleNodeClick}
                          selectedNode={tab === activeTab ? selectedNode : null}
                        />
                        <div className="mt-3 mb-1">
                          <GraphLegend />
                        </div>
                      </CardContent>
                    </Card>
                  </section>

                  {tab === activeTab && selectedNode && (
                    <section data-testid="section-selected-usage">
                      <h2 className="text-lg font-semibold mb-3">Usage for {selectedNode}</h2>
                      <Card>
                        <CardContent className="pt-4 space-y-3 text-sm">
                          {(() => {
                            const usage =
                              tabCluster.usageByType?.[selectedNode] ??
                              data.global.usageByType?.[selectedNode];
                            if (!usage) {
                              return (
                                <p className="text-muted-foreground">
                                  No usage recorded for this component in the insights cache.
                                </p>
                              );
                            }
                            return (
                              <>
                                <p>
                                  <span className="font-medium">{usage.totalUses}</span> uses across{" "}
                                  <span className="font-medium">{usage.pageCount}</span> pages
                                </p>
                                {usage.byContentType.length > 0 && (
                                  <div>
                                    <h4 className="text-xs font-medium text-muted-foreground mb-2">
                                      Content types
                                    </h4>
                                    <div className="flex flex-wrap gap-1.5">
                                      {usage.byContentType.map((ct) => (
                                        <Badge
                                          key={ct.contentType}
                                          variant="outline"
                                          className="text-xs font-normal"
                                        >
                                          {ct.contentType} · {ct.count}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {usage.variants.length > 0 && (
                                  <div>
                                    <h4 className="text-xs font-medium text-muted-foreground mb-2">
                                      Variants
                                    </h4>
                                    <div className="flex flex-wrap gap-1.5">
                                      {usage.variants.map((v) => (
                                        <Badge
                                          key={v.variant}
                                          variant="secondary"
                                          className="text-xs font-normal"
                                        >
                                          {v.variant} · {v.count}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </CardContent>
                      </Card>
                    </section>
                  )}

                  <section>
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                      <h2 className="text-lg font-semibold">Component Pairings</h2>
                      {selectedNode && (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">
                            Filtered by: <span className="font-mono font-medium text-foreground">{selectedNode}</span>
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedNode(null)}
                            data-testid="button-clear-filter"
                            className="h-7 px-2 gap-1"
                          >
                            <X size={12} />
                            Clear
                          </Button>
                        </div>
                      )}
                    </div>
                    <PairingsTable
                      pairings={tabCluster.pairings}
                      filterNode={tab === activeTab ? selectedNode : null}
                    />
                  </section>

                  <section>
                    <h2 className="text-lg font-semibold mb-3">Top Page Sequences</h2>
                    <SequencesList sequences={tabCluster.topSequences} />
                  </section>
                </>
              )}
              {!tabCluster && (
                <p className="text-muted-foreground text-sm">No data for this intent cluster.</p>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What comes after X?</CardTitle>
        </CardHeader>
        <CardContent>
          <SuggestPanel data={data} />
        </CardContent>
      </Card>
    </div>
  );
}
