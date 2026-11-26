import { useState, useEffect, useRef } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronDown, ChevronUp, ChevronsUpDown, Filter, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Location } from "@shared/session";
import { useLocationCatalog } from "@/hooks/useLocationCatalog";
import { useToast } from "@/hooks/use-toast";
import { getDebugUserName } from "@/hooks/useDebugAuth";
import {
  useVariableDefinitions,
  useVariableContext,
} from "@/hooks/useVariables";
import {
  resolveVariable,
  type VariableDefinition,
  type VariableCondition,
} from "@/lib/variable-manager";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { checkEditorHasUnsavedChanges, emitContentUpdated } from "@/lib/contentEvents";
import { normalizeContentType } from "@/hooks/useContentTypes";
import { useQuery, useMutation } from "@tanstack/react-query";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  EMPTY_METADATA_DRAFT,
  VariableMetadataFields,
  metadataDraftFrom,
  metadataDraftReady,
  metadataDraftToBody,
  type VariableMetadataDraft,
} from "@/components/editing/VariableMetadataFields";
import { variableWrite, VariableWriteError, type FigureChangeDetails } from "@/lib/variable-write";
import { MoneyValueFields } from "@/components/editing/MoneyValueFields";
import {
  isMoneyValue,
  type MoneyValue,
  type VariableValue,
  variableValueToDisplayString,
} from "@shared/variable-money";

interface VariableDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variableName: string;
  inlineDefault: string;
  mode?: "inspect" | "create";
  onCreated?: (variableName: string, templateSyntax: string) => void;
}

const QUERY_KEY_OPTIONS: { value: string; label: string }[] = [
  { value: "location", label: "Location" },
  { value: "region", label: "Region" },
  { value: "locale", label: "Locale" },
];

function getValueOptionsForKey(
  queryKey: string,
  localeOptions: { value: string; label: string }[],
  locations: Location[],
): { value: string; label: string }[] {
  if (queryKey === "location") {
    return locations
      .filter((loc) => loc.visibility === "listed")
      .map((loc) => ({ value: loc.slug, label: `${loc.name} (${loc.slug})` }));
  }
  if (queryKey === "region") {
    const regionSet = new Set(locations.map((loc) => loc.region));
    return Array.from(regionSet)
      .sort()
      .map((r) => ({ value: r, label: r }));
  }
  if (queryKey === "locale") {
    return localeOptions;
  }
  return [];
}

