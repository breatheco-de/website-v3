import { useState, useRef } from "react";
import { AlertTriangle, Check, Loader2, Plus, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { expandMappedFields, getPickerSample, buildPickerMappedFields } from "./expandMappedFields";

interface FieldValidationResult {
  valid: boolean;
  total: number;
  found: number;
  missing: { slug: string; files: string[] }[];
}

interface AvailableProperties {
  common: string[];
  partial: { key: string; count: number; total: number }[];
}

type FieldMappingValue = string | { source: string; default?: string | null };

/** Normalize field_mapping entries that may be `{ source, default }` objects. */
function mappingSourceString(value: FieldMappingValue | undefined): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof value.source === "string") return value.source;
  return "";
}

interface SingleVariablePickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: string;
  inlineDefault: string;
  /** Current page's single bag — used for live sample values next to each field. */
  singleEntry?: Record<string, unknown>;
  onCreated: (variableName: string, templateSyntax: string) => void;
}

export function SingleVariablePickerModal({
  open,
  onOpenChange,
  contentType,
  inlineDefault,
  singleEntry,
  onCreated,
}: SingleVariablePickerModalProps) {
  const [search, setSearch] = useState("");
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [validation, setValidation] = useState<FieldValidationResult | "loading" | null>(null);
  const requestCounter = useRef(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldSource, setNewFieldSource] = useState("");
  const [addingSaving, setAddingSaving] = useState(false);
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [newFieldUnique, setNewFieldUnique] = useState(false);

  const { data: typeConfig, refetch: refetchConfig } = useQuery<{
    name: string;
    label: string;
    field_mapping?: Record<string, FieldMappingValue>;
    unique_fields?: string[];
    database?: { slug?: string };
  }>({
    queryKey: [`/api/content-types/${contentType}/config`],
    enabled: open && !!contentType,
  });

  // Full property inventory (including nested paths under mapped object fields).
  const { data: availableProps } = useQuery<AvailableProperties>({
    queryKey: [`/api/content-types/${contentType}/available-properties`],
    queryFn: () => fetch(`/api/content-types/${contentType}/available-properties`).then(r => r.json()),
    enabled: open && !!contentType,
  });

  const isDbBacked = !!typeConfig?.database?.slug;
  const fieldMapping = typeConfig?.field_mapping || {};
  // Include system aliases (`slug` from `_slug`, etc.) so staff can pick {{ single.slug }}.
  const mappedFields = buildPickerMappedFields(fieldMapping);

  const fields = expandMappedFields(mappedFields, availableProps, singleEntry);

  const filteredFields = (() => {
    if (!search.trim()) return fields;
    const q = search.toLowerCase();
    return fields.filter(
      (f) =>
        f.key.toLowerCase().includes(q) ||
        f.source.toLowerCase().includes(q),
    );
  })();

  const mappedSources = new Set(
    mappedFields.map((f) => f.source).filter((s) => s && !s.startsWith("function:")),
  );

  const filteredAvailableProps = (() => {
    if (!availableProps) return { common: [], partial: [] };
    const unmapped = {
      common: availableProps.common.filter((k) => !mappedSources.has(k)),
      partial: availableProps.partial.filter((p) => !mappedSources.has(p.key)),
    };
    const q = newFieldSource.toLowerCase().trim();
    if (!q) return unmapped;
    return {
      common: unmapped.common.filter(k => k.toLowerCase().includes(q)),
      partial: unmapped.partial.filter(p => p.key.toLowerCase().includes(q)),
    };
  })();

  const validateField = (source: string) => {
    if (isDbBacked || !source) {
      setValidation(null);
      return;
    }
    const reqId = ++requestCounter.current;
    setValidation("loading");
    fetch(`/api/content-types/${contentType}/validate-field?source=${encodeURIComponent(source)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((result: FieldValidationResult | null) => {
        if (requestCounter.current !== reqId) return;
        setValidation(result);
      })
      .catch(() => {
        if (requestCounter.current !== reqId) return;
        setValidation(null);
      });
  };

  const handleSelectField = (key: string) => {
    setSelectedField(key);
    const field = fields.find((f) => f.key === key);
    if (field) {
      const source = field.source.startsWith("function:") ? null : field.source;
      if (source) {
        validateField(source);
      } else {
        setValidation(null);
      }
    }
  };

  const selectedOption = selectedField
    ? fields.find((f) => f.key === selectedField) ?? null
    : null;

  const handleUseField = () => {
    if (!selectedField) return;
    const templateSyntax = `{{ single.${selectedField} | ${inlineDefault} }}`;
    onCreated(`single.${selectedField}`, templateSyntax);
    setSelectedField(null);
    setSearch("");
    setValidation(null);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setSelectedField(null);
      setSearch("");
      setValidation(null);
      setShowAddForm(false);
      setNewFieldName("");
      setNewFieldSource("");
      setNewFieldUnique(false);
    }
    onOpenChange(o);
  };

  const handleAddField = async () => {
    const key = newFieldName.trim();
    const source = newFieldSource.trim() || key;
    if (!key) return;

    setAddingSaving(true);
    try {
      const currentMapping = { ...fieldMapping };
      currentMapping[key] = source;

      const currentUnique = typeConfig?.unique_fields ?? ["slug"];
      const newUniqueFields = newFieldUnique && !currentUnique.includes(key)
        ? [...currentUnique, key]
        : currentUnique;

      const res = await fetch(`/api/content-types/${contentType}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field_mapping: currentMapping, unique_fields: newUniqueFields }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("Failed to add field mapping:", data);
        setAddingSaving(false);
        return;
      }

      queryClient.invalidateQueries({ queryKey: [`/api/content-types/${contentType}/config`] });
      queryClient.invalidateQueries({ queryKey: [`/api/content-types/${contentType}/available-properties`] });

      await refetchConfig();

      setShowAddForm(false);
      setNewFieldName("");
      setNewFieldSource("");
      setNewFieldUnique(false);
      setSelectedField(key);
      validateField(source);
    } catch (err) {
      console.error("Error adding field:", err);
    } finally {
      setAddingSaving(false);
    }
  };

  const label = typeConfig?.label || contentType;
  const validationWarning = !isDbBacked && validation && validation !== "loading" && !validation.valid ? validation : null;
  const canAdd = newFieldName.trim() && !(newFieldName.trim() in fieldMapping);
  const selectedSourceLabel = selectedOption?.source || selectedField || "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-md max-h-[85vh] overflow-y-auto"
        data-testid="single-variable-picker-modal"
      >
        <DialogHeader>
          <DialogTitle>Select {label} field</DialogTitle>
          <DialogDescription>
            Choose a field from the {label.toLowerCase()} entry to insert into
            the template.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search fields..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
                data-testid="input-search-single-fields"
              />
            </div>
            {!isDbBacked && (
              <Button
                variant={showAddForm ? "default" : "outline"}
                size="icon"
                onClick={() => {
                  setShowAddForm(!showAddForm);
                  if (showAddForm) {
                    setNewFieldName("");
                    setNewFieldSource("");
                    setSourceDropdownOpen(false);
                  }
                }}
                data-testid="button-add-new-field"
              >
                {showAddForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              </Button>
            )}
          </div>

          {showAddForm && (
            <div className="border rounded-md p-3 space-y-2 bg-muted/30" data-testid="add-field-form">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Source property</label>
                <div className="relative">
                  <Input
                    value={newFieldSource}
                    onChange={(e) => {
                      setNewFieldSource(e.target.value);
                      setSourceDropdownOpen(true);
                    }}
                    onFocus={() => setSourceDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setSourceDropdownOpen(false), 150)}
                    placeholder="e.g. meta.title"
                    className="text-sm font-mono"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canAdd) handleAddField();
                      if (e.key === "Escape") {
                        if (sourceDropdownOpen) { setSourceDropdownOpen(false); e.stopPropagation(); }
                        else setShowAddForm(false);
                      }
                    }}
                    data-testid="input-new-field-source"
                  />
                  {sourceDropdownOpen && availableProps && (filteredAvailableProps.common.length > 0 || filteredAvailableProps.partial.length > 0) && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 border rounded-md bg-popover shadow-md max-h-[180px] overflow-y-auto" data-testid="source-dropdown">
                      {filteredAvailableProps.common.map((key) => (
                        <button
                          key={key}
                          type="button"
                          className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm hover-elevate border-b last:border-b-0"
                          onClick={() => {
                            setNewFieldSource(key);
                            setSourceDropdownOpen(false);
                            if (!newFieldName.trim()) {
                              const lastPart = key.split(".").pop() || key;
                              setNewFieldName(lastPart);
                            }
                          }}
                          data-testid={`source-option-${key}`}
                        >
                          <Check className="w-3 h-3 text-green-600 flex-shrink-0" />
                          <span className="font-mono text-xs">{key}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto">all entries</span>
                        </button>
                      ))}
                      {filteredAvailableProps.partial.map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          disabled
                          className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm opacity-50 cursor-not-allowed border-b last:border-b-0"
                          data-testid={`source-option-${p.key}`}
                        >
                          <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                          <span className="font-mono text-xs">{p.key}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto">{p.count}/{p.total}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Field name</label>
                <Input
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  placeholder="e.g. title"
                  className="text-sm font-mono"
                  onKeyDown={(e) => { if (e.key === "Enter" && canAdd) handleAddField(); if (e.key === "Escape") setShowAddForm(false); }}
                  data-testid="input-new-field-name"
                />
                {newFieldName.trim() && newFieldName.trim() in fieldMapping && (
                  <p className="text-[11px] text-destructive">Field "{newFieldName.trim()}" already exists</p>
                )}
              </div>
              <div className="flex items-center gap-2 pt-0.5" data-testid="row-new-field-unique">
                <Checkbox
                  id="new-field-unique"
                  checked={newFieldUnique}
                  onCheckedChange={(checked) => setNewFieldUnique(!!checked)}
                  data-testid="checkbox-new-field-unique"
                />
                <label htmlFor="new-field-unique" className="text-[11px] text-muted-foreground cursor-pointer select-none">
                  Mark as unique — will prompt for a new value on duplication
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setShowAddForm(false); setNewFieldName(""); setNewFieldSource(""); setNewFieldUnique(false); }}
                  data-testid="button-cancel-add-field"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleAddField}
                  disabled={!canAdd || addingSaving}
                  data-testid="button-confirm-add-field"
                >
                  {addingSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                  Add Field
                </Button>
              </div>
            </div>
          )}

          <div className="border rounded-md max-h-[280px] overflow-y-auto" data-testid="single-fields-list">
            {filteredFields.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground" data-testid="text-no-fields">
                No fields found
              </div>
            ) : (
              filteredFields.map((field) => {
                const sample = getPickerSample(singleEntry, field.key);
                return (
                <button
                  key={field.key}
                  type="button"
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 border-b last:border-b-0 transition-colors ${
                    field.isNested ? "pl-7" : ""
                  } ${
                    selectedField === field.key
                      ? "bg-primary/5"
                      : "hover-elevate"
                  }`}
                  onClick={() => handleSelectField(field.key)}
                  data-testid={`single-field-option-${field.key}`}
                >
                  <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                    {selectedField === field.key && (
                      <Check className="w-4 h-4 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-sm font-mono font-medium text-foreground shrink-0">
                      {field.key}
                    </span>
                    {field.isObject && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                        object
                      </span>
                    )}
                    {field.isSystemAlias && !field.isObject && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                        system
                      </span>
                    )}
                    {sample ? (
                      <span
                        className="text-[10px] text-muted-foreground truncate min-w-0"
                        title={sample}
                        data-testid={`single-field-sample-${field.key}`}
                      >
                        {sample}
                      </span>
                    ) : field.source && field.source !== field.key ? (
                      <span className="text-xs text-muted-foreground truncate min-w-0">
                        {field.source}
                      </span>
                    ) : null}
                  </div>
                  {selectedField === field.key && !isDbBacked && (
                    <div className="flex-shrink-0">
                      {validation === "loading" && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                      )}
                      {validation && validation !== "loading" && validation.valid && (
                        <Check className="w-3.5 h-3.5 text-green-600" />
                      )}
                      {validation && validation !== "loading" && !validation.valid && (
                        <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                      )}
                    </div>
                  )}
                </button>
                );
              })
            )}
          </div>

          {validationWarning && selectedField && (
            <div className="text-[11px] text-destructive space-y-1" data-testid="text-single-validation-warning">
              <p>
                Source property "<span className="font-mono font-medium">{selectedSourceLabel}</span>" was not found in {validationWarning.found === 0 ? "any" : "some"} content {validationWarning.total === 1 ? "entry" : "entries"}.
                {" "}{validationWarning.found === 0 ? "None" : `Only ${validationWarning.found}`} of {validationWarning.total} {validationWarning.total === 1 ? "entry has" : "entries have"} this property.
              </p>
              {validationWarning.missing.length > 0 && (
                <>
                  <p className="text-muted-foreground">Missing in:</p>
                  <ul className="list-none space-y-0.5">
                    {validationWarning.missing.slice(0, 3).map((entry) => (
                      <li key={entry.slug}>
                        <span className="font-medium">{entry.slug}/</span>
                        {" "}
                        <span className="font-mono text-muted-foreground">
                          {entry.files.map((f) => f.replace(/^4geeks-com\//, "")).join(" or ")}
                        </span>
                      </li>
                    ))}
                    {validationWarning.missing.length > 3 && (
                      <li className="text-muted-foreground">+{validationWarning.missing.length - 3} more {validationWarning.missing.length - 3 === 1 ? "entry" : "entries"}</li>
                    )}
                  </ul>
                </>
              )}
            </div>
          )}

          {selectedField && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">
                Preview
              </label>
              <div className="px-3 py-2 rounded-md bg-muted font-mono text-sm" data-testid="text-single-preview">
                {"{{ "}single.{selectedField}{" | "}{inlineDefault}{" }}"}
              </div>
              {selectedOption?.isObject && (
                <p className="text-[11px] text-muted-foreground" data-testid="text-object-field-hint">
                  This field is an object. Use it when a component expects the whole value; for text (badge, label, URL), pick a nested property instead.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              data-testid="button-single-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUseField}
              disabled={!selectedField}
              data-testid="button-single-use-field"
            >
              Use Field
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
