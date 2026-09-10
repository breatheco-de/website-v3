import { useState, useRef, useEffect } from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight, Code, ExternalLink, Link, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { decodeUtf8Base64 } from "@shared/functionEncoding";

interface TableColumnConfig {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "image" | "link" | "boolean";
  function?: string;
}

interface TableConfig {
  columns: TableColumnConfig[];
  title?: string;
  description?: string;
}

export interface DynamicTableConfig {
  endpoint: string;
  data_path?: string;
  columns: TableColumnConfig[];
  title?: string;
  action?: {
    label: string;
    href: string;
  };
}

interface TableBuilderWizardProps {
  onComplete: (config: DynamicTableConfig) => void;
  onCancel?: () => void;
  locale?: string;
}

type WizardStep = "url" | "select-array" | "consistency" | "columns-prompt" | "ai-processing" | "review" | "action" | "done";

interface ChatMessage {
  role: "user" | "ai";
  content: string;
  config?: TableConfig;
}

interface DataAnalysis {
  description: string;
  suggestedPrompts: string[];
}

interface StepState {
  url: string;
  rawData: unknown;
  arrayOptions: string[];
  selectedArrayPath: string;
  dataArray: Record<string, unknown>[];
  availableKeys: string[];
  dataAnalysis: DataAnalysis | null;
  analysisLoading: boolean;
  columnsPrompt: string;
  tableConfig: TableConfig | null;
  refinementPrompt: string;
  chatMessages: ChatMessage[];
  addAction: boolean;
  actionColumnName: string;
  actionLabel: string;
  actionHref: string;
}

function extractArrayProperties(data: unknown): string[] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return [];
  const result: string[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      result.push(key);
    }
  }
  return result;
}

function flattenKeys(obj: Record<string, unknown>, prefix = "", maxDepth = 3): string[] {
  if (maxDepth <= 0) return [];
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    keys.push(path);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, path, maxDepth - 1));
    }
  }
  return keys;
}

function getKeysFromArray(arr: Record<string, unknown>[]): string[] {
  if (arr.length === 0) return [];
  return flattenKeys(arr[0]);
}

function checkConsistency(arr: Record<string, unknown>[]): { consistent: boolean; keys: string[] } {
  if (arr.length < 2) return { consistent: true, keys: getKeysFromArray(arr) };
  const firstKeys = Object.keys(arr[0]).slice(0, 3);
  const secondItem = arr[1];
  const missing = firstKeys.filter((k) => !(k in secondItem));
  return {
    consistent: missing.length === 0,
    keys: getKeysFromArray(arr),
  };
}

function formatConfigSummary(config: TableConfig): string {
  if (config.description) return config.description;
  const cols = config.columns.map((c) => c.label).join(", ");
  return `${config.title ? `"${config.title}" with` : "Table with"} ${config.columns.length} columns: ${cols}`;
}

