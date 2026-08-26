import { useState, useEffect, useMemo } from "react";
import { AlertTriangle, Check, ChevronDown, Copy, Info, Pencil, Plus, RefreshCw, Trash2, Undo2, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { buildContentUrlFromPattern, listExtraUrlPatternParams } from "@/lib/locale";
import { useContentTypes, useContentTypesRaw } from "@/hooks/useContentTypes";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import { isSharedLayoutType } from "@/lib/sharedLayoutEntry";
import type { ContentTypeValue, SlugCheckStatus, SitemapUrl } from "../types";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface CreateContentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  duplicatingPage: {
    loc: string;
    label: string;
    contentType: string;
    locale?: string;
    sourceSlug?: string;
    isDraft?: boolean;
  } | null;
  createContentType: ContentTypeValue;
  setCreateContentType: (v: ContentTypeValue) => void;
  createContentTitle: string;
  setCreateContentTitle: (v: string) => void;
  createContentSlugEn: string;
  setCreateContentSlugEn: (v: string) => void;
  createContentSlugEs: string;
  setCreateContentSlugEs: (v: string) => void;
  createContentSlugEnStatus: SlugCheckStatus;
  setCreateContentSlugEnStatus: (v: SlugCheckStatus) => void;
  createContentSlugEsStatus: SlugCheckStatus;
  setCreateContentSlugEsStatus: (v: SlugCheckStatus) => void;
  slugEnConflictReason: string | null;
  setSlugEnConflictReason: (v: string | null) => void;
  slugEsConflictReason: string | null;
  setSlugEsConflictReason: (v: string | null) => void;
  editingSlugEn: boolean;
  setEditingSlugEn: (v: boolean) => void;
  editingSlugEs: boolean;
  setEditingSlugEs: (v: boolean) => void;
  isCreatingContent: boolean;
  setIsCreatingContent: (v: boolean) => void;
  setSitemapUrls: (v: SitemapUrl[]) => void;
  setSitemapLoading: (v: boolean) => void;
  setDuplicatingPage: (v: any) => void;
  toast: any;
}

interface LocaleSetting {
  code: string;
  label: string;
}

interface LocaleSettingsResponse {
  default_locale: string;
  supported_locales: LocaleSetting[];
}

interface EntryFieldsResponse {
  slug: string | null;
  title: string | null;
  fields: Record<string, string | boolean | number | null>;
  computed: string[];
}

interface ContentTypeConfig {
  field_mapping?: Record<string, string | { source: string }>;
  unique_fields?: string[];
}

function humanizeField(field: string): string {
  const map: Record<string, string> = {
    bc_slug: "Breathecode Slug",
    job_role: "Job Role",
    country: "Country",
    country_code: "Country Code",
    city: "City",
    region: "Region",
    timezone: "Timezone",
    category: "Category",
  };
  return map[field] ?? field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function slugifyParamValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

interface UrlParamOptionsResponse {
  params: string[];
  options: Record<string, string[]>;
  optionsByLocale?: Record<string, Record<string, string[]>>;
  shapes: Record<string, "object_slug" | "string">;
}

function UrlParamCombobox({
  param,
  locale,
  value,
  options,
  onChange,
  portalContainer,
}: {
  param: string;
  locale: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
  portalContainer?: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  const filtered = options.filter((opt) =>
    !value ? true : opt.toLowerCase().includes(value.toLowerCase()),
  );
  const showCreate =
    !!value && !options.some((opt) => opt.toLowerCase() === value.toLowerCase());

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono text-muted-foreground w-8 shrink-0 text-right">
        {locale}
      </span>
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            className="flex-1 flex items-center gap-1 px-2 py-1 text-xs font-mono rounded-md border bg-background text-left hover-elevate focus:outline-none focus:ring-1 focus:ring-ring"
            data-testid={`combobox-url-param-${param}-${locale}`}
          >
            <span className={cn("flex-1 truncate", !value && "text-muted-foreground")}>
              {value || `Select or type ${humanizeField(param).toLowerCase()}…`}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0 z-[10001] pointer-events-auto"
          align="start"
          container={portalContainer}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <Command shouldFilter={false}>
            <div className="flex items-center border-b px-2">
              <input
                value={value}
                onChange={(e) => onChange(slugifyParamValue(e.target.value))}
                placeholder={`Search or create…`}
                className="flex h-8 w-full bg-transparent py-2 text-xs font-mono outline-none placeholder:text-muted-foreground"
                data-testid={`input-url-param-${param}-${locale}`}
                autoFocus
              />
            </div>
            <CommandList>
              <CommandEmpty className="py-2 text-xs text-muted-foreground">
                {value ? `Press to use “${value}”` : "Type a value…"}
              </CommandEmpty>
              <CommandGroup>
                {showCreate && (
                  <CommandItem
                    value={`create-${value}`}
                    onSelect={() => {
                      onChange(value);
                      setOpen(false);
                    }}
                    data-testid={`option-url-param-create-${param}-${locale}`}
                  >
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    <span className="font-mono text-xs">Use “{value}”</span>
                  </CommandItem>
                )}
                {filtered.map((opt) => (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                    data-testid={`option-url-param-${param}-${locale}-${opt}`}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-3.5 w-3.5",
                        value === opt ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="font-mono text-xs">{opt}</span>
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

type TokenType = "keyword" | "string" | "number" | "comment" | "operator" | "plain";
interface Token { text: string; type: TokenType }

const TOKEN_RE = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b(?:const|let|var|return|if|else|function|true|false|null|undefined|typeof|instanceof|new|this|for|while|do|break|continue|switch|case|default)\b)|(\d+(?:\.\d+)?)|([=!<>|&?:+\-*/%,;.[\](){}]+)/g;

function tokenClass(type: TokenType): string {
  switch (type) {
    case "keyword":  return "text-blue-500 dark:text-blue-400";
    case "string":   return "text-green-600 dark:text-green-400";
    case "number":   return "text-orange-400 dark:text-orange-300";
    case "comment":  return "text-muted-foreground italic";
    case "operator": return "text-foreground/60";
    default:         return "text-foreground";
  }
}

function highlightJS(code: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(code)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ text: code.slice(lastIndex, m.index), type: "plain" });
    }
    const [full, comment, str, keyword, num] = m;
    if (comment)  tokens.push({ text: full, type: "comment" });
    else if (str) tokens.push({ text: full, type: "string" });
    else if (keyword) tokens.push({ text: full, type: "keyword" });
    else if (num) tokens.push({ text: full, type: "number" });
    else          tokens.push({ text: full, type: "operator" });
    lastIndex = TOKEN_RE.lastIndex;
  }
  if (lastIndex < code.length) {
    tokens.push({ text: code.slice(lastIndex), type: "plain" });
  }
  return tokens;
}

function prettifyJS(raw: string): string {
  const code = raw.trim();
  let result = "";
  let indent = 0;
  let inStr: string | null = null;
  let i = 0;
  const pad = () => "  ".repeat(indent);

  while (i < code.length) {
    const ch = code[i];

    if (inStr) {
      result += ch;
      if (ch === "\\" && i + 1 < code.length) {
        i++;
        result += code[i];
      } else if (ch === inStr) {
        inStr = null;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      result += ch;
      i++;
      continue;
    }

    if (ch === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i);
      const comment = end === -1 ? code.slice(i) : code.slice(i, end);
      result += comment;
      i += comment.length;
      continue;
    }

    if (ch === "{") {
      indent++;
      result += " {\n" + pad();
      i++;
      while (i < code.length && code[i] === " ") i++;
      continue;
    }

    if (ch === "}") {
      indent = Math.max(0, indent - 1);
      result = result.trimEnd();
      result += "\n" + pad() + "}";
      i++;
      if (code[i] === ";") { result += ";"; i++; }
      result += "\n" + pad();
      while (i < code.length && code[i] === " ") i++;
      continue;
    }

    if (ch === ";") {
      result += ";\n" + pad();
      i++;
      while (i < code.length && code[i] === " ") i++;
      continue;
    }

    result += ch;
    i++;
  }

  return result.trim();
}

function FunctionCodePopover({ rawCode }: { rawCode: string }) {
  const [open, setOpen] = useState(false);
  const js = (() => {
    try {
      return atob(rawCode.slice("function:".length));
    } catch {
      return rawCode;
    }
  })();
  const pretty = prettifyJS(js);
  const tokens = highlightJS(pretty);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground hover-elevate rounded p-0.5 flex-shrink-0"
          title="View calculation formula"
          data-testid="button-function-info"
        >
          <Info className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 z-[10001]" align="end">
        <p className="text-[10px] text-muted-foreground mb-2 font-medium uppercase tracking-wide">
          Calculated by
        </p>
        <pre className="text-[11px] leading-relaxed bg-muted rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap break-words font-mono">
          <code>
            {tokens.map((tok, i) => (
              <span key={i} className={tokenClass(tok.type)}>{tok.text}</span>
            ))}
          </code>
        </pre>
      </PopoverContent>
    </Popover>
  );
}

