import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconRobot,
  IconLoader2,
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  ToggleButtonBar,
  ToggleButtonBarTrigger,
} from "@/components/ui/toggle-button-bar";
import { useSettingsDirty } from "@/components/settings/SettingsShell";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

export type IndexingBlockMode = "none" | "ai" | "all";

export interface RobotsSettingsResponse {
  indexing_block: IndexingBlockMode;
  include_sitemap: boolean;
  disallow_paths: string[];
  ai_bots: string[];
  robots_txt_preview?: string;
}

const INDEXING_HELP: Record<IndexingBlockMode, string> = {
  none: "Search engines and the listed AI crawlers may crawl. Per-page robots still apply.",
  ai: "Search stays open. Listed AI bots are Disallow’d in robots.txt, and known AI crawlers are refused (403) by the app.",
  all: "robots.txt disallows everyone and every page serves noindex, nofollow. Known AI crawlers are refused (403). Search bots still get the noindex HTML so they can drop the site.",
};

function normalizeIndexingBlock(data: RobotsSettingsResponse & { block_indexing?: boolean }): IndexingBlockMode {
  if (data.indexing_block === "none" || data.indexing_block === "ai" || data.indexing_block === "all") {
    return data.indexing_block;
  }
  if (data.block_indexing === true) return "all";
  return "none";
}