function executeBase64Function(fnBase64: string, row: Record<string, unknown>): unknown {
  try {
    const fnString = decodeUtf8Base64(fnBase64);
    const fn = new Function("row", `return (${fnString})(row);`);
    return fn(row);
  } catch {
    return null;
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function getCellPreviewValue(col: TableColumnConfig, row: Record<string, unknown>): unknown {
  if (col.function) {
    return executeBase64Function(col.function, row);
  }
  return getNestedValue(row, col.key);
}

function formatPreviewDisplay(value: unknown): string {
  if (value === null || value === undefined) return "-";
  const str = String(value);
  return str.length > 50 ? str.slice(0, 50) + "..." : str;
}

function decodeBase64(encoded: string): string {
  try {
    return decodeUtf8Base64(encoded);
  } catch {
    return encoded;
  }
}

interface PreviewTableProps {
  config: TableConfig;
  sampleData: Record<string, unknown>[];
  action?: { columnName: string; label: string; href: string } | null;
}

function PreviewTable({ config, sampleData, action }: PreviewTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showFunctions, setShowFunctions] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const PREVIEW_LIMIT = 5;
  const hasMore = sampleData.length > PREVIEW_LIMIT;

  let previewRows = expanded ? [...sampleData] : sampleData.slice(0, PREVIEW_LIMIT);
  if (sortKey) {
    previewRows = [...previewRows].sort((a, b) => {
      const aVal = getNestedValue(a, sortKey);
      const bVal = getNestedValue(b, sortKey);
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="overflow-x-auto rounded-[0.8rem] border" data-testid="preview-table-container">
      {config.title && (
        <div className="px-4 py-2 border-b bg-muted/30">
          <span className="text-sm font-medium text-foreground">{config.title}</span>
        </div>
      )}
      <div className={expanded ? "max-h-[400px] overflow-y-auto" : ""}>
      <table className="w-full text-xs" data-testid="preview-table">
        <thead className="sticky top-0 z-10">
          <tr className="bg-muted/50 border-b">
            {config.columns.map((col) => (
              <th
                key={col.key}
                className="px-3 py-2 text-left font-medium text-foreground cursor-pointer select-none"
                onClick={() => handleSort(col.key)}
              >
                <div className="flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key && (
                    sortDir === "asc" ? (
                      <ArrowUp className="w-2.5 h-2.5" />
                    ) : (
                      <ArrowDown className="w-2.5 h-2.5" />
                    )
                  )}
                </div>
              </th>
            ))}
            {action && (
              <th className="px-3 py-2 text-left font-medium text-foreground">
                {action.columnName}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {previewRows.length === 0 ? (
            <tr>
              <td colSpan={config.columns.length + (action ? 1 : 0)} className="px-3 py-4 text-center text-muted-foreground">
                No data available
              </td>
            </tr>
          ) : (
            previewRows.map((row, idx) => (
              <tr key={idx} className="border-b last:border-0">
                {config.columns.map((col) => {
                  const value = getCellPreviewValue(col, row);
                  return (
                    <td key={col.key} className="px-3 py-2 text-foreground max-w-[180px] truncate">
                      {formatPreviewDisplay(value)}
                    </td>
                  );
                })}
                {action && (
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border text-foreground">
                      {action.label}
                      <ExternalLink className="w-2.5 h-2.5" />
                    </span>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
      <div className="px-3 py-1.5 border-t bg-muted/20 flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {expanded ? `Showing all ${sampleData.length} rows` : `Preview: ${previewRows.length} of ${sampleData.length} rows`}
        </span>
        <div className="flex items-center gap-3">
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-toggle-rows"
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
              {expanded ? "Show less" : `Show all ${sampleData.length}`}
            </button>
          )}
          {config.columns.some((c) => c.function) && (
            <button
              type="button"
              onClick={() => setShowFunctions((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-toggle-functions"
            >
              <Code className="w-3 h-3" />
              {showFunctions ? "Hide" : "Show"} column functions
            </button>
          )}
        </div>
      </div>
      {showFunctions && (
        <div className="border-t px-3 py-2 space-y-1.5 bg-muted/10">
          {config.columns.map((col) => (
            <div key={col.key} className="text-[11px]" data-testid={`function-detail-${col.key}`}>
              <span className="font-medium text-foreground">{col.label}</span>
              <span className="text-muted-foreground mx-1">:</span>
              <code className="text-muted-foreground font-mono">
                {col.function ? decodeBase64(col.function) : `row.${col.key}`}
              </code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TableBuilderWizard({ onComplete, onCancel, locale }: TableBuilderWizardProps) {
  const [step, setStep] = useState<WizardStep>("url");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sampleExpanded, setSampleExpanded] = useState(false);
  const [refining, setRefining] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<StepState>({
    url: "",
    rawData: null,
    arrayOptions: [],
    selectedArrayPath: "",
    dataArray: [],
    availableKeys: [],
    dataAnalysis: null,
    analysisLoading: false,
    columnsPrompt: "",
    tableConfig: null,
    refinementPrompt: "",
    chatMessages: [],
    addAction: false,
    actionColumnName: "Actions",
    actionLabel: "View",
    actionHref: "",
  });

  const updateState = (updates: Partial<StepState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  };

  const handleFetchUrl = async () => {
    if (!state.url.trim()) {
      setError("Please enter a URL");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(state.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();

      if (Array.isArray(data)) {
        if (data.length === 0 || typeof data[0] !== "object") {
          setError("The endpoint returned an empty array or non-object items.");
          setLoading(false);
          return;
        }
        const consistency = checkConsistency(data as Record<string, unknown>[]);
        updateState({
          rawData: data,
          dataArray: data as Record<string, unknown>[],
          availableKeys: consistency.keys,
        });
        if (!consistency.consistent) {
          setStep("consistency");
        } else {
          setStep("columns-prompt");
        }
      } else if (typeof data === "object" && data !== null) {
        const arrayProps = extractArrayProperties(data);
        if (arrayProps.length === 0) {
          setError("The response doesn't contain any array properties with object items.");
          setLoading(false);
          return;
        }
        if (arrayProps.length === 1) {
          const arr = (data as Record<string, unknown>)[arrayProps[0]] as Record<string, unknown>[];
          const consistency = checkConsistency(arr);
          updateState({
            rawData: data,
            selectedArrayPath: arrayProps[0],
            dataArray: arr,
            availableKeys: consistency.keys,
          });
          if (!consistency.consistent) {
            setStep("consistency");
          } else {
            setStep("columns-prompt");
          }
        } else {
          updateState({
            rawData: data,
            arrayOptions: arrayProps,
          });
          setStep("select-array");
        }
      } else {
        setError("The endpoint did not return an object or array.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data from URL");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectArray = (key: string) => {
    const data = state.rawData as Record<string, unknown>;
    const arr = data[key] as Record<string, unknown>[];
    const consistency = checkConsistency(arr);
    updateState({
      selectedArrayPath: key,
      dataArray: arr,
      availableKeys: consistency.keys,
    });
    if (!consistency.consistent) {
      setStep("consistency");
    } else {
      setStep("columns-prompt");
    }
  };

  const scrollChatToBottom = () => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  const handleAnalyzeData = async () => {
    if (state.dataAnalysis) return;
    updateState({ analysisLoading: true });
    setError(null);
    try {
      const response = await apiRequest("POST", "/api/ai/analyze-data-payload", {
        sampleData: state.dataArray.slice(0, 5),
        availableKeys: state.availableKeys,
        locale: locale || "en",
      });
      const analysis = await response.json();
      updateState({ dataAnalysis: analysis, analysisLoading: false });
    } catch (err) {
      updateState({ analysisLoading: false });
      setError(err instanceof Error ? err.message : "Failed to analyze data");
    }
  };

  const handleGenerateColumns = async () => {
    if (!state.columnsPrompt.trim()) {
      setError("Please describe the columns you want");
      return;
    }

    setStep("ai-processing");
    setError(null);

    try {
      const response = await apiRequest("POST", "/api/ai/generate-table-from-payload", {
        sampleData: state.dataArray.slice(0, 5),
        availableKeys: state.availableKeys,
        userPrompt: state.columnsPrompt,
        locale: locale || "en",
      });
      const config = await response.json();
      const initialMessages: ChatMessage[] = [
        { role: "user", content: state.columnsPrompt },
        { role: "ai", content: formatConfigSummary(config), config },
      ];
      updateState({ tableConfig: config, refinementPrompt: "", chatMessages: initialMessages });
      setStep("review");
      scrollChatToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI failed to generate table configuration");
      setStep("columns-prompt");
    }
  };

  const handleRefine = async () => {
    if (!state.refinementPrompt.trim() || !state.tableConfig) return;

    const userMsg: ChatMessage = { role: "user", content: state.refinementPrompt };
    const updatedMessages = [...state.chatMessages, userMsg];
    updateState({ chatMessages: updatedMessages, refinementPrompt: "" });
    setRefining(true);
    setError(null);
    scrollChatToBottom();

    try {
      const response = await apiRequest("POST", "/api/ai/refine-table-config", {
        currentConfig: state.tableConfig,
        sampleData: state.dataArray.slice(0, 5),
        availableKeys: state.availableKeys,
        userFeedback: state.refinementPrompt,
        locale: locale || "en",
      });
      const config = await response.json();
      const aiMsg: ChatMessage = { role: "ai", content: formatConfigSummary(config), config };
      updateState({ tableConfig: config, chatMessages: [...updatedMessages, aiMsg] });
      scrollChatToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI failed to refine table configuration");
    } finally {
      setRefining(false);
    }
  };

  const handleFinish = () => {
    if (!state.tableConfig) return;
    const config: DynamicTableConfig = {
      endpoint: state.url,
      data_path: state.selectedArrayPath || undefined,
      columns: state.tableConfig.columns,
      title: state.tableConfig.title,
    };
    if (state.addAction && state.actionHref.trim()) {
      config.action = {
        label: state.actionLabel || "View",
        href: state.actionHref,
      };
    }
    onComplete(config);
  };

  return (
    <Card className="p-6 max-w-3xl mx-auto">
      <div className="space-y-6">
        <StepIndicator current={step} />

        {step === "url" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-1" data-testid="text-wizard-title">
                Where is your data?
              </h3>
              <p className="text-sm text-muted-foreground">
                Enter the URL of the API endpoint that returns the data you want to display in a table.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="endpoint-url">API Endpoint URL</Label>
              <Input
                id="endpoint-url"
                placeholder="https://api.example.com/data"
                value={state.url}
                onChange={(e) => updateState({ url: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && handleFetchUrl()}
                data-testid="input-endpoint-url"
              />
            </div>
            {error && <ErrorMessage message={error} />}
            <div className="flex justify-end gap-2">
              {onCancel && (
                <Button variant="outline" onClick={onCancel} data-testid="button-cancel">
                  Cancel
                </Button>
              )}
              <Button onClick={handleFetchUrl} disabled={loading || !state.url.trim()} data-testid="button-fetch-url">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                <span className="ml-1">Next</span>
              </Button>
            </div>
          </div>
        )}

        {step === "select-array" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-1" data-testid="text-select-array-title">
                Which data do you want to use?
              </h3>
              <p className="text-sm text-muted-foreground">
                We found multiple array properties in the response. Please select which one contains the data for your table.
              </p>
            </div>
            <div className="grid gap-2">
              {state.arrayOptions.map((key) => {
                const arr = (state.rawData as Record<string, unknown>)[key] as unknown[];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleSelectArray(key)}
                    className="flex items-center justify-between p-3 rounded-md border text-left hover-elevate"
                    data-testid={`button-select-array-${key}`}
                  >
                    <div>
                      <span className="font-medium text-foreground">{key}</span>
                      <span className="text-xs text-muted-foreground ml-2">({arr.length} items)</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
            <div className="flex justify-start">
              <Button variant="outline" onClick={() => setStep("url")} data-testid="button-back-url">
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            </div>
          </div>
        )}

        {step === "consistency" && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-destructive/10 rounded-md">
              <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-foreground" data-testid="text-consistency-error">
                  Inconsistent data
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  We detected that the data rows have inconsistent columns. Each row must have the same properties for the table to work correctly.
                </p>
              </div>
            </div>
            <div className="flex justify-start gap-2">
              <Button variant="outline" onClick={() => setStep("url")} data-testid="button-back-start">
                <ArrowLeft className="w-4 h-4 mr-1" />
                Start over
              </Button>
              <Button
                variant="outline"
                onClick={() => setStep("columns-prompt")}
                data-testid="button-continue-anyway"
              >
                Continue anyway
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === "columns-prompt" && (
          <DescribeStep
            state={state}
            error={error}
            sampleExpanded={sampleExpanded}
            onToggleSample={() => setSampleExpanded((v) => !v)}
            onAnalyze={handleAnalyzeData}
            onUpdatePrompt={(p) => updateState({ columnsPrompt: p })}
            onGenerate={handleGenerateColumns}
            onBack={() => {
              setError(null);
              if (state.arrayOptions.length > 1) setStep("select-array");
              else setStep("url");
            }}
          />
        )}

        {step === "ai-processing" && (
          <div className="flex flex-col items-center py-8 gap-4">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground" data-testid="text-ai-processing">
              AI is configuring your table columns...
            </p>
          </div>
        )}

        {step === "review" && state.tableConfig && (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-1" data-testid="text-review-title">
                Review & refine
              </h3>
              <p className="text-sm text-muted-foreground">
                Here's how your table looks. Use the chat below to ask for changes.
              </p>
            </div>

            <PreviewTable config={state.tableConfig} sampleData={state.dataArray} />

            <div className="border rounded-md flex flex-col" style={{ maxHeight: "240px" }}>
              <div className="flex-1 overflow-y-auto p-3 space-y-3" data-testid="chat-messages">
                {state.chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-md px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                      data-testid={`chat-message-${msg.role}-${i}`}
                    >
                      <p>{msg.content}</p>
                    </div>
                  </div>
                ))}
                {refining && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-md px-3 py-2">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="border-t p-2 flex gap-2 items-end">
                <Textarea
                  placeholder="Ask for changes... e.g. 'Remove duration', 'Rename Location to Campus'"
                  value={state.refinementPrompt}
                  onChange={(e) => updateState({ refinementPrompt: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleRefine();
                    }
                  }}
                  className="min-h-[40px] max-h-[80px] flex-1 resize-none text-sm"
                  disabled={refining}
                  data-testid="input-refinement-prompt"
                />
                <Button
                  size="icon"
                  onClick={handleRefine}
                  disabled={refining || !state.refinementPrompt.trim()}
                  data-testid="button-refine"
                >
                  {refining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {error && <ErrorMessage message={error} />}
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => setStep("columns-prompt")}
                data-testid="button-back-review"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
              <Button
                onClick={() => setStep("action")}
                disabled={refining}
                data-testid="button-accept-columns"
              >
                <Check className="w-4 h-4 mr-1" />
                Looks good, continue
              </Button>
            </div>
          </div>
        )}

        {step === "action" && (
          <div className="space-y-4">
            <div data-testid="text-action-title">
              <p className="text-lg font-semibold text-foreground">
                Add an Action Call?
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Action calls are a new column that will include a button on the table so that users can be redirected to other pages.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex gap-2">
                <Button
                  variant={state.addAction ? "default" : "outline"}
                  onClick={() => updateState({ addAction: true })}
                  data-testid="button-add-action-yes"
                >
                  Yes, add actions
                </Button>
                <Button
                  variant={!state.addAction ? "default" : "outline"}
                  onClick={() => updateState({ addAction: false })}
                  data-testid="button-add-action-no"
                >
                  No, skip
                </Button>
              </div>

              {state.addAction && (
                <div className="space-y-2 pl-1">
                  <div className="space-y-1">
                    <Label htmlFor="action-column-name">Column name</Label>
                    <Input
                      id="action-column-name"
                      placeholder="Actions"
                      value={state.actionColumnName}
                      onChange={(e) => updateState({ actionColumnName: e.target.value })}
                      data-testid="input-action-column-name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="action-label">Button label</Label>
                    <Input
                      id="action-label"
                      placeholder="View"
                      value={state.actionLabel}
                      onChange={(e) => updateState({ actionLabel: e.target.value })}
                      data-testid="input-action-label"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="action-href">Link URL</Label>
                    <div className="flex items-center gap-2">
                      <Link className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <Input
                        id="action-href"
                        placeholder="https://example.com/detail/{id}"
                        value={state.actionHref}
                        onChange={(e) => updateState({ actionHref: e.target.value })}
                        data-testid="input-action-href"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Use {"{columnName}"} to insert row values in the URL.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {state.tableConfig && (
              <PreviewTable
                config={state.tableConfig}
                sampleData={state.dataArray}
                action={state.addAction ? { columnName: state.actionColumnName || "Actions", label: state.actionLabel || "View", href: state.actionHref } : null}
              />
            )}

            {state.addAction && !state.actionHref.trim() && (
              <p className="text-sm text-destructive" data-testid="text-action-validation">
                Please fill in all action fields or choose "No, skip" to continue without actions.
              </p>
            )}

            {error && <ErrorMessage message={error} />}
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => setStep("review")}
                data-testid="button-back-action"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
              <Button
                onClick={handleFinish}
                disabled={state.addAction && !state.actionHref.trim()}
                data-testid="button-finish"
              >
                <Check className="w-4 h-4 mr-1" />
                Create table
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

interface DescribeStepProps {
  state: StepState;
  error: string | null;
  sampleExpanded: boolean;
  onToggleSample: () => void;
  onAnalyze: () => void;
  onUpdatePrompt: (prompt: string) => void;
  onGenerate: () => void;
  onBack: () => void;
}

function DescribeStep({ state, error, sampleExpanded, onToggleSample, onAnalyze, onUpdatePrompt, onGenerate, onBack }: DescribeStepProps) {
  const hasAnalysis = state.dataAnalysis !== null;
  const analysisTriggered = useRef(false);

  useEffect(() => {
    if (!hasAnalysis && !state.analysisLoading && !analysisTriggered.current && !error) {
      analysisTriggered.current = true;
      onAnalyze();
    }
  }, [hasAnalysis, state.analysisLoading, onAnalyze, error]);

  const handleRetry = () => {
    analysisTriggered.current = false;
    onAnalyze();
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-1" data-testid="text-columns-title">
          Describe your table
        </h3>
        <p className="text-sm text-muted-foreground">
          Tell the AI what columns you want to see and how they should look.
        </p>
      </div>

      {state.analysisLoading && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-md">
          <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
          <p className="text-xs text-muted-foreground" data-testid="text-analysis-loading">
            Analyzing your data for suggestions...
          </p>
        </div>
      )}

      {hasAnalysis && (
        <div className="p-3 bg-muted/50 rounded-md space-y-2">
          <p className="text-sm text-foreground" data-testid="text-analysis-description">
            {state.dataAnalysis!.description}
          </p>
          <p className="text-xs text-muted-foreground">
            {state.dataArray.length} items found with {state.availableKeys.length} available fields
          </p>
          {state.dataAnalysis!.suggestedPrompts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {state.dataAnalysis!.suggestedPrompts.map((prompt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onUpdatePrompt(prompt)}
                  className="text-xs px-3 py-1.5 rounded-full border text-foreground hover-elevate text-left"
                  data-testid={`button-suggestion-${i}`}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && state.analysisLoading === false && !hasAnalysis && (
        <div className="space-y-2">
          <ErrorMessage message={error} />
          <Button variant="outline" size="sm" onClick={handleRetry} data-testid="button-retry-analysis">
            Try again
          </Button>
        </div>
      )}

      {state.dataArray.length > 0 && (
        <div>
          <button
            type="button"
            onClick={onToggleSample}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-toggle-sample"
          >
            {sampleExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Sample item preview
          </button>
          {sampleExpanded && (
            <pre
              className="mt-2 p-3 rounded-md bg-muted text-xs text-foreground overflow-auto max-h-[200px] border"
              data-testid="text-sample-item"
            >
              {JSON.stringify(state.dataArray[0], null, 2)}
            </pre>
          )}
        </div>
      )}

      <Textarea
        placeholder="Describe the columns you want..."
        value={state.columnsPrompt}
        onChange={(e) => onUpdatePrompt(e.target.value)}
        className="min-h-[80px]"
        data-testid="input-columns-prompt"
      />
      {error && hasAnalysis && <ErrorMessage message={error} />}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={onBack}
          data-testid="button-back-columns"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        <Button
          onClick={onGenerate}
          disabled={!state.columnsPrompt.trim()}
          data-testid="button-generate-columns"
        >
          <ArrowRight className="w-4 h-4 mr-1" />
          Generate table
        </Button>
      </div>
    </div>
  );
}

function StepIndicator({ current }: { current: WizardStep }) {
  const steps: { key: WizardStep[]; label: string }[] = [
    { key: ["url"], label: "Data source" },
    { key: ["select-array", "consistency"], label: "Validate" },
    { key: ["columns-prompt", "ai-processing"], label: "Describe" },
    { key: ["review"], label: "Review" },
    { key: ["action", "done"], label: "Actions" },
  ];

  const currentIdx = steps.findIndex((s) => s.key.includes(current));

  return (
    <div className="flex items-center gap-2" data-testid="step-indicator">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-2">
          <div
            className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
              i < currentIdx
                ? "bg-primary text-primary-foreground"
                : i === currentIdx
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {i < currentIdx ? <Check className="w-3 h-3" /> : i + 1}
          </div>
          <span
            className={`text-xs ${
              i === currentIdx ? "text-foreground font-medium" : "text-muted-foreground"
            } hidden sm:inline`}
          >
            {s.label}
          </span>
          {i < steps.length - 1 && <div className="w-6 h-px bg-border hidden sm:block" />}
        </div>
      ))}
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 p-3 bg-destructive/10 rounded-md text-sm" data-testid="text-error-message">
      <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
      <span className="text-destructive">{message}</span>
    </div>
  );
}

export default TableBuilderWizard;