export function CreateContentModal({
  open,
  onOpenChange,
  duplicatingPage,
  createContentType,
  setCreateContentType,
  createContentTitle,
  setCreateContentTitle,
  createContentSlugEn,
  setCreateContentSlugEn,
  createContentSlugEs,
  setCreateContentSlugEs,
  createContentSlugEnStatus,
  setCreateContentSlugEnStatus,
  createContentSlugEsStatus,
  setCreateContentSlugEsStatus,
  slugEnConflictReason,
  setSlugEnConflictReason,
  slugEsConflictReason,
  setSlugEsConflictReason,
  editingSlugEn,
  setEditingSlugEn,
  editingSlugEs,
  setEditingSlugEs,
  isCreatingContent,
  setIsCreatingContent,
  setSitemapUrls,
  setSitemapLoading,
  setDuplicatingPage,
  toast,
}: CreateContentModalProps) {
  const [showFiles, setShowFiles] = useState(false);
  const [excludedLocales, setExcludedLocales] = useState<Set<string>>(new Set());
  const [showAllLocales, setShowAllLocales] = useState(false);
  const [agnosticLocale, setAgnosticLocale] = useState<string | null>(null);
  const [showTypeChangeDetails, setShowTypeChangeDetails] = useState(false);
  const [uniqueFieldValues, setUniqueFieldValues] = useState<Record<string, string>>({});
  // locale → param → value (URL params like :category may differ per locale)
  const [urlParamValues, setUrlParamValues] = useState<Record<string, Record<string, string>>>({});
  const [localeTitles, setLocaleTitles] = useState<Record<string, string>>({});
  const [manualTitleLocales, setManualTitleLocales] = useState<Set<string>>(new Set());

  const [step, setStep] = useState<1 | 2>(1);
  const [nonUniqueValues, setNonUniqueValues] = useState<Record<string, string | boolean>>({});
  const [showNonUnique, setShowNonUnique] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [exampleOpen, setExampleOpen] = useState(false);
  const [dialogPortalEl, setDialogPortalEl] = useState<HTMLDivElement | null>(null);
  const [showWhyOneLanguage, setShowWhyOneLanguage] = useState(false);
  const [showWhenTranslation, setShowWhenTranslation] = useState(false);
  const [showSharedLayoutCreateAdvanced, setShowSharedLayoutCreateAdvanced] = useState(false);

  const contentTypesMap = useContentTypes();
  const { data: rawContentTypes } = useContentTypesRaw();

  const { data: localeSettings } = useQuery<LocaleSettingsResponse>({
    queryKey: ["/api/settings/locales"],
  });

  const supportedLocales: LocaleSetting[] = localeSettings?.supported_locales ?? [
    { code: "en", label: "English" },
    { code: "es", label: "Spanish" },
  ];

  const loc0 = supportedLocales[0]?.code ?? "en";
  const loc1 = supportedLocales[1]?.code ?? "es";
  const defaultLocaleCode = localeSettings?.default_locale ?? loc0;

  useEffect(() => {
    const typeMeta = rawContentTypes?.find((ct) => ct.name === createContentType);
    const isShared = isSharedLayoutType(typeMeta);
    const pattern = contentTypesMap?.[createContentType]?.url_pattern;
    const isAgnostic = !!pattern?.["default"] && !pattern?.[loc0] && !pattern?.[loc1];
    const forceSingle = isShared || isAgnostic;

    if (!forceSingle) {
      setExcludedLocales(new Set());
      return;
    }

    let chosen: string | null = null;
    if (duplicatingPage) {
      chosen = duplicatingPage.locale ?? null;
      if (!chosen) {
        for (const loc of supportedLocales) {
          if (duplicatingPage.loc.includes(`/${loc.code}/`)) {
            chosen = loc.code;
            break;
          }
        }
      }
    }
    chosen = chosen || defaultLocaleCode;
    setAgnosticLocale(chosen);
    setExcludedLocales(
      new Set(supportedLocales.map((l) => l.code).filter((c) => c !== chosen)),
    );
  }, [duplicatingPage, localeSettings, contentTypesMap, createContentType, rawContentTypes, loc0, loc1, defaultLocaleCode]);

  const isTypeChanged = !!(duplicatingPage && createContentType !== duplicatingPage.contentType);

  const creatableTypes = !rawContentTypes ? [] : rawContentTypes.filter((ct) => !ct.has_database);

  const urlPattern = contentTypesMap?.[createContentType]?.url_pattern;
  const urlParams = useMemo(
    () => listExtraUrlPatternParams(urlPattern),
    [urlPattern],
  );

  const { data: urlParamOptionsData } = useQuery<UrlParamOptionsResponse>({
    queryKey: ["/api/content-types", createContentType, "url-param-options"],
    queryFn: () =>
      fetch(`/api/content-types/${createContentType}/url-param-options`).then((r) => r.json()),
    enabled: open && urlParams.length > 0,
    staleTime: 60000,
  });

  useEffect(() => {
    setUrlParamValues({});
  }, [createContentType]);

  // Prefill URL params when duplicating by matching the source URL against the pattern
  useEffect(() => {
    if (!open || !duplicatingPage || urlParams.length === 0 || !urlPattern) return;
    const path = duplicatingPage.loc.split("?")[0].replace(/\/$/, "") || "/";
    const locale =
      duplicatingPage.locale ||
      supportedLocales.find((l) => path.includes(`/${l.code}/`))?.code ||
      loc0;
    const pattern =
      urlPattern[locale] || urlPattern["default"] || urlPattern["en"] || Object.values(urlPattern)[0];
    if (!pattern) return;

    const keys: string[] = [];
    const built = pattern
      .split(/(:[a-zA-Z_]+)/g)
      .map((part) => {
        if (/^:[a-zA-Z_]+$/.test(part)) {
          keys.push(part.slice(1));
          return "([^/]+)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    const match = path.match(new RegExp(`^${built}/?$`));
    if (!match) return;
    const extracted: Record<string, string> = {};
    keys.forEach((key, i) => {
      if (key === "slug" || key === "locale") return;
      const val = match[i + 1];
      if (val) extracted[key] = slugifyParamValue(decodeURIComponent(val));
    });
    if (Object.keys(extracted).length === 0) return;
    setUrlParamValues((prev) => {
      const forLocale = { ...(prev[locale] ?? {}) };
      let changed = false;
      for (const [k, v] of Object.entries(extracted)) {
        if (!forLocale[k]) {
          forLocale[k] = v;
          changed = true;
        }
      }
      return changed ? { ...prev, [locale]: forLocale } : prev;
    });
  }, [open, duplicatingPage, urlParams, urlPattern, supportedLocales, loc0]);

  const selectedTypeData = rawContentTypes?.find((ct) => ct.name === createContentType);
  const isSharedLayoutCreate = isSharedLayoutType(selectedTypeData);
  const isLocaleAgnosticPattern =
    !!urlPattern?.["default"] && !urlPattern?.[loc0] && !urlPattern?.[loc1];
  /** All content types: one locale at create; add translations via translate_entry. */
  const forceSingleLocaleCreate = true;

  const sourceSlug = (() => {
    if (!duplicatingPage) return undefined;
    if (duplicatingPage.sourceSlug) return duplicatingPage.sourceSlug;
    try {
      const pathname = new URL(duplicatingPage.loc, window.location.origin).pathname;
      const previewMatch = pathname.match(/^\/private\/preview\/[^/]+\/([^/]+)\/?$/);
      if (previewMatch) return previewMatch[1];
      const parts = pathname.replace(/\/$/, "").split("/").filter(Boolean);
      return parts[parts.length - 1] ?? undefined;
    } catch {
      const parts = duplicatingPage.loc.replace(/\/$/, "").split("/").filter(Boolean);
      const last = parts[parts.length - 1] ?? undefined;
      return last?.split("?")[0];
    }
  })();

  const sourceLocale = (() => {
    if (!duplicatingPage) return undefined;
    if (duplicatingPage.locale) return duplicatingPage.locale;
    for (const loc of supportedLocales) {
      if (duplicatingPage.loc.includes(`/${loc.code}/`)) return loc.code;
    }
    return undefined;
  })();

  const primaryLocale = agnosticLocale ?? (sourceLocale ?? defaultLocaleCode);
  const effectiveSingleLocale = agnosticLocale ?? primaryLocale;
  const isLocaleVisible = (loc: string) => {
    if (forceSingleLocaleCreate) return loc === effectiveSingleLocale;
    return true;
  };

  const slugsConflict =
    forceSingleLocaleCreate &&
    !excludedLocales.has(loc0) &&
    !excludedLocales.has(loc1) &&
    isLocaleVisible(loc0) &&
    isLocaleVisible(loc1) &&
    !!createContentSlugEn &&
    createContentSlugEn === createContentSlugEs;

  const extraUniqueFields = (() => {
    const unique = selectedTypeData?.unique_fields ?? ["slug"];
    return unique.filter((f) => f !== "slug" && f !== "title" && f !== "locale");
  })();

  const hasStep2 = extraUniqueFields.length > 0;

  const { data: typeConfig } = useQuery<ContentTypeConfig>({
    queryKey: ["/api/content-types", createContentType, "config"],
    queryFn: () => fetch(`/api/content-types/${createContentType}/config`).then((r) => r.json()),
    enabled: open && hasStep2,
    staleTime: 60000,
  });

  const { editableNonUniqueFields, computedFields } = useMemo(() => {
    const fm = typeConfig?.field_mapping ?? {};
    const uniqueSet = new Set(selectedTypeData?.unique_fields ?? ["slug"]);
    const skip = new Set(["slug", "title", "locale"]);
    const editable: string[] = [];
    const computed: Array<{ key: string; rawCode: string }> = [];
    for (const [key, val] of Object.entries(fm)) {
      if (key.startsWith("_")) continue;
      if (skip.has(key)) continue;
      if (uniqueSet.has(key)) continue;
      const rawVal = typeof val === "string" ? val : (val as { source?: string })?.source ?? "";
      if (typeof rawVal === "string" && rawVal.startsWith("function:")) {
        computed.push({ key, rawCode: rawVal });
      } else {
        editable.push(key);
      }
    }
    return { editableNonUniqueFields: editable, computedFields: computed };
  }, [typeConfig, selectedTypeData]);

  const { data: exampleData, isLoading: exampleLoading } = useQuery<EntryFieldsResponse>({
    queryKey: ["/api/content-types", createContentType, "entry-fields"],
    queryFn: () => fetch(`/api/content-types/${createContentType}/entry-fields`).then((r) => r.json()),
    enabled: open && hasStep2,
    staleTime: 60000,
  });

  const { data: sourceData } = useQuery<EntryFieldsResponse>({
    queryKey: ["/api/content-types", createContentType, "entry-fields", sourceSlug, sourceLocale],
    queryFn: () =>
      fetch(
        `/api/content-types/${createContentType}/entry-fields?slug=${sourceSlug}${sourceLocale ? `&locale=${sourceLocale}` : ""}`
      ).then((r) => r.json()),
    enabled: open && !!duplicatingPage && hasStep2 && !!sourceSlug,
    staleTime: 60000,
  });

  useEffect(() => {
    if (!sourceData?.fields) return;
    const prefill: Record<string, string | boolean> = {};
    for (const key of editableNonUniqueFields) {
      const val = sourceData.fields[key];
      if (val != null) {
        if (typeof val === "boolean") {
          prefill[key] = val;
        } else {
          prefill[key] = String(val);
        }
      }
    }
    setNonUniqueValues(prefill);
  }, [sourceData]);

  useEffect(() => {
    if (!exampleData?.fields) return;
    setNonUniqueValues((prev) => {
      const updated = { ...prev };
      for (const key of editableNonUniqueFields) {
        const val = exampleData.fields[key];
        if (typeof val === "boolean" && updated[key] === undefined) {
          updated[key] = true;
        }
      }
      return updated;
    });
  }, [exampleData, editableNonUniqueFields]);

  const checkSlug = (type: string, slug: string, locale: string | null, onStatus: (s: SlugCheckStatus) => void, onReason: (r: string | null) => void) => {
    const url = locale
      ? `/api/content/check-slug?type=${type}&slug=${slug}&locale=${locale}`
      : `/api/content/check-slug?type=${type}&slug=${slug}`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        onStatus(data.available ? "available" : "taken");
        onReason(
          data.available
            ? null
            : data.reason === "redirect_conflict"
            ? `Conflicts with redirect: ${data.conflictUrl} → ${data.redirectTo}`
            : null
        );
      })
      .catch(() => {
        onStatus("idle");
        onReason(null);
      });
  };

  const handleClose = (openVal: boolean) => {
    onOpenChange(openVal);
    if (!openVal) {
      setCreateContentTitle("");
      setCreateContentSlugEn("");
      setCreateContentSlugEs("");
      setCreateContentSlugEnStatus("idle");
      setCreateContentSlugEsStatus("idle");
      setSlugEnConflictReason(null);
      setSlugEsConflictReason(null);
      setEditingSlugEn(false);
      setEditingSlugEs(false);
      setCreateContentType("page");
      setDuplicatingPage(null);
      setExcludedLocales(new Set());
      setShowAllLocales(false);
      setAgnosticLocale(null);
      setShowTypeChangeDetails(false);
      setUniqueFieldValues({});
      setUrlParamValues({});
      setStep(1);
      setNonUniqueValues({});
      setShowNonUnique(false);
      setExampleOpen(false);
      setLocaleTitles({});
      setManualTitleLocales(new Set());
      setShowWhyOneLanguage(false);
      setShowWhenTranslation(false);
      setShowSharedLayoutCreateAdvanced(false);
    }
  };

  const slugsReady = (() => {
    const loc0Needed = !excludedLocales.has(loc0) && isLocaleVisible(loc0);
    const loc1Needed = !excludedLocales.has(loc1) && isLocaleVisible(loc1);
    if (!loc0Needed && !loc1Needed) return false;
    if (loc0Needed && (!createContentSlugEn || createContentSlugEnStatus !== "available")) return false;
    if (loc1Needed && (!createContentSlugEs || createContentSlugEsStatus !== "available")) return false;
    if (slugsConflict) return false;
    return true;
  })();

  const uniqueFieldsFilled = extraUniqueFields.every((f) => !!uniqueFieldValues[f]);
  const activeParamLocales = supportedLocales
    .map((l) => l.code)
    .filter((c) => isLocaleVisible(c) && !excludedLocales.has(c));
  const urlParamsFilled = urlParams.every((p) =>
    activeParamLocales.every((loc) => !!urlParamValues[loc]?.[p]?.trim()),
  );

  const handleConfirm = async () => {
    if (!slugsReady) return;
    if (!uniqueFieldsFilled) return;
    if (!urlParamsFilled) return;

    setCreateError(null);
    setIsCreatingContent(true);
    try {
      const token = getDebugToken();
      const author = await resolveAuthorName();
      const allFieldValues = { ...uniqueFieldValues, ...nonUniqueValues };
      const response = await fetch("/api/content/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify({
          type: createContentType,
          slugEn: (excludedLocales.has(loc0) || !isLocaleVisible(loc0)) ? undefined : createContentSlugEn,
          slugEs: (excludedLocales.has(loc1) || !isLocaleVisible(loc1)) ? undefined : createContentSlugEs,
          title: createContentTitle || localeTitles[effectiveSingleLocale] || createContentSlugEn || createContentSlugEs,
          ...(author ? { author } : {}),
          ...(duplicatingPage
            ? (duplicatingPage.sourceSlug
                ? { sourceSlug: duplicatingPage.sourceSlug, sourceType: duplicatingPage.contentType }
                : { sourceUrl: duplicatingPage.loc })
            : {}),
          ...(() => {
            const skipped = new Set(excludedLocales);
            supportedLocales.forEach((l) => { if (!isLocaleVisible(l.code)) skipped.add(l.code); });
            return skipped.size > 0 ? { skipLocales: Array.from(skipped) } : {};
          })(),
          ...(isTypeChanged ? { changeContentType: true } : {}),
          ...(Object.keys(allFieldValues).length > 0 ? { uniqueFieldValues: allFieldValues } : {}),
          ...(urlParams.length > 0 ? { urlParamValues } : {}),
          ...(() => {
            const extra = Object.fromEntries(
              Object.entries(localeTitles).filter(
                ([loc, t]) => loc !== loc0 && t && t !== createContentTitle,
              ),
            );
            return Object.keys(extra).length > 0 ? { localeTitles: extra } : {};
          })(),
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const pattern = contentTypesMap?.[createContentType]?.url_pattern;
        const loc0Active = !excludedLocales.has(loc0) && isLocaleVisible(loc0);
        const activeSlug = loc0Active ? createContentSlugEn : createContentSlugEs;
        const activeLocaleCode = loc0Active ? loc0 : loc1;
        const isDraft = data.status === "draft";
        const previewPath =
          typeof data.previewPath === "string"
            ? data.previewPath
            : isDraft
              ? `/private/preview/${createContentType}/${activeSlug}?variant=${encodeURIComponent(data.draftVariant || "draft")}&locale=${activeLocaleCode}`
              : null;
        const newUrl = previewPath
          || buildContentUrlFromPattern(pattern, activeSlug, activeLocaleCode, urlParamValues[activeLocaleCode]);
        const cleared = Array.isArray(data.clearedFields) ? data.clearedFields as Array<{ path?: string; sectionType?: string }> : [];
        const clearedHint =
          cleared.length > 0
            ? ` Cleared ${cleared.length} conversion/ecommerce field(s) (e.g. ${cleared
                .slice(0, 3)
                .map((c) => `${c.sectionType || "section"}.${c.path}`)
                .join(", ")}). Re-set them before save/publish.`
            : "";
        toast({
          title: duplicatingPage
            ? (isDraft ? "Draft duplicated" : "Page duplicated")
            : (isDraft ? "Draft created" : "Content created"),
          description: (isDraft
            ? `Unpublished draft ready — publish from Page Versions when ready. Preview: ${newUrl}`
            : duplicatingPage
              ? `Created copy at ${newUrl}`
              : `Created new ${createContentType} at ${newUrl}`) + clearedHint,
        });
        onOpenChange(false);
        setCreateContentTitle("");
        setCreateContentSlugEn("");
        setCreateContentSlugEs("");
        setCreateContentSlugEnStatus("idle");
        setCreateContentSlugEsStatus("idle");
        setSlugEnConflictReason(null);
        setSlugEsConflictReason(null);
        setDuplicatingPage(null);
        setUniqueFieldValues({});
        setUrlParamValues({});
        setStep(1);
        setNonUniqueValues({});
        setLocaleTitles({});
        setManualTitleLocales(new Set());

        if (!isDraft) {
          setSitemapLoading(true);
          const sitemapRes = await fetch("/api/debug/sitemap-urls");
          if (sitemapRes.ok) {
            const urls = await sitemapRes.json();
            setSitemapUrls(urls);
          }
          setSitemapLoading(false);
        }

        window.location.href = newUrl;
      } else {
        setCreateError(data.error || "An error occurred");
      }
    } catch (error) {
      console.error("Error creating content:", error);
      setCreateError("Network error — please try again");
    } finally {
      setIsCreatingContent(false);
    }
  };

  const confirmButtonLabel = isCreatingContent ? (
    <>
      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
      {duplicatingPage ? "Duplicating..." : "Creating..."}
    </>
  ) : duplicatingPage ? (
    <>
      <Copy className="h-4 w-4 mr-2" />
      Duplicate {createContentType.charAt(0).toUpperCase() + createContentType.slice(1)}
    </>
  ) : (
    <>
      <Plus className="h-4 w-4 mr-2" />
      Create {createContentType.charAt(0).toUpperCase() + createContentType.slice(1)}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent ref={setDialogPortalEl} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {duplicatingPage ? (
              <>
                <Copy className="h-5 w-5" />
                Duplicate Page
              </>
            ) : (
              <>
                <Plus className="h-5 w-5" />
                Create New Content
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {duplicatingPage ? (
              <>Duplicating: <strong>{duplicatingPage.label}</strong></>
            ) : (
              <>Create a new content entry with starter YAML files.</>
            )}
          </DialogDescription>
          {hasStep2 && (
            <p className="text-xs text-muted-foreground mt-1">Step {step} of 2</p>
          )}
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 py-4 overflow-y-auto max-h-[60vh] pr-1">
            <div className="space-y-2">
              <label className="text-sm font-medium">Content Type</label>
              <Select
                value={createContentType}
                onValueChange={(v) => {
                  setCreateContentType(v);
                  setExcludedLocales(new Set());
                  setAgnosticLocale(null);
                  if (createContentSlugEn) {
                    setCreateContentSlugEnStatus("checking");
                    checkSlug(v, createContentSlugEn, loc0, setCreateContentSlugEnStatus, setSlugEnConflictReason);
                  }
                  if (createContentSlugEs) {
                    setCreateContentSlugEsStatus("checking");
                    checkSlug(v, createContentSlugEs, loc1, setCreateContentSlugEsStatus, setSlugEsConflictReason);
                  }
                }}
              >
                <SelectTrigger data-testid="select-content-type" className="w-full">
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  {creatableTypes.map((ct) => (
                    <SelectItem key={ct.name} value={ct.name}>
                      {ct.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isTypeChanged && (
              <div className="flex gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs" data-testid="warning-type-change">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-1">
                  <p className="text-amber-800 dark:text-amber-200">
                    This will change the content type from <strong>{duplicatingPage!.contentType}</strong> to <strong>{createContentType}</strong>.
                  </p>
                  <p className="text-amber-700 dark:text-amber-300">
                    Some content-type-specific data will be automatically converted.
                  </p>
                  <button
                    type="button"
                    className="text-amber-700 dark:text-amber-300 underline hover:no-underline font-medium"
                    onClick={() => setShowTypeChangeDetails(true)}
                    data-testid="button-read-more-type-change"
                  >
                    Read more
                  </button>
                </div>
              </div>
            )}

            {(() => {
              const loc0Excluded = excludedLocales.has(loc0);
              const loc1Excluded = excludedLocales.has(loc1);
              const visibleLocales = supportedLocales.map((l) => l.code).filter((l) => isLocaleVisible(l));
              const activeLocales = visibleLocales.filter((l) => !excludedLocales.has(l));
              const activeCount = activeLocales.length;
              const isLastActive = activeCount <= 1;
              const toggleLocale = (locale: string) => {
                setExcludedLocales((prev) => {
                  const next = new Set(prev);
                  if (next.has(locale)) {
                    next.delete(locale);
                  } else {
                    next.add(locale);
                  }
                  return next;
                });
              };
              const deriveSlug = (t: string) =>
                t.toLowerCase().trim()
                  .replace(/[^a-z0-9\s-]/g, "")
                  .replace(/\s+/g, "-")
                  .replace(/-+/g, "-")
                  .replace(/^-|-$/g, "");

              return (
                <div className="space-y-3 p-3 bg-muted/50 rounded-md">
                  {forceSingleLocaleCreate && supportedLocales.length > 1 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        This {createContentType.charAt(0).toUpperCase() + createContentType.slice(1)} will be in (choose one):
                      </p>
                      <div className="flex gap-1">
                        {supportedLocales.map((loc) => (
                          <button
                            key={loc.code}
                            type="button"
                            onClick={() => {
                              setAgnosticLocale(loc.code);
                              setExcludedLocales(new Set(supportedLocales.map(l => l.code).filter(c => c !== loc.code)));
                              setCreateContentTitle("");
                              setCreateContentSlugEn("");
                              setCreateContentSlugEs("");
                              setCreateContentSlugEnStatus("idle");
                              setCreateContentSlugEsStatus("idle");
                              setSlugEnConflictReason(null);
                              setSlugEsConflictReason(null);
                              setLocaleTitles({});
                              setManualTitleLocales(new Set());
                            }}
                            className={`px-3 py-1 text-xs rounded border ${
                              effectiveSingleLocale === loc.code
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background text-muted-foreground border-border hover-elevate"
                            }`}
                            data-testid={`button-locale-${loc.code}`}
                          >
                            {loc.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {isSharedLayoutCreate && (
                    <div className="space-y-1.5 text-xs text-muted-foreground" data-testid="text-shared-layout-create-education">
                      <div>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400 hover:underline"
                          onClick={() => setShowWhyOneLanguage((v) => !v)}
                          aria-expanded={showWhyOneLanguage}
                          data-testid="button-toggle-why-one-language"
                        >
                          Why only one language?
                          <ChevronDown
                            className={`h-3.5 w-3.5 transition-transform ${showWhyOneLanguage ? "rotate-180" : ""}`}
                          />
                        </button>
                        {showWhyOneLanguage && (
                          <div className="mt-1.5 space-y-1.5 pl-0.5">
                            <p>
                              Content types with a shared template (like Blog) do not use draft-first create.
                              The entry is published immediately, so you can only create{" "}
                              <strong className="text-foreground font-medium">one language at a time</strong>.
                              Adding a second language here would put an empty public page online.
                            </p>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400 hover:underline"
                              onClick={() => setShowSharedLayoutCreateAdvanced((v) => !v)}
                              data-testid="button-toggle-shared-layout-create-advanced"
                            >
                              {showSharedLayoutCreateAdvanced ? "Hide advanced details" : "Read more (advanced)"}
                              <ChevronDown
                                className={`h-3.5 w-3.5 transition-transform ${showSharedLayoutCreateAdvanced ? "rotate-180" : ""}`}
                              />
                            </button>
                            {showSharedLayoutCreateAdvanced && (
                              <div className="space-y-1.5 text-[11px]">
                                <p>
                                  Gate: <code className="text-[11px]">server/content-editor.ts</code> (
                                  <code className="text-[11px]">createContentEntry</code>
                                  ). Shared-layout stays live-on-create (
                                  <code className="text-[11px]">server/draft-entry.ts</code>{" "}
                                  <code className="text-[11px]">usesDraftFirstCreate</code>
                                  ).
                                </p>
                                <p>
                                  Later translations: DebugBubble Detach → MCP{" "}
                                  <code className="text-[11px]">translate_page</code> →{" "}
                                  <code className="text-[11px]">draft.{"{locale}"}.yml</code> → promote/publish. See{" "}
                                  <code className="text-[11px]">mcp-server/explain/content_system.md</code>.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400 hover:underline"
                          onClick={() => setShowWhenTranslation((v) => !v)}
                          aria-expanded={showWhenTranslation}
                          data-testid="button-toggle-when-translation"
                        >
                          When can you add a translation?
                          <ChevronDown
                            className={`h-3.5 w-3.5 transition-transform ${showWhenTranslation ? "rotate-180" : ""}`}
                          />
                        </button>
                        {showWhenTranslation && (
                          <p className="mt-1.5 pl-0.5">
                            After this first locale exists and has real content: open the page, detach it from the shared template if it is still attached, then add the new language as a draft and promote it when the translation is ready.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {!forceSingleLocaleCreate && visibleLocales.length > 1 && excludedLocales.size > 0 && (
                    <p className="text-[11px] text-muted-foreground" data-testid="text-skipped-locale-hint">
                      Skipped locales are not created.
                    </p>
                  )}
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      {visibleLocales.length > 1 && !forceSingleLocaleCreate
                        ? "Titles per locale:"
                        : `Title in ${supportedLocales.find((l) => l.code === visibleLocales[0])?.label ?? visibleLocales[0]}:`}
                    </p>
                    {visibleLocales.map((loc) => (
                      <div key={loc} className={`flex items-center gap-2 transition-opacity ${excludedLocales.has(loc) ? "opacity-40" : ""}`}>
                        {visibleLocales.length > 1 && (
                          <span className="text-xs font-mono text-muted-foreground w-8 shrink-0 text-right">{loc}</span>
                        )}
                        {excludedLocales.has(loc) ? (
                          <input
                            type="text"
                            value={loc === loc0 ? createContentTitle : (localeTitles[loc] ?? "")}
                            disabled
                            className="flex-1 px-2 py-1 text-xs rounded border bg-background line-through text-muted-foreground cursor-not-allowed"
                            data-testid={`input-title-${loc}`}
                          />
                        ) : loc === primaryLocale ? (
                          <input
                            type="text"
                            value={loc === loc0 ? createContentTitle : (localeTitles[loc] ?? createContentTitle)}
                            onChange={(e) => {
                              const title = e.target.value;
                              setCreateContentTitle(title);
                              if (loc !== loc0) setLocaleTitles((prev) => ({ ...prev, [loc]: title }));
                              const slug = deriveSlug(title);
                              if (loc === loc0) {
                                setCreateContentSlugEn(slug);
                                if (!manualTitleLocales.has(loc1)) setCreateContentSlugEs(slug);
                              } else if (loc === loc1) {
                                setCreateContentSlugEs(slug);
                                if (!manualTitleLocales.has(loc0)) setCreateContentSlugEn(slug);
                              }
                              setLocaleTitles((prev) => {
                                const next = { ...prev };
                                for (const l of supportedLocales.map((s) => s.code).filter((c) => c !== loc)) {
                                  if (!manualTitleLocales.has(l)) next[l] = title;
                                }
                                return next;
                              });
                              if (slug) {
                                if (loc === loc0 || !manualTitleLocales.has(loc0)) {
                                  setCreateContentSlugEnStatus("checking");
                                  checkSlug(createContentType, slug, loc0, setCreateContentSlugEnStatus, setSlugEnConflictReason);
                                }
                                if ((loc === loc1 || !manualTitleLocales.has(loc1)) && !excludedLocales.has(loc1) && isLocaleVisible(loc1)) {
                                  setCreateContentSlugEsStatus("checking");
                                  checkSlug(createContentType, slug, loc1, setCreateContentSlugEsStatus, setSlugEsConflictReason);
                                }
                              } else {
                                if (loc === loc0 || !manualTitleLocales.has(loc0)) {
                                  setCreateContentSlugEnStatus("idle");
                                  setSlugEnConflictReason(null);
                                }
                                if (loc === loc1 || !manualTitleLocales.has(loc1)) {
                                  setCreateContentSlugEsStatus("idle");
                                  setSlugEsConflictReason(null);
                                }
                              }
                            }}
                            placeholder="e.g., Career Development Guide"
                            className="flex-1 px-2 py-1 text-xs rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                            data-testid={`input-title-${loc}`}
                          />
                        ) : (
                          <input
                            type="text"
                            value={localeTitles[loc] ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setLocaleTitles((prev) => ({ ...prev, [loc]: val }));
                              setManualTitleLocales((prev) => new Set(prev).add(loc));
                              const slug = deriveSlug(val);
                              if (loc === loc0) {
                                setCreateContentSlugEn(slug);
                                if (slug) {
                                  setCreateContentSlugEnStatus("checking");
                                  checkSlug(createContentType, slug, loc, setCreateContentSlugEnStatus, setSlugEnConflictReason);
                                } else {
                                  setCreateContentSlugEnStatus("idle");
                                  setSlugEnConflictReason(null);
                                }
                              } else if (loc === loc1) {
                                setCreateContentSlugEs(slug);
                                if (slug) {
                                  setCreateContentSlugEsStatus("checking");
                                  checkSlug(createContentType, slug, loc, setCreateContentSlugEsStatus, setSlugEsConflictReason);
                                } else {
                                  setCreateContentSlugEsStatus("idle");
                                  setSlugEsConflictReason(null);
                                }
                              }
                            }}
                            placeholder={createContentTitle || "Title"}
                            className="flex-1 px-2 py-1 text-xs rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                            data-testid={`input-title-${loc}`}
                          />
                        )}
                        {visibleLocales.length > 1 && (
                          <button
                            type="button"
                            onClick={() => toggleLocale(loc)}
                            disabled={!excludedLocales.has(loc) && isLastActive}
                            className="p-1 rounded hover-elevate disabled:opacity-30 disabled:cursor-not-allowed"
                            title={
                              excludedLocales.has(loc)
                                ? `Restore ${supportedLocales.find((l) => l.code === loc)?.label ?? loc}`
                                : `Skip ${supportedLocales.find((l) => l.code === loc)?.label ?? loc}`
                            }
                            data-testid={`button-toggle-locale-${loc}`}
                          >
                            {excludedLocales.has(loc) ? (
                              <Undo2 className="h-3 w-3 text-muted-foreground" />
                            ) : (
                              <Trash2 className="h-3 w-3 text-muted-foreground" />
                            )}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>


                  {(isLocaleVisible(loc0) ? createContentSlugEn : createContentSlugEs) && (
                    <>
                      {urlParams.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            URL pattern fields are saved on each language file (<code className="text-[11px]">en.yml</code> /{" "}
                            <code className="text-[11px]">es.yml</code>), not on <code className="text-[11px]">_common.yml</code>.
                            Pick a slug used by peers in that language.
                          </p>
                          {urlParams.map((param) => (
                            <div key={param} className="space-y-1.5">
                              <p className="text-xs font-medium text-muted-foreground">
                                {humanizeField(param)} per locale (required for URL):
                              </p>
                              {activeLocales.map((loc) => (
                                <UrlParamCombobox
                                  key={loc}
                                  param={param}
                                  locale={loc}
                                  value={urlParamValues[loc]?.[param] ?? ""}
                                  options={
                                    urlParamOptionsData?.optionsByLocale?.[param]?.[loc] ??
                                    urlParamOptionsData?.options?.[param] ??
                                    []
                                  }
                                  portalContainer={dialogPortalEl}
                                  onChange={(next) => {
                                    setUrlParamValues((prev) => ({
                                      ...prev,
                                      [loc]: { ...(prev[loc] ?? {}), [param]: next },
                                    }));
                                    setCreateError(null);
                                  }}
                                />
                              ))}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">URLs that will be created:</p>

                        {isLocaleVisible(loc0) && !loc0Excluded && (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-muted-foreground w-8 shrink-0 text-right">{loc0}</span>
                              {editingSlugEn ? (
                                <div className="flex-1 flex items-center gap-1">
                                  <span className="text-xs font-mono text-muted-foreground">
                                    {buildContentUrlFromPattern(contentTypesMap?.[createContentType]?.url_pattern, "", loc0, urlParamValues[loc0]).replace(/\/$/, "")}/
                                  </span>
                                  <input
                                    type="text"
                                    value={createContentSlugEn}
                                    onChange={(e) => {
                                      const slug = e.target.value
                                        .toLowerCase()
                                        .replace(/\s+/g, "-")
                                        .replace(/[^a-z0-9-]/g, "")
                                        .replace(/-+/g, "-");
                                      setCreateContentSlugEn(slug);
                                      if (slug) {
                                        setCreateContentSlugEnStatus("checking");
                                        checkSlug(createContentType, slug, loc0, setCreateContentSlugEnStatus, setSlugEnConflictReason);
                                      } else {
                                        setCreateContentSlugEnStatus("idle");
                                        setSlugEnConflictReason(null);
                                      }
                                    }}
                                    className="flex-1 px-2 py-1 text-xs font-mono rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                                    data-testid="input-slug-en"
                                    autoFocus
                                    onBlur={() => setEditingSlugEn(false)}
                                    onKeyDown={(e) => e.key === "Enter" && setEditingSlugEn(false)}
                                  />
                                </div>
                              ) : (
                                <code
                                  className="flex-1 text-xs bg-background px-2 py-1 rounded cursor-pointer hover-elevate"
                                  onClick={() => setEditingSlugEn(true)}
                                  data-testid="url-preview-en"
                                >
                                  {buildContentUrlFromPattern(contentTypesMap?.[createContentType]?.url_pattern, createContentSlugEn, loc0, urlParamValues[loc0])}
                                </code>
                              )}
                              <button
                                type="button"
                                onClick={() => setEditingSlugEn(!editingSlugEn)}
                                className="p-1 rounded hover-elevate"
                                title={`Edit ${supportedLocales[0]?.label ?? loc0} slug`}
                                data-testid="button-edit-slug-en"
                              >
                                <Pencil className="h-3 w-3 text-muted-foreground" />
                              </button>
                              <div className="w-4">
                                {createContentSlugEnStatus === "checking" && (
                                  <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                                )}
                                {createContentSlugEnStatus === "available" && !slugsConflict && (
                                  <Check className="h-4 w-4 text-green-600" />
                                )}
                                {(createContentSlugEnStatus === "taken" || (createContentSlugEnStatus === "available" && slugsConflict)) && (
                                  <X className="h-4 w-4 text-red-600" />
                                )}
                              </div>
                            </div>
                            {createContentSlugEnStatus === "taken" && (
                              <p className="text-xs text-red-600 pl-1">{slugEnConflictReason || `${supportedLocales[0]?.label ?? loc0} slug is taken`}</p>
                            )}
                          </>
                        )}

                        {isLocaleVisible(loc1) && !loc1Excluded && (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-muted-foreground w-8 shrink-0 text-right">{loc1}</span>
                              {editingSlugEs ? (
                                <div className="flex-1 flex items-center gap-1">
                                  <span className="text-xs font-mono text-muted-foreground">
                                    {buildContentUrlFromPattern(contentTypesMap?.[createContentType]?.url_pattern, "", loc1, urlParamValues[loc1]).replace(/\/$/, "")}/
                                  </span>
                                  <input
                                    type="text"
                                    value={createContentSlugEs}
                                    onChange={(e) => {
                                      const slug = e.target.value
                                        .toLowerCase()
                                        .replace(/\s+/g, "-")
                                        .replace(/[^a-z0-9-]/g, "")
                                        .replace(/-+/g, "-");
                                      setCreateContentSlugEs(slug);
                                      if (slug) {
                                        setCreateContentSlugEsStatus("checking");
                                        checkSlug(createContentType, slug, loc1, setCreateContentSlugEsStatus, setSlugEsConflictReason);
                                      } else {
                                        setCreateContentSlugEsStatus("idle");
                                        setSlugEsConflictReason(null);
                                      }
                                    }}
                                    className="flex-1 px-2 py-1 text-xs font-mono rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                                    data-testid="input-slug-es"
                                    autoFocus
                                    onBlur={() => setEditingSlugEs(false)}
                                    onKeyDown={(e) => e.key === "Enter" && setEditingSlugEs(false)}
                                  />
                                </div>
                              ) : (
                                <code
                                  className="flex-1 text-xs bg-background px-2 py-1 rounded cursor-pointer hover-elevate"
                                  onClick={() => setEditingSlugEs(true)}
                                  data-testid="url-preview-es"
                                >
                                  {buildContentUrlFromPattern(contentTypesMap?.[createContentType]?.url_pattern, createContentSlugEs, loc1, urlParamValues[loc1])}
                                </code>
                              )}
                              <button
                                type="button"
                                onClick={() => setEditingSlugEs(!editingSlugEs)}
                                className="p-1 rounded hover-elevate"
                                title={`Edit ${supportedLocales[1]?.label ?? loc1} slug`}
                                data-testid="button-edit-slug-es"
                              >
                                <Pencil className="h-3 w-3 text-muted-foreground" />
                              </button>
                              <div className="w-4">
                                {createContentSlugEsStatus === "checking" && (
                                  <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                                )}
                                {createContentSlugEsStatus === "available" && !slugsConflict && (
                                  <Check className="h-4 w-4 text-green-600" />
                                )}
                                {(createContentSlugEsStatus === "taken" || (createContentSlugEsStatus === "available" && slugsConflict)) && (
                                  <X className="h-4 w-4 text-red-600" />
                                )}
                              </div>
                            </div>
                            {createContentSlugEsStatus === "taken" && (
                              <p className="text-xs text-red-600 pl-1">{slugEsConflictReason || `${supportedLocales[1]?.label ?? loc1} slug is taken`}</p>
                            )}
                          </>
                        )}
                      </div>

                      {slugsConflict && (
                        <div className="flex gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/30 text-xs text-destructive" data-testid="warning-slug-conflict">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>
                            This content type uses the same URL for all locales. Each locale must have a unique slug, or exclude one locale.
                          </span>
                        </div>
                      )}

                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => setShowFiles((v) => !v)}
                          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover-elevate rounded"
                          data-testid="button-toggle-files"
                        >
                          <ChevronDown className={`h-3 w-3 transition-transform ${showFiles ? "" : "-rotate-90"}`} />
                          Files that will be created
                        </button>
                        {showFiles && (() => {
                          const fmtParam = (k: string, v: string) =>
                            urlParamOptionsData?.shapes?.[k] === "object_slug"
                              ? `${k}: { slug: ${v} }`
                              : `${k}: ${v}`;
                          const commonNotes: string[] = [];
                          const localeNotes: Record<string, string[]> = {};
                          for (const param of urlParams) {
                            activeLocales.forEach((l) => {
                              const v = urlParamValues[l]?.[param] ?? "";
                              if (v) (localeNotes[l] ??= []).push(fmtParam(param, v));
                            });
                          }
                          return (
                            <div className="space-y-0.5 font-mono text-xs text-muted-foreground pl-4 pt-1">
                              <div>4geeks-com/{contentTypesMap?.[createContentType]?.directory || createContentType}/{createContentSlugEn || createContentSlugEs}/</div>
                              <div className="pl-4">├── _common.yml</div>
                              {commonNotes.length > 0 && (
                                <div className="pl-8 text-[11px] text-muted-foreground/80">
                                  ← {commonNotes.join(", ")}
                                </div>
                              )}
                              {activeLocales.map((loc, i) => (
                                <div key={loc}>
                                  <div className="pl-4">
                                    {i === activeLocales.length - 1 ? "└── " : "├── "}{loc}.yml
                                  </div>
                                  {(localeNotes[loc]?.length ?? 0) > 0 && (
                                    <div className="pl-8 text-[11px] text-muted-foreground/80">
                                      ← {localeNotes[loc].join(", ")}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 py-4 overflow-y-auto max-h-[60vh] pr-1">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                All{" "}
                <span className="font-medium text-foreground capitalize">
                  {selectedTypeData?.label || createContentType}
                </span>{" "}
                entries must have the following fields. Please specify their values.
              </p>
              <Popover open={exampleOpen} onOpenChange={setExampleOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-show-example">
                    Show example
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3 space-y-2 z-[10001]" align="end">
                  {exampleLoading ? (
                    <div className="flex items-center gap-2 py-1">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Loading…</span>
                    </div>
                  ) : !exampleData?.slug ? (
                    <p className="text-xs text-muted-foreground">No entries found</p>
                  ) : (
                    <>
                      <p className="text-xs font-medium text-foreground font-mono">{exampleData.slug}</p>
                      <Separator />
                      <div className="space-y-1.5">
                        {extraUniqueFields.map((field) => (
                          <div key={field} className="flex justify-between gap-2 text-xs">
                            <span className="font-mono text-muted-foreground flex-shrink-0">{field}</span>
                            <span className="font-mono truncate text-right">{String(exampleData.fields[field] ?? "—")}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Required fields</p>
              <div className="space-y-1.5">
                {extraUniqueFields.map((field) => (
                  <div key={field} className="flex items-center gap-2">
                    <span
                      className="text-xs font-mono w-28 flex-shrink-0 text-right text-muted-foreground truncate"
                      title={field}
                    >
                      {field}
                    </span>
                    <input
                      type="text"
                      value={uniqueFieldValues[field] ?? ""}
                      onChange={(e) => {
                        setUniqueFieldValues((prev) => ({ ...prev, [field]: e.target.value }));
                        setCreateError(null);
                      }}
                      placeholder={exampleData?.fields?.[field] ?? humanizeField(field)}
                      className="flex-1 px-2 py-1 text-xs font-mono rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                      data-testid={`input-field-${field}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            {(editableNonUniqueFields.length > 0 || computedFields.length > 0) && (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setShowNonUnique((v) => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover-elevate rounded py-0.5"
                  data-testid="button-toggle-additional"
                >
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${showNonUnique ? "" : "-rotate-90"}`}
                  />
                  Additional values
                </button>

                {showNonUnique && (
                  <div className="space-y-1.5 pt-0.5">
                    {editableNonUniqueFields.map((field) => {
                      const exampleVal = exampleData?.fields?.[field];
                      const isBooleanField = typeof exampleVal === "boolean" || typeof nonUniqueValues[field] === "boolean";
                      if (isBooleanField) {
                        const checked = nonUniqueValues[field] != null ? nonUniqueValues[field] === true : true;
                        return (
                          <div key={field} className="flex items-center gap-2">
                            <span
                              className="text-xs font-mono w-28 flex-shrink-0 text-right text-muted-foreground truncate"
                              title={field}
                            >
                              {field}
                            </span>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked as boolean}
                                onChange={(e) =>
                                  setNonUniqueValues((prev) => ({ ...prev, [field]: e.target.checked }))
                                }
                                className="h-4 w-4 rounded border accent-primary"
                                data-testid={`input-field-${field}`}
                              />
                              <span className="text-xs text-muted-foreground">{checked ? "true" : "false"}</span>
                            </label>
                          </div>
                        );
                      }
                      return (
                        <div key={field} className="flex items-center gap-2">
                          <span
                            className="text-xs font-mono w-28 flex-shrink-0 text-right text-muted-foreground truncate"
                            title={field}
                          >
                            {field}
                          </span>
                          <input
                            type="text"
                            value={(nonUniqueValues[field] as string) ?? ""}
                            onChange={(e) =>
                              setNonUniqueValues((prev) => ({ ...prev, [field]: e.target.value }))
                            }
                            placeholder={exampleVal != null ? String(exampleVal) : humanizeField(field)}
                            className="flex-1 px-2 py-1 text-xs font-mono rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                            data-testid={`input-field-${field}`}
                          />
                        </div>
                      );
                    })}
                    {computedFields.map(({ key, rawCode }) => (
                      <div key={key} className="flex items-center gap-2">
                        <span
                          className="text-xs font-mono w-28 flex-shrink-0 text-right text-muted-foreground truncate"
                          title={key}
                        >
                          {key}
                        </span>
                        <span className="flex-1 text-xs font-mono text-muted-foreground italic">
                          {sourceData?.fields[key] ?? "(auto-calculated)"}
                        </span>
                        <FunctionCodePopover rawCode={rawCode} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {createError && (
            <p className="text-xs text-destructive flex-1 self-center" data-testid="text-create-error">{createError}</p>
          )}
          {step === 1 && (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-create-content"
            >
              Cancel
            </Button>
          )}
          {step === 2 && (
            <Button
              variant="outline"
              onClick={() => setStep(1)}
              data-testid="button-back-step"
            >
              Back
            </Button>
          )}

          {step === 1 && hasStep2 ? (
            <Button
              disabled={!slugsReady || !urlParamsFilled}
              onClick={() => setStep(2)}
              data-testid="button-next-step"
            >
              Next
            </Button>
          ) : (
            <Button
              onClick={handleConfirm}
              disabled={isCreatingContent || !slugsReady || !uniqueFieldsFilled || !urlParamsFilled}
              data-testid="button-confirm-create-content"
            >
              {confirmButtonLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <Dialog open={showTypeChangeDetails} onOpenChange={setShowTypeChangeDetails}>
        <DialogContent className="sm:max-w-lg" data-testid="modal-type-change-details">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              Content Type Conversion Details
            </DialogTitle>
            <DialogDescription>
              What happens when you change the content type during duplication.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm text-muted-foreground">
            <div className="space-y-1">
              <p className="font-medium text-foreground">Template variables resolved</p>
              <p>
                <code className="text-xs bg-muted px-1 py-0.5 rounded">{"{{ single.* }}"}</code> template variables will be replaced with their actual or fallback values, hardcoded directly into the YAML content.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Source-specific properties removed</p>
              <p>
                Properties unique to the source content type (from its <code className="text-xs bg-muted px-1 py-0.5 rounded">field_mapping</code>) that don't exist in the target type will be removed from <code className="text-xs bg-muted px-1 py-0.5 rounded">_common.yml</code>.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Section bindings removed</p>
              <p>
                All section bindings will be removed. Each section starts unbound in the new entry.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Listing components preserved</p>
              <p>
                Listing components (<code className="text-xs bg-muted px-1 py-0.5 rounded">dynamic_entries</code>) and their <code className="text-xs bg-muted px-1 py-0.5 rounded">{"{{ single.* }}"}</code> template references will be preserved as-is.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTypeChangeDetails(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
