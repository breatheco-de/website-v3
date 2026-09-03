import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  IconArrowLeft,
  IconCheck,
  IconDeviceFloppy,
  IconLoader2,
  IconAlertCircle,
  IconCircleCheck,
  IconSparkles,
  IconFileCode,
  IconBrain,
  IconDatabase,
} from "@tabler/icons-react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";
import { QdrantTab } from "@/components/settings/QdrantTab";

const LlmYmlEditorPanel = lazy(() => import("@/components/editing/LlmYmlEditorPanel"));

type AiSettingsTab = "llms" | "qdrant";

const AI_TABS: {
  id: AiSettingsTab;
  href: string;
  label: string;
  Icon: typeof IconBrain;
}[] = [
  { id: "llms", href: "/private/settings/ai/llms", label: "LLMs", Icon: IconBrain },
  { id: "qdrant", href: "/private/settings/ai/qdrant", label: "Qdrant", Icon: IconDatabase },
];

function resolveAiTab(pathname: string): AiSettingsTab | null {
  if (pathname === "/private/settings/ai/llms") return "llms";
  if (pathname === "/private/settings/ai/qdrant") return "qdrant";
  return null;
}

interface AISettingsResponse {
  model_default: string;
  model_chat: string;
  model_vision: string;
  provider: {
    api_key_env: string;
    base_url_env: string;
    base_url: string | null;
    api_key_configured: boolean;
  };
}

interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

interface OpenRouterModelsResponse {
  models: OpenRouterModel[];
  error?: string;
}

function aiRequestHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", ...getSessionHeaders() };
}

