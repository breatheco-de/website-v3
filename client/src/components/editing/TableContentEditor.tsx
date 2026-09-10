import { useState, useRef, useEffect } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Code, Filter, Loader2, Send, Table, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useSession } from "@/contexts/SessionContext";
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

interface ChatMessage {
  role: "user" | "ai";
  content: string;
  config?: TableConfig;
  filterFunction?: string;
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

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
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

interface FilterContext {
  region?: string;
  country_code?: string;
  city?: string;
  language?: string;
  timezone?: string;
}

function executeGlobalFilterClient(fnBase64: string, rows: Record<string, unknown>[], ctx?: FilterContext): Record<string, unknown>[] {
  try {
    const fnString = decodeUtf8Base64(fnBase64);
    try {
      const fn = new Function("rows", "ctx", `return (${fnString})(rows, ctx);`);
      const result = fn(rows, ctx || {});
      if (Array.isArray(result)) return result;
    } catch {
      const fn = new Function("rows", `return (${fnString})(rows);`);
      const result = fn(rows);
      if (Array.isArray(result)) return result;
    }
    return rows;
  } catch {
    return rows;
  }
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

function formatConfigSummary(config: TableConfig): string {
  const cols = config.columns.map((c) => c.label).join(", ");
  const desc = (config as TableConfig & { description?: string }).description;
  if (desc) return desc;
  return `${config.title ? `"${config.title}" — ` : ""}${config.columns.length} columns: ${cols}`;
}

type EditorMode = "content" | "filter";

interface PreviewTableProps {
  config: TableConfig;
  sampleData: Record<string, unknown>[];
  filterFunction?: string;
  filterCtx?: FilterContext;
}

function PreviewTable({ config, sampleData, filterFunction, filterCtx }: PreviewTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showFunctions, setShowFunctions] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const PREVIEW_LIMIT = 5;

  const displayData = (() => {
    if (filterFunction) {
      return executeGlobalFilterClient(filterFunction, sampleData, filterCtx);
    }
    return sampleData;
  })();

  const hasMore = displayData.length > PREVIEW_LIMIT;

  const previewRows = (() => {
    let rows = expanded ? [...displayData] : displayData.slice(0, PREVIEW_LIMIT);
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
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
    return rows;
  })();

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="overflow-x-auto rounded-[0.8rem] border" data-testid="editor-preview-table-container">
      {filterFunction && (
        <div className="px-3 py-1.5 bg-muted/40 border-b flex items-center gap-2">
          <Filter className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">
            Filter active — {displayData.length} of {sampleData.length} rows match
          </span>
        </div>
      )}
      <div className={expanded ? "max-h-[300px] overflow-y-auto" : ""}>
      <table className="w-full text-xs" data-testid="editor-preview-table">
        <thead className="sticky top-0 z-10">
          <tr className="bg-muted/50 border-b">
            {config.columns.map((col) => (
              <th
                key={col.key}
                className="px-3 py-2 text-left font-medium text-foreground cursor-pointer select-none"
                onClick={() => handleSort(col.key)}
                data-testid={`th-sort-${col.key}`}
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
          </tr>
        </thead>
        <tbody>
          {previewRows.length === 0 ? (
            <tr>
              <td colSpan={config.columns.length} className="px-3 py-4 text-center text-muted-foreground">
                {filterFunction ? "No rows match the current filter" : "No data available"}
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
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
      <div className="px-3 py-1.5 border-t bg-muted/20 flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {expanded
            ? `Showing all ${displayData.length} rows`
            : `Preview: ${previewRows.length} of ${displayData.length} rows`}
        </span>
        <div className="flex items-center gap-3">
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-editor-toggle-rows"
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
              {expanded ? "Show less" : `Show all ${displayData.length}`}
            </button>
          )}
          {config.columns.some((c) => c.function) && (
            <button
              type="button"
              onClick={() => setShowFunctions((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-editor-toggle-functions"
            >
              <Code className="w-3 h-3" />
              {showFunctions ? "Hide" : "Show"} functions
            </button>
          )}
        </div>
      </div>
      {showFunctions && (
        <div className="border-t px-3 py-2 space-y-1.5 bg-muted/10">
          {config.columns.map((col) => (
            <div key={col.key} className="text-[11px]">
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

interface TableContentEditorProps {
  mode: EditorMode;
  endpoint: string;
  dataPath?: string;
  currentColumns: TableColumnConfig[];
  currentTitle?: string;
  currentFilter?: string;
  locale?: string;
  onApplyContent?: (config: { columns: TableColumnConfig[]; title?: string }) => void;
  onApplyFilter?: (filterBase64: string) => void;
  onRemoveFilter?: () => void;
  onClose: () => void;
}

export function TableContentEditor({
  mode,
  endpoint,
  dataPath,
  currentColumns,
  currentTitle,
  currentFilter,
  locale,
  onApplyContent,
  onApplyFilter,
  onRemoveFilter,
  onClose,
}: TableContentEditorProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataArray, setDataArray] = useState<Record<string, unknown>[]>([]);
  const [availableKeys, setAvailableKeys] = useState<string[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { session } = useSession();

  const filterCtx: FilterContext = {
    region: session.location?.region || undefined,
    country_code: (session.geo?.country_code || session.location?.country_code || "").toLowerCase() || undefined,
    city: session.geo?.city || session.location?.city || undefined,
    language: session.language,
    timezone: session.location?.timezone || session.geo?.timezone || undefined,
  };

  const [activeConfig, setActiveConfig] = useState<TableConfig>({
    columns: currentColumns,
    title: currentTitle,
  });
  const [activeFilter, setActiveFilter] = useState<string | undefined>(currentFilter);

  const scrollToBottom = () => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  useEffect(() => {
    if (!endpoint) return;
    setDataLoading(true);
    setError(null);
    (async () => {
      try {
        const response = await fetch(endpoint);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.json();
        let arr: Record<string, unknown>[];
        if (Array.isArray(raw)) {
          arr = raw as Record<string, unknown>[];
        } else if (dataPath && raw[dataPath] && Array.isArray(raw[dataPath])) {
          arr = raw[dataPath] as Record<string, unknown>[];
        } else {
          const firstArrayKey = Object.keys(raw).find((k) => Array.isArray(raw[k]) && raw[k].length > 0);
          if (firstArrayKey) {
            arr = raw[firstArrayKey] as Record<string, unknown>[];
          } else {
            setError("Could not find array data in endpoint response");
            setDataLoading(false);
            return;
          }
        }
        if (arr.length === 0) {
          setError("Endpoint returned empty data");
          setDataLoading(false);
          return;
        }
        setDataArray(arr);
        setAvailableKeys(flattenKeys(arr[0]));
        setDataLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch data");
      } finally {
        setDataLoading(false);
      }
    })();
  }, [endpoint, dataPath]);

  const handleSend = async () => {
    if (!input.trim() || sending || !dataLoaded) return;

    const userMsg: ChatMessage = { role: "user", content: input };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setSending(true);
    setError(null);
    scrollToBottom();

    try {
      if (mode === "content") {
        const response = await apiRequest("POST", "/api/ai/refine-table-config", {
          currentConfig: activeConfig,
          sampleData: dataArray.slice(0, 5),
          availableKeys,
          userFeedback: input,
          locale: locale || "en",
        });
        const config = await response.json() as TableConfig;
        const aiMsg: ChatMessage = {
          role: "ai",
          content: formatConfigSummary(config),
          config,
        };
        setMessages([...updatedMessages, aiMsg]);
        setActiveConfig(config);
        onApplyContent?.(config);
      } else {
        const response = await apiRequest("POST", "/api/ai/generate-global-filter", {
          sampleData: dataArray.slice(0, 5),
          availableKeys,
          userPrompt: input,
          currentFilter: activeFilter,
          locale: locale || "en",
          sessionContext: filterCtx,
        });
        const result = await response.json() as { function: string; description: string };
        const aiMsg: ChatMessage = {
          role: "ai",
          content: result.description || "Filter applied",
          filterFunction: result.function,
        };
        setMessages([...updatedMessages, aiMsg]);
        setActiveFilter(result.function);
        onApplyFilter?.(result.function);
      }
      scrollToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI request failed");
    } finally {
      setSending(false);
    }
  };

  const handleRemoveFilter = () => {
    setActiveFilter(undefined);
    onRemoveFilter?.();
    const sysMsg: ChatMessage = { role: "ai", content: "Filter removed. All rows are now visible." };
    setMessages((prev) => [...prev, sysMsg]);
  };

  if (dataLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === "content" ? <Table className="w-4 h-4" /> : <Filter className="w-4 h-4" />}
            <span className="text-sm font-medium text-foreground">
              {mode === "content" ? "Edit Table Content" : "Global Filter"}
            </span>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-editor">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading endpoint data...
        </div>
      </div>
    );
  }

  if (!dataLoaded) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === "content" ? <Table className="w-4 h-4" /> : <Filter className="w-4 h-4" />}
            <span className="text-sm font-medium text-foreground">
              {mode === "content" ? "Edit Table Content" : "Global Filter"}
            </span>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-editor">
            <X className="w-4 h-4" />
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">Could not load data from the endpoint.</p>
      </div>
    );
  }

  const isContentMode = mode === "content";

  return (
    <div className="space-y-3" data-testid={`table-${mode}-editor`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isContentMode ? <Table className="w-4 h-4" /> : <Filter className="w-4 h-4" />}
          <span className="text-sm font-medium text-foreground">
            {isContentMode ? "Edit Table Content" : "Global Filter"}
          </span>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-editor">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {isContentMode
          ? "Chat with AI to change which columns appear, rename them, reorder, or adjust how values are displayed. This modifies what the table shows and how it looks."
          : "Chat with AI to filter which rows appear in the table. This controls which data is visible — not how it looks. Supports region-aware filtering using the visitor's session. For example: \"Show only cohorts for the visitor's region\" or \"Filter by country\"."}
      </p>

      {isContentMode && (
        <div className="flex flex-wrap gap-1">
          {activeConfig.columns.map((col, i) => (
            <Badge key={i} variant="secondary" className="text-xs" data-testid={`badge-col-${col.key}`}>
              {col.label}
            </Badge>
          ))}
        </div>
      )}

      {!isContentMode && activeFilter && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border">
          <Filter className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          <code className="text-[10px] text-muted-foreground font-mono flex-1 truncate">
            {decodeBase64(activeFilter)}
          </code>
          <Button size="icon" variant="ghost" onClick={handleRemoveFilter} className="h-6 w-6" data-testid="button-remove-filter">
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      <PreviewTable
        config={activeConfig}
        sampleData={dataArray}
        filterFunction={!isContentMode ? activeFilter : undefined}
        filterCtx={filterCtx}
      />

      <div className="border rounded-md flex flex-col" style={{ maxHeight: "200px" }}>
        <div className="flex-1 overflow-y-auto p-2 space-y-2" data-testid="editor-chat-messages">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">
              {isContentMode
                ? (locale === "es"
                  ? 'Escribe algo como "Elimina la columna de duración" o "Renombra ubicación a campus"'
                  : 'Type something like "Remove the duration column" or "Rename location to campus"')
                : (locale === "es"
                  ? 'Escribe algo como "Muestra solo cohortes activas" o "Filtra por país US"'
                  : 'Type something like "Show only active cohorts" or "Filter by country US"')}
            </p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-md px-2.5 py-1.5 text-xs ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
                data-testid={`editor-chat-msg-${msg.role}-${i}`}
              >
                <p>{msg.content}</p>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-md px-2.5 py-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="border-t p-1.5 flex gap-1.5 items-end">
          <Textarea
            placeholder={isContentMode
              ? (locale === "es" ? "Pide cambios a las columnas..." : "Ask for column changes...")
              : (locale === "es" ? "Describe cómo filtrar los datos..." : "Describe how to filter the data...")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            className="min-h-[36px] max-h-[60px] flex-1 resize-none text-xs"
            disabled={sending}
            data-testid="input-editor-chat"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={sending || !input.trim()}
            data-testid="button-editor-chat-send"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <p className="text-[10px] text-muted-foreground">
        {locale === "es"
          ? `${availableKeys.length} campos disponibles del endpoint`
          : `${availableKeys.length} fields available from endpoint`}
      </p>
    </div>
  );
}