export function RobotsTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<RobotsSettingsResponse & { block_indexing?: boolean }>({
    queryKey: ["/api/settings/robots"],
  });

  const [indexingBlock, setIndexingBlock] = useState<IndexingBlockMode>("none");
  const [includeSitemap, setIncludeSitemap] = useState(true);
  const [disallowPaths, setDisallowPaths] = useState<string[]>([]);
  const [aiBots, setAiBots] = useState<string[]>([]);
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useSettingsDirty(dirty);

  useEffect(() => {
    if (!data) return;
    setIndexingBlock(normalizeIndexingBlock(data));
    setIncludeSitemap(data.include_sitemap);
    setDisallowPaths([...data.disallow_paths]);
    setAiBots([...data.ai_bots]);
    setPreview(data.robots_txt_preview || "");
    setDirty(false);
  }, [data]);

  const markDirty = () => setDirty(true);
  const siteFullyBlocked = indexingBlock === "all";
  const aiMode = indexingBlock === "ai";
  const aiListEmpty = aiBots.map((b) => b.trim()).filter(Boolean).length === 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/settings/robots", {
        indexing_block: indexingBlock,
        include_sitemap: includeSitemap,
        disallow_paths: disallowPaths.map((p) => p.trim()).filter(Boolean),
        ai_bots: aiBots.map((b) => b.trim()).filter(Boolean),
      });
      const json = (await res.json()) as RobotsSettingsResponse;
      setPreview(json.robots_txt_preview || "");
      setDisallowPaths([...json.disallow_paths]);
      setAiBots([...json.ai_bots]);
      setIndexingBlock(json.indexing_block);
      setIncludeSitemap(json.include_sitemap);
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/settings/robots"] });
      toast({ title: "Robots settings saved" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save robots settings";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <IconRobot className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Robots & indexing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div
                className={`rounded-md border p-4 space-y-3 ${
                  siteFullyBlocked ? "border-destructive/50 bg-destructive/5" : ""
                }`}
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium">Who may crawl this site?</p>
                  <p className="text-xs text-muted-foreground">
                    Choose how open this site is to search engines and AI crawlers.
                  </p>
                </div>
                <ToggleButtonBar
                  value={indexingBlock}
                  onValueChange={(v) => {
                    if (v === "none" || v === "ai" || v === "all") {
                      setIndexingBlock(v);
                      markDirty();
                    }
                  }}
                  listTestId="toggle-indexing-block"
                >
                  <ToggleButtonBarTrigger value="none" data-testid="indexing-block-none">
                    None
                  </ToggleButtonBarTrigger>
                  <ToggleButtonBarTrigger value="ai" data-testid="indexing-block-ai">
                    AI crawlers
                  </ToggleButtonBarTrigger>
                  <ToggleButtonBarTrigger value="all" data-testid="indexing-block-all">
                    All crawlers
                  </ToggleButtonBarTrigger>
                </ToggleButtonBar>
                <p className="text-xs text-muted-foreground" data-testid="text-indexing-help">
                  {INDEXING_HELP[indexingBlock]}
                </p>
                {siteFullyBlocked && (
                  <div className="flex items-start gap-2 text-sm text-destructive">
                    <IconAlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      The whole website is currently disallowed from search indexing.
                    </span>
                  </div>
                )}
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">Read more (advanced)</summary>
                  <p className="mt-2 space-y-1">
                    Stored as <code className="text-xs">robots.indexing_block</code> in{" "}
                    <code className="text-xs">settings.yml</code>. The AI bot list drives robots.txt
                    Allow/Disallow lines; hard 403 uses the platform’s known AI crawler detector.
                    robots.txt is voluntary for non-compliant scrapers; CDN/WAF rules are separate.
                  </p>
                </details>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border p-4">
                <div className="space-y-1">
                  <Label htmlFor="include-sitemap" className="text-sm font-medium">
                    Include Sitemap in robots.txt
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Advertise <code className="text-xs">/sitemap.xml</code> when indexing is allowed.
                    Ignored while all crawlers are blocked.
                  </p>
                </div>
                <Switch
                  id="include-sitemap"
                  checked={includeSitemap}
                  disabled={siteFullyBlocked}
                  onCheckedChange={(v) => {
                    setIncludeSitemap(v);
                    markDirty();
                  }}
                  data-testid="switch-include-sitemap"
                />
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Disallow paths</p>
                  <p className="text-xs text-muted-foreground">
                    Paths listed under <code className="text-xs">User-agent: *</code> in robots.txt.
                  </p>
                </div>
                <div className="space-y-2">
                  {disallowPaths.map((path, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={path}
                        disabled={siteFullyBlocked}
                        onChange={(e) => {
                          const next = [...disallowPaths];
                          next[index] = e.target.value;
                          setDisallowPaths(next);
                          markDirty();
                        }}
                        placeholder="/private/"
                        className="font-mono text-sm"
                        data-testid={`input-disallow-path-${index}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={siteFullyBlocked}
                        onClick={() => {
                          setDisallowPaths(disallowPaths.filter((_, i) => i !== index));
                          markDirty();
                        }}
                        data-testid={`button-remove-disallow-${index}`}
                      >
                        <IconTrash className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={siteFullyBlocked}
                    onClick={() => {
                      setDisallowPaths([...disallowPaths, "/"]);
                      markDirty();
                    }}
                    data-testid="button-add-disallow-path"
                  >
                    <IconPlus className="h-4 w-4 mr-1.5" />
                    Add path
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">AI bot User-agents</p>
                  <p className="text-xs text-muted-foreground">
                    {aiMode
                      ? "These names get Disallow: / in robots.txt while AI crawlers are blocked."
                      : "These names get Allow: / in robots.txt when crawl control is None."}
                  </p>
                </div>
                {aiMode && aiListEmpty && (
                  <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                    <IconAlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      No AI user-agents listed, so robots.txt will not name any Disallow groups.
                      Known AI crawlers are still refused with 403.
                    </span>
                  </div>
                )}
                <div className="space-y-2">
                  {aiBots.map((bot, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={bot}
                        disabled={siteFullyBlocked}
                        onChange={(e) => {
                          const next = [...aiBots];
                          next[index] = e.target.value;
                          setAiBots(next);
                          markDirty();
                        }}
                        placeholder="GPTBot"
                        className="font-mono text-sm"
                        data-testid={`input-ai-bot-${index}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={siteFullyBlocked}
                        onClick={() => {
                          setAiBots(aiBots.filter((_, i) => i !== index));
                          markDirty();
                        }}
                        data-testid={`button-remove-ai-bot-${index}`}
                      >
                        <IconTrash className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={siteFullyBlocked}
                    onClick={() => {
                      setAiBots([...aiBots, ""]);
                      markDirty();
                    }}
                    data-testid="button-add-ai-bot"
                  >
                    <IconPlus className="h-4 w-4 mr-1.5" />
                    Add bot
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">robots.txt preview</p>
                <pre
                  className="rounded-md border bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-64"
                  data-testid="text-robots-preview"
                >
                  {preview || "(save to refresh preview)"}
                </pre>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div
        className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-lg"
        data-testid="robots-save-bar"
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-end gap-3">
          <p
            className={cn(
              "text-xs min-w-0 truncate text-right",
              dirty ? "text-destructive" : "text-muted-foreground",
            )}
            data-testid="text-robots-save-status"
          >
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
          </p>
          <Button
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => void handleSave()}
            disabled={!dirty || saving}
            data-testid="button-save-robots"
          >
            {saving ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <IconDeviceFloppy className="h-3.5 w-3.5" aria-hidden />
            )}
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </>
  );
}