/** Format OpenRouter per-token USD price as $/1M tokens. */
function formatPerMillion(perToken: string | undefined): string | null {
  if (perToken == null || perToken === "") return null;
  const n = Number(perToken);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return "free";
  const perM = n * 1_000_000;
  if (perM < 0.01) return `$${perM.toPrecision(2)}`;
  if (perM < 1) return `$${perM.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
  return `$${perM % 1 === 0 ? perM.toFixed(0) : perM.toFixed(2)}`;
}

function formatModelMeta(model: OpenRouterModel): string {
  const parts: string[] = [model.id];
  if (model.context_length) {
    parts.push(`${model.context_length.toLocaleString()} context`);
  }
  const prompt = formatPerMillion(model.pricing?.prompt);
  const completion = formatPerMillion(model.pricing?.completion);
  if (prompt && completion) {
    parts.push(`${prompt} / ${completion} per 1M`);
  } else if (prompt) {
    parts.push(`${prompt} in per 1M`);
  } else if (completion) {
    parts.push(`${completion} out per 1M`);
  }
  return parts.join(" · ");
}

function ModelPicker({
  id,
  label,
  value,
  onChange,
  models,
  loading,
  disabled,
  allowEmpty,
  emptyLabel = "Use completion model",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  models: OpenRouterModel[];
  loading: boolean;
  disabled: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = useMemo(() => {
    if (!value) return emptyLabel;
    const match = models.find((m) => m.id === value);
    return match ? `${match.name} (${match.id})` : value;
  }, [emptyLabel, models, value]);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || loading}
            className="w-full justify-between font-normal"
            data-testid={`button-model-picker-${id}`}
          >
            <span className="truncate text-left">{loading ? "Loading models…" : selectedLabel}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search models…" data-testid={`input-search-models-${id}`} />
            <CommandList>
              <CommandEmpty>No models found.</CommandEmpty>
              <CommandGroup>
                {allowEmpty && (
                  <CommandItem
                    value="__empty__ use completion model"
                    onSelect={() => {
                      onChange("");
                      setOpen(false);
                    }}
                    data-testid={`model-option-${id}-empty`}
                  >
                    <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                    <span className="text-sm text-muted-foreground">{emptyLabel}</span>
                  </CommandItem>
                )}
                {models.map((model) => (
                  <CommandItem
                    key={model.id}
                    value={`${model.id} ${model.name}`}
                    onSelect={() => {
                      onChange(model.id);
                      setOpen(false);
                    }}
                    data-testid={`model-option-${id}-${model.id}`}
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4", value === model.id ? "opacity-100" : "opacity-0")}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm truncate">{model.name}</span>
                      <span className="text-xs text-muted-foreground font-mono truncate">
                        {formatModelMeta(model)}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function LlmsTab() {
  const { toast } = useToast();
  const [selectedDefault, setSelectedDefault] = useState("");
  const [selectedChat, setSelectedChat] = useState("");
  const [selectedVision, setSelectedVision] = useState("");
  const [saving, setSaving] = useState(false);
  const [showYmlEditor, setShowYmlEditor] = useState(false);

  const settingsQuery = useQuery<AISettingsResponse>({
    queryKey: ["/api/admin/ai/settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ai/settings", { headers: getSessionHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load settings (${res.status})`);
      }
      return res.json();
    },
  });

  const modelsQuery = useQuery<OpenRouterModelsResponse>({
    queryKey: ["/api/admin/ai/openrouter/models"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ai/openrouter/models", { headers: getSessionHeaders() });
      const body = (await res.json().catch(() => ({ models: [] }))) as OpenRouterModelsResponse;
      if (!res.ok) {
        throw new Error(body.error || `Failed to load models (${res.status})`);
      }
      return body;
    },
    enabled: Boolean(settingsQuery.data?.provider.api_key_configured),
    retry: false,
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setSelectedDefault(settingsQuery.data.model_default || "");
    setSelectedChat(settingsQuery.data.model_chat || "");
    setSelectedVision(settingsQuery.data.model_vision || "");
  }, [settingsQuery.data]);

  const models = modelsQuery.data?.models ?? [];
  const dirty =
    selectedDefault !== (settingsQuery.data?.model_default || "") ||
    selectedChat !== (settingsQuery.data?.model_chat || "") ||
    selectedVision !== (settingsQuery.data?.model_vision || "");

  async function handleSave() {
    if (!selectedDefault.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/ai/settings", {
        method: "PATCH",
        headers: aiRequestHeaders(),
        body: JSON.stringify({
          model_default: selectedDefault.trim(),
          model_chat: selectedChat.trim(),
          model_vision: selectedVision.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/ai/settings"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/ai/knowledge"] });
      toast({
        title: "AI settings saved",
        description: "Models updated in llm.yml.",
      });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save AI settings.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm text-muted-foreground">
          Configure OpenRouter models used across AI features. Saving writes to llm.yml.
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setShowYmlEditor(true)}
              data-testid="button-edit-llm-yml"
            >
              <IconFileCode className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Edit llm.yml
          </TooltipContent>
        </Tooltip>
      </div>

      {settingsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <IconLoader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading settings…</span>
        </div>
      ) : settingsQuery.isError ? (
        <Card>
          <CardContent className="pt-6 flex items-start gap-3 text-destructive">
            <IconAlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <p className="text-sm">
              {settingsQuery.error instanceof Error
                ? settingsQuery.error.message
                : "Failed to load AI settings."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Provider</CardTitle>
              <CardDescription>
                API keys are read from environment variables named in llm.yml (OpenRouter by default).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {settingsQuery.data?.provider.api_key_configured ? (
                  <Badge
                    variant="secondary"
                    className="gap-1 border-transparent bg-green-600/15 text-green-700 dark:bg-green-500/20 dark:text-green-400"
                    data-testid="badge-api-key-ok"
                  >
                    <IconCircleCheck className="h-3.5 w-3.5" />
                    {settingsQuery.data.provider.api_key_env} configured
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1" data-testid="badge-api-key-missing">
                    <IconAlertCircle className="h-3.5 w-3.5" />
                    Set {settingsQuery.data?.provider.api_key_env} in environment
                  </Badge>
                )}
              </div>
              <dl className="grid gap-2 text-sm">
                <div className="flex flex-col sm:flex-row sm:gap-3">
                  <dt className="text-muted-foreground sm:w-32 shrink-0">API key env</dt>
                  <dd className="font-mono text-xs sm:text-sm">{settingsQuery.data?.provider.api_key_env}</dd>
                </div>
                <div className="flex flex-col sm:flex-row sm:gap-3">
                  <dt className="text-muted-foreground sm:w-32 shrink-0">Base URL</dt>
                  <dd className="font-mono text-xs sm:text-sm break-all">
                    {settingsQuery.data?.provider.base_url || "—"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Models</CardTitle>
              <CardDescription>
                Choose OpenRouter models for completions, chat, and vision. Each maps to a field in llm.yml.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-xs text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2">
                Saving writes <code className="font-mono text-[11px]">model.default</code>,{" "}
                <code className="font-mono text-[11px]">model.chat</code>, and{" "}
                <code className="font-mono text-[11px]">model.vision</code> in llm.yml.
              </p>

              <ModelPicker
                id="completion-model"
                label="Completion model"
                value={selectedDefault}
                onChange={setSelectedDefault}
                models={models}
                loading={modelsQuery.isLoading}
                disabled={!settingsQuery.data?.provider.api_key_configured}
              />
              <p className="text-xs text-muted-foreground -mt-3">
                Field mapping, content adaptation, table builders, and other non-chat completions.
              </p>

              <ModelPicker
                id="chat-model"
                label="Chat model"
                value={selectedChat}
                onChange={setSelectedChat}
                models={models}
                loading={modelsQuery.isLoading}
                disabled={!settingsQuery.data?.provider.api_key_configured}
                allowEmpty
                emptyLabel="Use completion model"
              />
              <p className="text-xs text-muted-foreground -mt-3">
                Live chat assistant conversations.
              </p>

              <ModelPicker
                id="vision-model"
                label="Vision model"
                value={selectedVision}
                onChange={setSelectedVision}
                models={models}
                loading={modelsQuery.isLoading}
                disabled={!settingsQuery.data?.provider.api_key_configured}
                allowEmpty
                emptyLabel="Use completion model"
              />
              <p className="text-xs text-muted-foreground -mt-3">
                Image auto-tagging and other vision tasks.
              </p>

              {modelsQuery.isError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <IconAlertCircle className="h-3.5 w-3.5" />
                  {modelsQuery.error instanceof Error
                    ? modelsQuery.error.message
                    : "Could not load OpenRouter models."}
                </p>
              )}
              {!settingsQuery.data?.provider.api_key_configured && (
                <p className="text-xs text-muted-foreground">
                  Add the API key to your environment, restart the server, then refresh this page to load models.
                </p>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={!dirty || saving || !selectedDefault.trim()}
                  data-testid="button-save-ai-settings"
                >
                  {saving ? (
                    <IconLoader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : dirty ? (
                    <IconDeviceFloppy className="h-4 w-4 mr-1" />
                  ) : (
                    <IconCheck className="h-4 w-4 mr-1" />
                  )}
                  {saving ? "Saving…" : dirty ? "Save" : "Saved"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {showYmlEditor && (
        <Suspense fallback={null}>
          <LlmYmlEditorPanel
            onClose={() => setShowYmlEditor(false)}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/admin/ai/settings"] });
              setShowYmlEditor(false);
            }}
          />
        </Suspense>
      )}
    </>
  );
}

export default function AISettingsPage() {
  const [pathname, setLocation] = useLocation();
  const activeTab = resolveAiTab(pathname);

  useEffect(() => {
    if (pathname === "/private/settings/ai" || pathname === "/private/settings/ai/") {
      setLocation("/private/settings/ai/llms");
    }
  }, [pathname, setLocation]);

  if (!activeTab) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" asChild data-testid="button-ai-settings-back">
            <Link href="/private/diagnostics">
              <IconArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <IconSparkles className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-ai-settings-title">
                AI Settings
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Models, providers, and semantic search infrastructure.
            </p>
          </div>
        </div>

        <div
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-muted p-1 text-muted-foreground"
          role="tablist"
          data-testid="ai-settings-tablist"
        >
          {AI_TABS.map(({ id, href, label, Icon }) => {
            const isActive = activeTab === id;
            return (
              <Link key={id} href={href} className="flex-1">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={cn(
                    "inline-flex w-full items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isActive
                      ? "bg-background text-foreground shadow-sm"
                      : "hover:text-foreground",
                  )}
                  data-testid={`tab-${id}`}
                >
                  <Icon className="h-4 w-4 mr-1.5" />
                  {label}
                </button>
              </Link>
            );
          })}
        </div>

        <div role="tabpanel">
          {activeTab === "llms" && <LlmsTab />}
          {activeTab === "qdrant" && <QdrantTab />}
        </div>
      </div>
    </div>
  );
}