function formatQuery(query: Record<string, string>): string {
  return Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

function ConditionForm({
  initialQuery,
  initialValue,
  onSave,
  onCancel,
  saveLabel,
  localeOptions,
  blocked = false,
  isPrice = false,
}: {
  initialQuery?: Record<string, string>;
  initialValue?: VariableValue;
  onSave: (query: Record<string, string>, value: VariableValue) => void;
  onCancel: () => void;
  saveLabel: string;
  localeOptions: { value: string; label: string }[];
  blocked?: boolean;
  isPrice?: boolean;
}) {
  const { data: locations = [] } = useLocationCatalog();
  const [queryPairs, setQueryPairs] = useState<{ key: string; value: string }[]>(
    initialQuery
      ? Object.entries(initialQuery).map(([k, v]) => ({ key: k, value: v }))
      : [{ key: "", value: "" }],
  );
  const [conditionValue, setConditionValue] = useState<VariableValue>(
    initialValue ?? (isPrice ? { amount: 0, currency: "USD" } : ""),
  );

  const addQueryPair = () => {
    setQueryPairs((prev) => [...prev, { key: "", value: "" }]);
  };

  const removeQueryPair = (idx: number) => {
    setQueryPairs((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateQueryPair = (idx: number, field: "key" | "value", val: string) => {
    setQueryPairs((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: val } : p)),
    );
  };

  const valueOk =
    isPrice
      ? isMoneyValue(conditionValue) ||
        (typeof conditionValue === "object" &&
          conditionValue !== null &&
          typeof (conditionValue as MoneyValue).amount === "number")
      : typeof conditionValue === "string" && conditionValue.trim() !== "";
  const canSave =
    !blocked &&
    queryPairs.length > 0 &&
    queryPairs.every((p) => p.key && p.value) &&
    valueOk;

  const handleSubmit = () => {
    if (!canSave) return;
    const query: Record<string, string> = {};
    for (const p of queryPairs) {
      query[p.key] = p.value;
    }
    onSave(query, conditionValue);
  };

  return (
    <div className="space-y-3 p-3 rounded-md border bg-muted/30">
      <div className="space-y-2">
        <span className="text-sm font-medium text-foreground">Query keys</span>
        {queryPairs.map((pair, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Select
              value={pair.key}
              onValueChange={(v) => updateQueryPair(idx, "key", v)}
            >
              <SelectTrigger
                className="w-32 flex-shrink-0"
                data-testid={`select-query-key-${idx}`}
              >
                <SelectValue placeholder="Key..." />
              </SelectTrigger>
              <SelectContent>
                {QUERY_KEY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">=</span>
            {pair.key ? (
              <Select
                value={pair.value}
                onValueChange={(v) => updateQueryPair(idx, "value", v)}
              >
                <SelectTrigger
                  className="flex-1"
                  data-testid={`select-query-value-${idx}`}
                >
                  <SelectValue placeholder="Value..." />
                </SelectTrigger>
                <SelectContent>
                  {getValueOptionsForKey(pair.key, localeOptions, locations).map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                placeholder="Select key first"
                disabled
                className="flex-1"
              />
            )}
            {queryPairs.length > 1 && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeQueryPair(idx)}
                data-testid={`button-remove-query-pair-${idx}`}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={addQueryPair}
          data-testid="button-add-query-pair"
        >
          <Plus className="w-3 h-3 mr-1" />
          Add key
        </Button>
      </div>

      <div className="space-y-1">
        <span className="text-sm font-medium text-foreground">Value</span>
        {isPrice ? (
          <MoneyValueFields
            value={conditionValue}
            onChange={(m) => setConditionValue(m)}
            testIdPrefix="condition-money"
          />
        ) : (
          <Input
            value={typeof conditionValue === "string" ? conditionValue : variableValueToDisplayString(conditionValue)}
            onChange={(e) => setConditionValue(e.target.value)}
            placeholder="Resolved value when this condition matches"
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) handleSubmit();
              if (e.key === "Escape") onCancel();
            }}
            data-testid="input-condition-value"
          />
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          data-testid="button-cancel-condition"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!canSave}
          data-testid="button-save-condition"
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

export function VariableDetailModal({
  open,
  onOpenChange,
  variableName,
  inlineDefault,
  mode = "inspect",
  onCreated,
}: VariableDetailModalProps) {
  const { toast } = useToast();
  const { data: definitions, refetch } = useVariableDefinitions();
  const varContext = useVariableContext();
  const { data: localeSettingsData } = useQuery<{ default_locale: string; supported_locales: { code: string; label: string }[] }>({
    queryKey: ["/api/settings/locales"],
    staleTime: Infinity,
  });
  const localeOptions = (localeSettingsData?.supported_locales ?? [{ code: "en", label: "English" }, { code: "es", label: "Spanish" }])
    .map(l => ({ value: l.code, label: `${l.label} (${l.code})` }));
  const [activeTab, setActiveTab] = useState<"explain" | "details" | "edit" | "rename">("explain");
  const [metaDraft, setMetaDraft] = useState<VariableMetadataDraft>(EMPTY_METADATA_DRAFT);
  const [createMeta, setCreateMeta] = useState<VariableMetadataDraft>(EMPTY_METADATA_DRAFT);
  const [metaError, setMetaError] = useState<"description" | "category" | null>(null);
  const [metaSaving, setMetaSaving] = useState(false);
  const [figurePrompt, setFigurePrompt] = useState<{
    details: FigureChangeDetails;
    body: Record<string, unknown>;
    onDone: () => void;
    successTitle: string;
  } | null>(null);
  const [createName, setCreateName] = useState("");
  const [createSaving, setCreateSaving] = useState(false);
  const [currentMode, setCurrentMode] = useState(mode);
  const [createSubMode, setCreateSubMode] = useState<"new" | "existing">(
    "existing",
  );
  const [nameAvailable, setNameAvailable] = useState<boolean | null>(null);
  const nameCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [existingVarName, setExistingVarName] = useState("");
  const [inspectVarName, setInspectVarName] = useState("");
  const [varComboboxOpen, setVarComboboxOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  /** Pipe/default fallback for create mode; seeded from selection when present. */
  const [createFallback, setCreateFallback] = useState(inlineDefault);
  /** True when open without a selection-derived default — staff must type one. */
  const [askForFallback, setAskForFallback] = useState(!inlineDefault.trim());

  const [addingCondition, setAddingCondition] = useState(false);
  const [editingConditionIndex, setEditingConditionIndex] = useState<number | null>(null);
  const [editingDefault, setEditingDefault] = useState(false);
  const [editDefaultValue, setEditDefaultValue] = useState<VariableValue>("");

  const [renameTo, setRenameTo] = useState("");
  const [renameAvailable, setRenameAvailable] = useState<boolean | null>(null);
  const renameCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCurrentMode(mode);
    if (mode === "create") {
      setCreateName("");
      setCreateSaving(false);
      setCreateSubMode("existing");
      setExistingVarName("");
      setInspectVarName("");
      setNameAvailable(null);
      setCreateFallback(inlineDefault);
      setAskForFallback(!inlineDefault.trim());
      if (nameCheckTimerRef.current) clearTimeout(nameCheckTimerRef.current);
    } else if (mode === "inspect" && open) {
      setInspectVarName("");
    }
    setAddingCondition(false);
    setEditingConditionIndex(null);
    setEditingDefault(false);
    setRenameTo("");
    setRenameAvailable(null);
  }, [mode, open, inlineDefault]);

  const effectiveVarName =
    currentMode === "create"
      ? createSubMode === "existing"
        ? existingVarName
        : createName
      : inspectVarName || variableName;

  const definition = definitions?.[effectiveVarName];
  const resolution =
    definition && definitions
      ? resolveVariable(effectiveVarName, definitions, varContext)
      : null;

  const resolvedValue =
    resolution?.value || inlineDefault || effectiveVarName || "—";
  const resolvedSource =
    resolution?.source || (inlineDefault ? "inline" : "unresolved");

  const conditions = definition?.conditions || [];

  const matchedConditionIndex = (() => {
    if (resolvedSource !== "condition" || !conditions.length) return -1;
    for (let i = 0; i < conditions.length; i++) {
      const matches = Object.entries(conditions[i].query).every(([key, val]) => {
        const contextVal = (varContext as Record<string, string | undefined>)[key];
        return contextVal === val;
      });
      if (matches) return i;
    }
    return -1;
  })();

  const invalidateAndRefetch = async () => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ["/api/variables"] });
  };

  const isReservedVar = !!definition?.isReserved;
  const metadataMissing =
    !!definition && !isReservedVar && (!definition.description?.trim() || !definition.category?.trim());
  const metaReady = !metadataMissing || metadataDraftReady(metaDraft);

  useEffect(() => {
    setMetaDraft(metadataDraftFrom(definition));
    setMetaError(null);
    // Reset only when switching variables, not on every definitions refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveVarName, open]);

  useEffect(() => {
    if (open && mode === "create") setCreateMeta(EMPTY_METADATA_DRAFT);
  }, [open, mode]);

  const handleWriteError = (err: unknown, title: string): boolean => {
    if (err instanceof VariableWriteError) {
      if (err.code === "description_required" || err.code === "category_required") {
        setMetaError(err.code === "description_required" ? "description" : "category");
      }
      toast({ title, description: err.message, variant: "destructive" });
      return true;
    }
    toast({
      title,
      description: err instanceof Error ? err.message : "Unknown error",
      variant: "destructive",
    });
    return true;
  };

  /** PUT a value write; attaches missing metadata and routes figure changes through the confirm dialog. */
  const writeVariable = async (
    body: Record<string, unknown>,
    opts: { successTitle: string; failTitle: string; onDone: () => void },
  ) => {
    const payload = metadataMissing ? { ...body, metadata: metadataDraftToBody(metaDraft) } : body;
    try {
      await variableWrite("PUT", `/api/variables/${effectiveVarName}`, payload);
      await invalidateAndRefetch();
      setMetaError(null);
      opts.onDone();
      toast({ title: opts.successTitle });
    } catch (err) {
      if (err instanceof VariableWriteError && err.code === "confirm_figure_change") {
        setFigurePrompt({
          details: err.details as unknown as FigureChangeDetails,
          body: payload,
          onDone: opts.onDone,
          successTitle: opts.successTitle,
        });
        return;
      }
      handleWriteError(err, opts.failTitle);
    }
  };

  const confirmFigureChange = async () => {
    if (!figurePrompt) return;
    const { body, onDone, successTitle } = figurePrompt;
    setFigurePrompt(null);
    try {
      await variableWrite("PUT", `/api/variables/${effectiveVarName}`, { ...body, confirm_figure_change: true });
      await invalidateAndRefetch();
      onDone();
      toast({ title: successTitle });
    } catch (err) {
      handleWriteError(err, "Failed to save");
    }
  };

  const handleSaveMetadata = async () => {
    if (!metadataDraftReady(metaDraft)) {
      setMetaError(!metaDraft.description.trim() ? "description" : "category");
      return;
    }
    setMetaSaving(true);
    try {
      await variableWrite("PUT", `/api/variables/${effectiveVarName}`, {
        action: "set_metadata",
        ...metadataDraftToBody(metaDraft),
      });
      await invalidateAndRefetch();
      setMetaError(null);
      toast({ title: "Details saved" });
    } catch (err) {
      handleWriteError(err, "Failed to save details");
    } finally {
      setMetaSaving(false);
    }
  };

  const handleSetDefault = async (value: VariableValue) => {
    await writeVariable(
      { action: "set_default", value },
      { successTitle: "Default updated", failTitle: "Failed to save", onDone: () => setEditingDefault(false) },
    );
  };

  const handleAddCondition = async (query: Record<string, string>, value: VariableValue) => {
    await writeVariable(
      { action: "add_condition", condition: { query, value } },
      { successTitle: "Condition added", failTitle: "Failed to add condition", onDone: () => setAddingCondition(false) },
    );
  };

  const handleUpdateCondition = async (index: number, query: Record<string, string>, value: VariableValue) => {
    await writeVariable(
      { action: "update_condition", index, condition: { query, value } },
      {
        successTitle: "Condition updated",
        failTitle: "Failed to update condition",
        onDone: () => setEditingConditionIndex(null),
      },
    );
  };

  const handleDeleteCondition = async (index: number) => {
    try {
      await apiRequest("DELETE", `/api/variables/${effectiveVarName}`, {
        action: "delete_condition",
        index,
      });
      await invalidateAndRefetch();
      toast({ title: "Condition removed" });
    } catch (err) {
      toast({
        title: "Failed to delete condition",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleReorderCondition = async (fromIndex: number, toIndex: number) => {
    if (!metaReady) return;
    try {
      await variableWrite("PUT", `/api/variables/${effectiveVarName}`, {
        action: "reorder_conditions",
        fromIndex,
        toIndex,
        ...(metadataMissing ? { metadata: metadataDraftToBody(metaDraft) } : {}),
      });
      await invalidateAndRefetch();
    } catch (err) {
      handleWriteError(err, "Failed to reorder");
    }
  };

  const handleCreate = async () => {
    const baseName = createName.trim().replace(/\s+/g, "_").toLowerCase();
    if (!baseName) {
      toast({
        title: "Name required",
        description: "Please enter a name for the variable.",
        variant: "destructive",
      });
      return;
    }
    const fallback = createFallback.trim();
    if (!fallback) {
      toast({
        title: "Fallback required",
        description: "Enter the default text used when this variable has no match.",
        variant: "destructive",
      });
      return;
    }
    const fullName = baseName.startsWith("global.") ? baseName : `global.${baseName}`;
    if (definitions?.[fullName]) {
      toast({
        title: "Already exists",
        description: `Variable "${fullName}" already exists. Choose a different name.`,
        variant: "destructive",
      });
      return;
    }
    if (!metadataDraftReady(createMeta)) {
      setMetaError(!createMeta.description.trim() ? "description" : "category");
      toast({
        title: "Description and category required",
        description: "Agents rely on them to pick the right fact.",
        variant: "destructive",
      });
      return;
    }
    setCreateSaving(true);
    try {
      await variableWrite("PUT", `/api/variables/${fullName}`, {
        action: "set_default",
        value: fallback,
        metadata: metadataDraftToBody(createMeta),
      });
      await invalidateAndRefetch();
      const templateSyntax = `{{ ${fullName} | ${fallback} }}`;
      toast({
        title: "Variable created",
        description: `"${fullName}" is ready to use.`,
      });
      onCreated?.(fullName, templateSyntax);
      setInspectVarName(fullName);
      setCurrentMode("inspect");
    } catch (err) {
      toast({
        title: "Failed to create",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCreateSaving(false);
    }
  };

  const handleUseExisting = () => {
    if (!existingVarName) {
      toast({
        title: "Select a variable",
        description: "Please choose an existing variable.",
        variant: "destructive",
      });
      return;
    }
    const fallback = createFallback.trim();
    if (!fallback) {
      toast({
        title: "Fallback required",
        description: "Enter the default text used when this variable has no match.",
        variant: "destructive",
      });
      return;
    }
    const templateSyntax = `{{ ${existingVarName} | ${fallback} }}`;
    toast({
      title: "Variable linked",
      description: `Text will use "{{ ${existingVarName} }}".`,
    });
    onCreated?.(existingVarName, templateSyntax);
    setInspectVarName(existingVarName);
    setCurrentMode("inspect");
  };

  const existingVarNames = definitions ? Object.keys(definitions).sort() : [];

  const handleNameChange = (rawValue: string) => {
    const sanitized = rawValue.replace(/[^a-zA-Z0-9_.]/g, "_");
    setCreateName(sanitized);
    setNameAvailable(null);
    if (nameCheckTimerRef.current) clearTimeout(nameCheckTimerRef.current);
    const normalized = sanitized.trim().replace(/\s+/g, "_").toLowerCase();
    if (!normalized) {
      setNameAvailable(null);
      return;
    }
    const fullName = normalized.startsWith("global.") ? normalized : `global.${normalized}`;
    nameCheckTimerRef.current = setTimeout(() => {
      setNameAvailable(!definitions?.[fullName]);
    }, 500);
  };

  const resolvedCreateValue = (() => {
    if (createSubMode === "existing") {
      if (!existingVarName || !definitions?.[existingVarName]) return createFallback;
      const res = resolveVariable(existingVarName, definitions, varContext);
      return res?.value || createFallback || existingVarName;
    }
    const baseName = createName.trim().replace(/\s+/g, "_").toLowerCase();
    const fullName = baseName.startsWith("global.") ? baseName : `global.${baseName}`;
    if (!fullName || !definitions?.[fullName]) return createFallback;
    const res = resolveVariable(fullName, definitions, varContext);
    return res?.value || createFallback || fullName;
  })();

  const createFallbackReady = createFallback.trim().length > 0;

  const { data: usageData, isLoading: usageLoading } = useQuery<{ variable: string; files: string[] }>({
    queryKey: ["/api/variables", effectiveVarName, "usage"],
    queryFn: async () => {
      const res = await fetch(`/api/variables/${effectiveVarName}/usage`);
      if (!res.ok) throw new Error("Failed to fetch usage");
      return res.json();
    },
    enabled: currentMode === "inspect" && activeTab === "rename" && !!effectiveVarName,
  });

  const handleRenameNameChange = (rawValue: string) => {
    const sanitized = rawValue.replace(/[^a-zA-Z0-9_.]/g, "_");
    setRenameTo(sanitized);
    setRenameAvailable(null);
    if (renameCheckTimerRef.current) clearTimeout(renameCheckTimerRef.current);
    const normalized = sanitized.trim().replace(/\s+/g, "_").toLowerCase();
    if (!normalized || normalized === effectiveVarName) {
      setRenameAvailable(null);
      return;
    }
    renameCheckTimerRef.current = setTimeout(() => {
      setRenameAvailable(!definitions?.[normalized]);
    }, 400);
  };

  const renameMutation = useMutation({
    mutationFn: async (newName: string) => {
      return (await variableWrite("POST", `/api/variables/${effectiveVarName}/rename`, {
        newName,
        author: getDebugUserName(),
        ...(metadataMissing ? { metadata: metadataDraftToBody(metaDraft) } : {}),
      })) as unknown as { newName: string; updatedFiles: string[] };
    },
    onSuccess: (data: { newName: string; updatedFiles: string[] }) => {
      invalidateAndRefetch();

      for (const filePath of data.updatedFiles) {
        const match = filePath.match(
          /^4geeks-com\/([^/]+)\/([^/]+)\/([^/]+)\.\w+$/,
        );
        if (match) {
          const ct = normalizeContentType(match[1]);
          emitContentUpdated({
            contentType: ct,
            slug: match[2],
            locale: match[3],
          });
        }
      }

      toast({
        title: "Variable renamed",
        description: `Renamed to "${data.newName}". Updated ${data.updatedFiles.length} file(s).`,
      });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      handleWriteError(err, "Failed to rename");
    },
  });

  const handleRename = () => {
    const normalized = renameTo.trim().replace(/\s+/g, "_").toLowerCase();
    if (!normalized || !renameAvailable || definition?.isReserved || !metaReady) return;

    if (checkEditorHasUnsavedChanges()) {
      const confirmed = window.confirm(
        "The YAML editor has unsaved changes. Renaming this variable will refresh the page content and your unsaved edits will be lost.\n\nPlease save your changes first, or click OK to proceed anyway.",
      );
      if (!confirmed) return;
    }

    renameMutation.mutate(normalized);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={dialogRef}
        className="max-w-lg max-h-[85vh] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        data-testid="variable-detail-modal"
      >
        {currentMode === "create" ? (
          <>
            <DialogHeader>
              <DialogTitle>Convert to Variable</DialogTitle>
              <DialogDescription>
                {askForFallback
                  ? "Choose or create a variable and set its fallback value."
                  : "Replace the selected text with a variable template."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {createSubMode === "new"
                    ? "New variable name"
                    : "Select variable"}
                </label>
                <div className="flex gap-2 items-start">
                  {createSubMode === "existing" ? (
                    <div className="flex-1">
                      <Popover
                        open={varComboboxOpen}
                        onOpenChange={setVarComboboxOpen}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={varComboboxOpen}
                            className="w-full justify-between font-normal"
                            data-testid="select-existing-variable"
                          >
                            {existingVarName ? (
                              <span className="font-mono text-sm">
                                {existingVarName}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                Choose a variable...
                              </span>
                            )}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[--radix-popover-trigger-width] p-0 z-[10001]"
                          align="start"
                          container={dialogRef.current}
                        >
                          <Command>
                            <CommandInput
                              placeholder="Search variables..."
                              data-testid="input-search-variable"
                            />
                            <CommandList>
                              <CommandEmpty>No variables found.</CommandEmpty>
                              <CommandGroup>
                                {existingVarNames.map((name) => (
                                  <CommandItem
                                    key={name}
                                    value={name}
                                    onSelect={(val) => {
                                      setExistingVarName(val);
                                      setVarComboboxOpen(false);
                                    }}
                                    data-testid={`variable-option-${name}`}
                                  >
                                    <Check
                                      className={`mr-2 h-4 w-4 ${existingVarName === name ? "opacity-100" : "opacity-0"}`}
                                    />
                                    <span className="font-mono text-sm flex-1">
                                      {name}
                                    </span>
                                    {definitions?.[name]?.isReserved && (
                                      <Badge
                                        variant="secondary"
                                        className="ml-2 text-[10px] px-1.5 py-0 h-4 no-default-active-elevate pointer-events-none"
                                        data-testid={`badge-readonly-${name}`}
                                      >
                                        Read-only
                                      </Badge>
                                    )}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                  ) : (
                    <div className="flex-1 space-y-1">
                      <div className="relative">
                        <Input
                          id="var-name-input"
                          placeholder="e.g., hero_title, cta_text"
                          value={createName}
                          onChange={(e) => handleNameChange(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && nameAvailable)
                              handleCreate();
                          }}
                          className={`pr-8 font-mono ${nameAvailable === false ? "border-destructive" : nameAvailable === true ? "border-chart-3" : ""}`}
                          data-testid="input-variable-name"
                        />
                        {createName.trim() && nameAvailable !== null && (
                          <span className="absolute right-2 top-1/2 -translate-y-1/2">
                            {nameAvailable ? (
                              <Check className="h-4 w-4 text-chart-3" />
                            ) : (
                              <X className="h-4 w-4 text-destructive" />
                            )}
                          </span>
                        )}
                      </div>
                      {createName.trim() && nameAvailable === false && (
                        <p className="text-xs text-destructive">
                          This variable name is already taken
                        </p>
                      )}
                      {createName.trim() && nameAvailable === true && (
                        <p className="text-xs text-chart-3">Name available</p>
                      )}
                      {!createName.trim() && (
                        <p className="text-xs text-muted-foreground">
                          Use snake_case (letters, numbers, underscores only)
                        </p>
                      )}
                    </div>
                  )}
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      if (createSubMode === "existing") {
                        setCreateSubMode("new");
                        setCreateName("");
                        setNameAvailable(null);
                      } else {
                        setCreateSubMode("existing");
                      }
                    }}
                    data-testid="button-toggle-create-mode"
                  >
                    {createSubMode === "existing" ? (
                      <Plus className="h-4 w-4" />
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {createSubMode === "new" && (
                <div className="space-y-2 rounded-md border p-3" data-testid="create-variable-metadata">
                  <p className="text-xs text-muted-foreground">
                    Each variable is one company fact. The description tells writers and agents when to use it;
                    the category tells reviewers how carefully to check changes.
                  </p>
                  <VariableMetadataFields
                    draft={createMeta}
                    onChange={(next) => {
                      setCreateMeta(next);
                      setMetaError(null);
                    }}
                    showOptional={false}
                    errorField={metaError}
                    testIdPrefix="create-variable-meta"
                  />
                </div>
              )}

              {askForFallback ? (
                <div className="space-y-1">
                  <label
                    htmlFor="var-fallback-input"
                    className="text-sm font-medium text-foreground"
                  >
                    Fallback value
                  </label>
                  <Input
                    id="var-fallback-input"
                    value={createFallback}
                    onChange={(e) => setCreateFallback(e.target.value)}
                    placeholder="Text shown when the variable has no match"
                    data-testid="input-create-fallback"
                  />
                  <p className="text-xs text-muted-foreground">
                    Used as the variable default and as the{" "}
                    <span className="font-mono">| fallback</span> in the
                    template.
                  </p>
                  {createSubMode === "existing" &&
                    existingVarName &&
                    definitions?.[existingVarName] && (
                      <p className="text-xs text-muted-foreground pt-1">
                        For your current session (
                        {varContext.locale || "en"},{" "}
                        {varContext.region || "unknown"},{" "}
                        {varContext.location || "unknown"}), this resolves to:{" "}
                        <span className="font-medium text-foreground">
                          "{resolvedCreateValue}"
                        </span>
                      </p>
                    )}
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    Based on your current session in{" "}
                    <span className="font-medium text-foreground">
                      {varContext.locale || "en"}
                    </span>
                    ,{" "}
                    <span className="font-medium text-foreground">
                      {varContext.region || "unknown"}
                    </span>{" "}
                    and location{" "}
                    <span className="font-medium text-foreground">
                      {varContext.location || "unknown"}
                    </span>
                    , the value of this variable will be:
                  </p>
                  <div className="px-3 py-2 rounded-md bg-muted text-sm font-medium">
                    "{resolvedCreateValue}"
                  </div>
                </div>
              )}

              {((createSubMode === "new" && createName.trim()) ||
                (createSubMode === "existing" && existingVarName)) && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Preview
                  </label>
                  <div className="px-3 py-2 rounded-md bg-muted font-mono text-sm">
                    {"{{ "}
                    {createSubMode === "new"
                      ? (() => { const n = createName.trim().replace(/\s+/g, "_").toLowerCase(); return n.startsWith("global.") ? n : `global.${n}`; })()
                      : existingVarName}
                    {" | "}
                    {createFallback}
                    {" }}"}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  data-testid="button-cancel-create"
                >
                  Cancel
                </Button>
                {createSubMode === "new" ? (
                  <Button
                    onClick={handleCreate}
                    disabled={
                      createSaving ||
                      !createName.trim() ||
                      nameAvailable === false ||
                      !metadataDraftReady(createMeta) ||
                      !createFallbackReady
                    }
                    data-testid="button-confirm-create"
                  >
                    {createSaving ? "Creating..." : "Create Variable"}
                  </Button>
                ) : (
                  <Button
                    onClick={handleUseExisting}
                    disabled={!existingVarName || !createFallbackReady}
                    data-testid="button-confirm-use-existing"
                  >
                    Use Variable
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="font-mono text-sm px-2 py-1 rounded-md bg-muted">
                  {"{{ "}
                  {effectiveVarName}
                  {" }}"}
                </span>
              </DialogTitle>
              <DialogDescription>
                Currently resolves to:{" "}
                <span className="font-semibold text-foreground">
                  "{resolvedValue}"
                </span>
              </DialogDescription>
            </DialogHeader>

            <div className="flex gap-1 border-b pb-0 mb-4">
              <button
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "explain"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground"
                }`}
                onClick={() => setActiveTab("explain")}
                data-testid="tab-explain"
              >
                Why this value?
              </button>
              {!isReservedVar && definition && (
                <button
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors inline-flex items-center gap-1 ${
                    activeTab === "details"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground"
                  }`}
                  onClick={() => setActiveTab("details")}
                  data-testid="tab-details"
                >
                  Details
                  {metadataMissing && <AlertTriangle className="w-3 h-3 text-destructive" aria-label="Missing details" />}
                </button>
              )}
              <button
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "edit"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground"
                }`}
                onClick={() => setActiveTab("edit")}
                data-testid="tab-edit"
              >
                Edit values
              </button>
              <button
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "rename"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground"
                }`}
                onClick={() => setActiveTab("rename")}
                data-testid="tab-rename"
              >
                Rename
              </button>
            </div>

            {activeTab === "explain" && (
              <div className="space-y-2" data-testid="explain-tab-content">
                <p className="text-sm text-muted-foreground mb-3">
                  The system checks each condition in order. The first match wins:
                </p>

                <div className="space-y-2">
                  {conditions.map((cond, i) => {
                    const isMatched = i === matchedConditionIndex;
                    const isPastMatch = matchedConditionIndex >= 0 && i > matchedConditionIndex;

                    return (
                      <div key={i}>
                        {i > 0 && (
                          <div className="flex items-center justify-center py-1">
                            <ArrowRight className="w-3 h-3 text-muted-foreground/40 rotate-90" />
                          </div>
                        )}
                        <div
                          className={`rounded-md overflow-visible px-3 py-2 ${
                            isMatched
                              ? "bg-primary/10 border border-primary/30"
                              : isPastMatch
                                ? "opacity-50"
                                : "bg-muted/50"
                          }`}
                          data-testid={`condition-chain-${i}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                              {isMatched ? (
                                <Check className="w-4 h-4 text-primary" />
                              ) : isPastMatch ? (
                                <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                              ) : (
                                <X className="w-4 h-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {Object.entries(cond.query).map(([k, v]) => (
                                  <Badge key={k} variant="secondary">
                                    {k}={v}
                                  </Badge>
                                ))}
                              </div>
                              <div className="text-sm mt-1">
                                <span className="text-muted-foreground/60">&rarr;</span>{" "}
                                <span className={isMatched ? "font-medium text-foreground" : "text-muted-foreground"}>
                                  "{variableValueToDisplayString(cond.value)}"
                                </span>
                              </div>
                            </div>
                            {isMatched && (
                              <Badge variant="default" className="flex-shrink-0">
                                Active
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {conditions.length > 0 && (
                    <div className="flex items-center justify-center py-1">
                      <ArrowRight className="w-3 h-3 text-muted-foreground/40 rotate-90" />
                    </div>
                  )}

                  <div
                    className={`rounded-md overflow-visible px-3 py-2 ${
                      resolvedSource === "default"
                        ? "bg-primary/10 border border-primary/30"
                        : matchedConditionIndex >= 0
                          ? "opacity-50"
                          : "bg-muted/50"
                    }`}
                    data-testid="condition-chain-default"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                        {resolvedSource === "default" ? (
                          <Check className="w-4 h-4 text-primary" />
                        ) : matchedConditionIndex >= 0 ? (
                          <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                        ) : (
                          <X className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">Default</span>
                        {definition?.default !== undefined ? (
                          <div className="text-sm mt-1">
                            <span className="text-muted-foreground/60">&rarr;</span>{" "}
                            <span className={resolvedSource === "default" ? "font-medium text-foreground" : "text-muted-foreground"}>
                              "{variableValueToDisplayString(definition.default)}"
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground/60 italic ml-2">
                            Not set
                          </span>
                        )}
                      </div>
                      {resolvedSource === "default" && (
                        <Badge variant="default" className="flex-shrink-0">
                          Active
                        </Badge>
                      )}
                    </div>
                  </div>

                  {inlineDefault && (
                    <>
                      <div className="flex items-center justify-center py-1">
                        <ArrowRight className="w-3 h-3 text-muted-foreground/40 rotate-90" />
                      </div>
                      <div
                        className={`rounded-md overflow-visible px-3 py-2 ${
                          resolvedSource === "inline"
                            ? "bg-primary/10 border border-primary/30"
                            : "opacity-50"
                        }`}
                        data-testid="condition-chain-inline"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                            {resolvedSource === "inline" ? (
                              <Check className="w-4 h-4 text-primary" />
                            ) : (
                              <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium">Inline Default</span>
                            <div className="text-sm mt-1">
                              <span className="text-muted-foreground/60">&rarr;</span>{" "}
                              <span className={resolvedSource === "inline" ? "font-medium text-foreground" : "text-muted-foreground"}>
                                "{inlineDefault}"
                              </span>
                            </div>
                          </div>
                          {resolvedSource === "inline" && (
                            <Badge variant="default" className="flex-shrink-0">
                              Active
                            </Badge>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="mt-4 p-3 rounded-md bg-muted/50 text-xs text-muted-foreground">
                  <p>
                    <span className="font-medium">Your context:</span> Location=
                    {varContext.location || "none"}, Region=
                    {varContext.region || "none"}, Locale=
                    {varContext.locale || "none"}
                  </p>
                </div>
              </div>
            )}

            {activeTab === "details" && definition && !isReservedVar && (
              <div className="space-y-4" data-testid="details-tab-content">
                <VariableMetadataFields
                  draft={metaDraft}
                  onChange={(next) => {
                    setMetaDraft(next);
                    setMetaError(null);
                  }}
                  replacementOptions={existingVarNames.filter(
                    (n) => n !== effectiveVarName && n.startsWith("global.") && !definitions?.[n]?.deprecated,
                  )}
                  errorField={metaError}
                />
                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveMetadata}
                    disabled={metaSaving || !metadataDraftReady(metaDraft)}
                    data-testid="button-save-variable-details"
                  >
                    {metaSaving ? "Saving..." : "Save details"}
                  </Button>
                </div>
              </div>
            )}

            {(activeTab === "edit" || activeTab === "rename") && metadataMissing && (
              <div
                className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 mb-4"
                data-testid="variable-required-metadata"
              >
                <p className="text-sm text-foreground">
                  Add a description and category before saving. Agents rely on them to pick the right fact.
                </p>
                <VariableMetadataFields
                  draft={metaDraft}
                  onChange={(next) => {
                    setMetaDraft(next);
                    setMetaError(null);
                  }}
                  showOptional={false}
                  errorField={metaError}
                  testIdPrefix="required-variable-meta"
                />
              </div>
            )}

            {activeTab === "edit" && (
              <div className="space-y-4" data-testid="edit-tab-content">
                {definition?.isReserved && (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" data-testid="reserved-variable-notice">
                    <span className="text-xs">Managed in <strong>Settings → Legal</strong>. Editing is disabled here.</span>
                  </div>
                )}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-foreground">Default Value</h4>
                  {!definition?.isReserved && editingDefault ? (
                    <div className="space-y-2">
                      {definition?.category === "price" ? (
                        <MoneyValueFields
                          value={editDefaultValue}
                          onChange={setEditDefaultValue}
                          testIdPrefix="default-money"
                        />
                      ) : (
                        <Input
                          value={typeof editDefaultValue === "string" ? editDefaultValue : variableValueToDisplayString(editDefaultValue)}
                          onChange={(e) => setEditDefaultValue(e.target.value)}
                          className="flex-1"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && metaReady) handleSetDefault(editDefaultValue);
                            if (e.key === "Escape") setEditingDefault(false);
                          }}
                          data-testid="input-edit-default"
                        />
                      )}
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleSetDefault(editDefaultValue)}
                          disabled={!metaReady}
                          data-testid="button-save-default"
                        >
                          <Check className="w-3.5 h-3.5 text-primary" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditingDefault(false)}
                          data-testid="button-cancel-default"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm flex-1 truncate">
                        {definition?.default !== undefined ? (
                          `"${variableValueToDisplayString(definition.default)}"`
                        ) : (
                          <span className="text-muted-foreground/60 italic">Not set</span>
                        )}
                      </span>
                      {!definition?.isReserved && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setEditDefaultValue(
                              definition?.default ??
                                (definition?.category === "price"
                                  ? { amount: 0, currency: "USD" }
                                  : ""),
                            );
                            setEditingDefault(true);
                          }}
                          data-testid="button-edit-default"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                      Conditions
                    </h4>
                    {!definition?.isReserved && !addingCondition && editingConditionIndex === null && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAddingCondition(true)}
                        data-testid="button-add-condition"
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Add Condition
                      </Button>
                    )}
                  </div>

                  {conditions.length === 0 && !addingCondition && (
                    <p className="text-sm text-muted-foreground/60 italic py-1">
                      No conditions defined. The default value will always be used.
                    </p>
                  )}

                  {conditions.map((cond, i) => (
                    <div key={i}>
                      {editingConditionIndex === i ? (
                        <ConditionForm
                          initialQuery={cond.query}
                          initialValue={cond.value}
                          onSave={(query, value) => handleUpdateCondition(i, query, value)}
                          onCancel={() => setEditingConditionIndex(null)}
                          saveLabel="Update"
                          localeOptions={localeOptions}
                          blocked={!metaReady}
                          isPrice={definition?.category === "price"}
                        />
                      ) : (
                        <div
                          className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-muted/30"
                          data-testid={`condition-row-${i}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {Object.entries(cond.query).map(([k, v]) => (
                                <Badge key={k} variant="secondary">
                                  {k}={v}
                                </Badge>
                              ))}
                              <span className="text-muted-foreground/60">&rarr;</span>
                              <span className="text-sm truncate">
                                &quot;{variableValueToDisplayString(cond.value)}&quot;
                              </span>
                            </div>
                          </div>
                          {!definition?.isReserved && (
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              <Button
                                size="icon"
                                variant="ghost"
                                disabled={i === 0 || !metaReady}
                                onClick={() => handleReorderCondition(i, i - 1)}
                                data-testid={`button-move-up-${i}`}
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                disabled={i === conditions.length - 1 || !metaReady}
                                onClick={() => handleReorderCondition(i, i + 1)}
                                data-testid={`button-move-down-${i}`}
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setEditingConditionIndex(i)}
                                data-testid={`button-edit-condition-${i}`}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleDeleteCondition(i)}
                                data-testid={`button-delete-condition-${i}`}
                              >
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {addingCondition && (
                    <ConditionForm
                      onSave={handleAddCondition}
                      onCancel={() => setAddingCondition(false)}
                      saveLabel="Add"
                      localeOptions={localeOptions}
                      blocked={!metaReady}
                      isPrice={definition?.category === "price"}
                    />
                  )}
                </div>
              </div>
            )}

            {activeTab === "rename" && (
              <div className="space-y-4" data-testid="rename-tab-content">
                {definition?.isReserved && (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="reserved-rename-notice">
                    Reserved variables cannot be renamed. They are managed in <strong>Settings → Legal</strong>.
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    New variable name
                  </label>
                  <div className="relative">
                    <Input
                      placeholder="e.g., hero_title, cta_text"
                      value={renameTo}
                      onChange={(e) => handleRenameNameChange(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && renameAvailable && !definition?.isReserved) handleRename();
                      }}
                      className={`pr-8 font-mono ${renameAvailable === false ? "border-destructive" : renameAvailable === true ? "border-chart-3" : ""}`}
                      data-testid="input-rename-variable"
                    />
                    {renameTo.trim() && renameAvailable !== null && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2">
                        {renameAvailable ? (
                          <Check className="h-4 w-4 text-chart-3" />
                        ) : (
                          <X className="h-4 w-4 text-destructive" />
                        )}
                      </span>
                    )}
                  </div>
                  {renameTo.trim() && renameAvailable === false && (
                    <p className="text-xs text-destructive">
                      This variable name is already taken
                    </p>
                  )}
                  {renameTo.trim() && renameAvailable === true && (
                    <p className="text-xs text-chart-3">Name available</p>
                  )}
                  {!renameTo.trim() && (
                    <p className="text-xs text-muted-foreground">
                      Use snake_case (letters, numbers, underscores only)
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-foreground">
                    Files that will be updated
                  </h4>
                  {usageLoading ? (
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  ) : usageData?.files && usageData.files.length > 0 ? (
                    <div className="rounded-md border bg-muted/30 p-2 space-y-1 max-h-40 overflow-y-auto">
                      {usageData.files.map((file) => (
                        <div
                          key={file}
                          className="text-xs font-mono text-muted-foreground truncate"
                          data-testid={`usage-file-${file}`}
                        >
                          {file}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground/60 italic">
                      No YAML files reference this variable.
                    </p>
                  )}
                  {usageData?.files && usageData.files.length > 0 && (
                    <div className="flex items-start gap-2 p-2 rounded-md bg-muted/50 text-xs text-muted-foreground">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>
                        All {"{{"} {effectiveVarName} {"}} "}
                        references in {usageData.files.length} file(s) will be renamed to{" "}
                        {"{{"} {renameTo.trim().replace(/\s+/g, "_").toLowerCase() || "..."} {"}}"}.
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setActiveTab("explain")}
                    data-testid="button-cancel-rename"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleRename}
                    disabled={
                      !!definition?.isReserved ||
                      !metaReady ||
                      !renameTo.trim() ||
                      renameAvailable !== true ||
                      renameMutation.isPending
                    }
                    data-testid="button-confirm-rename"
                  >
                    {renameMutation.isPending ? "Renaming..." : "Rename Variable"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
      <AlertDialog open={!!figurePrompt} onOpenChange={(o) => !o && setFigurePrompt(null)}>
        <AlertDialogContent data-testid="dialog-confirm-figure-change">
          <AlertDialogHeader>
            <AlertDialogTitle>Change this figure?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This value appears on {figurePrompt?.details.usage_count ?? 0} page
                  {figurePrompt?.details.usage_count === 1 ? "" : "s"}. Visitors see the new value as soon as you save.
                </p>
                {figurePrompt?.details.condition && (
                  <p className="text-xs text-muted-foreground">
                    Applies when {formatQuery(figurePrompt.details.condition)}.
                  </p>
                )}
                <div className="rounded-md border bg-muted/30 p-2 space-y-1">
                  <p>
                    <span className="text-muted-foreground">Old: </span>
                    <span className="font-medium text-foreground">
                      {figurePrompt?.details.old_value ?? "(none)"}
                    </span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">New: </span>
                    <span className="font-medium text-foreground">{figurePrompt?.details.new_value}</span>
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-figure-change">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmFigureChange()} data-testid="button-confirm-figure-change">
              Save new value
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
