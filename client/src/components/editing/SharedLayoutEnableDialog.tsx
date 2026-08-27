import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export interface SharedLayoutDivergence {
  locale: string;
  sectionCount: number;
  sectionIds: string[];
  basename?: string;
  naming?: "template" | "single";
}

export interface SharedLayoutBindingSummary {
  id: string;
  name?: string;
  component: string;
  locale: string;
  memberCount: number;
  members: Array<{ contentType: string; slug: string; sectionId: string }>;
}

export type SharedLayoutTemplateMode = "keep_existing" | "from_entry";

export interface SharedLayoutEnablePayload {
  template_mode: SharedLayoutTemplateMode;
  shared_layout_base_locale?: string;
  template_entry_source_slug?: string;
  template_entry_source_locale?: string;
  confirm?: boolean;
}

/** Staff-facing reason a picked location cannot seed the shared template. */
export function templateEntryRejectMessage(
  code: string | undefined,
  invalidSections?: Array<{ sectionId: string | null; index: number }>,
): string {
  switch (code) {
    case "template_entry_empty_sections":
      return "This location has no sections to use as a template. Pick one that already has a page layout.";
    case "template_entry_not_found":
    case "template_entry_locale_missing":
      return "Could not load this location. Pick another, or check that it has a live locale file.";
    case "template_entry_source_locale_invalid":
      return "That locale is not available for this location. Choose a different locale.";
    case "template_entry_not_template_shaped": {
      const names = (invalidSections || [])
        .map((s) => s.sectionId)
        .filter((id): id is string => !!id)
        .slice(0, 4);
      const which =
        names.length > 0
          ? ` Problem sections: ${names.join(", ")}${
              (invalidSections?.length || 0) > 4 ? "…" : ""
            }.`
          : "";
      return (
        "This location cannot be used as a template. Its sections still have fixed text or images instead of fields that pull from each entry." +
        which
      );
    }
    default:
      return "This location cannot be used as a template. Pick another, or update it so section content uses entry fields.";
  }
}

interface SharedLayoutEnableDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: SharedLayoutEnablePayload) => void | Promise<void>;
  contentType: string;
  usableTemplate: boolean;
  divergences: SharedLayoutDivergence[];
  bindings?: SharedLayoutBindingSummary[];
  isLoading?: boolean;
  /** When set, dialog is in replace-confirm step after 409 preview. */
  replacePreview?: {
    current: SharedLayoutDivergence[];
    proposed: { locale: string; sectionCount: number; sectionIds: string[] };
    paths_to_overwrite: string[];
  } | null;
  onClearReplacePreview?: () => void;
}

export function SharedLayoutEnableFields({
  contentType,
  usableTemplate,
  divergences,
  bindings = [],
  value,
  onChange,
  disabled,
  onSourceEligibleChange,
}: {
  contentType: string;
  usableTemplate: boolean;
  divergences: SharedLayoutDivergence[];
  bindings?: SharedLayoutBindingSummary[];
  value: SharedLayoutEnablePayload;
  onChange: (next: SharedLayoutEnablePayload) => void;
  disabled?: boolean;
  /** false while from_entry selection is missing/invalid; true when keep_existing or entry passes. */
  onSourceEligibleChange?: (eligible: boolean) => void;
}) {
  const mode: SharedLayoutTemplateMode =
    value.template_mode || (usableTemplate ? "keep_existing" : "from_entry");
  const [entrySearch, setEntrySearch] = useState("");
  const [entryResults, setEntryResults] = useState<
    Array<{ slug: string; title?: string; locales?: string[] }>
  >([]);
  const [entryLocales, setEntryLocales] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [entryCheck, setEntryCheck] = useState<
    | { status: "idle" }
    | { status: "checking" }
    | { status: "ok" }
    | {
        status: "error";
        code: string;
        invalidSections?: Array<{ sectionId: string | null; index: number }>;
      }
    | { status: "need_locale" }
  >({ status: "idle" });

  useEffect(() => {
    if (!usableTemplate && mode !== "from_entry") {
      onChange({ ...value, template_mode: "from_entry" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync mode when usable flips
  }, [usableTemplate]);

  useEffect(() => {
    if (mode !== "from_entry") return;
    const q = entrySearch.trim();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ page: "1", limit: "15" });
        if (q) params.set("search", q);
        const res = await apiRequest(
          "GET",
          `/api/content-types/${encodeURIComponent(contentType)}/static-entries?${params}`,
        );
        const data = await res.json();
        const entries = (data.entries || data.items || []) as Array<{
          slug: string;
          title?: string;
          locales?: string[];
        }>;
        setEntryResults(entries);
      } catch {
        setEntryResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [entrySearch, contentType, mode]);

  useEffect(() => {
    const slug = value.template_entry_source_slug;
    if (!slug || mode !== "from_entry") {
      setEntryLocales([]);
      setEntryCheck({ status: "idle" });
      return;
    }
    let cancelled = false;
    setEntryCheck({ status: "checking" });
    (async () => {
      try {
        const params = new URLSearchParams({ entry: slug });
        if (value.template_entry_source_locale) {
          params.set("locale", value.template_entry_source_locale);
        }
        const res = await apiRequest(
          "GET",
          `/api/content-types/${encodeURIComponent(contentType)}/shared-layout-status?${params}`,
        );
        const data = await res.json();
        if (cancelled) return;
        const locales = (data.entry_locales || []) as string[];
        setEntryLocales(locales);

        if (locales.length > 1 && !value.template_entry_source_locale) {
          setEntryCheck({ status: "need_locale" });
          return;
        }

        if (locales.length === 1 && !value.template_entry_source_locale) {
          onChange({
            ...value,
            template_entry_source_locale: locales[0],
          });
          // Re-run will assess with locale set
          return;
        }

        if (
          locales.length > 1 &&
          value.template_entry_source_locale &&
          !locales.includes(value.template_entry_source_locale)
        ) {
          onChange({ ...value, template_entry_source_locale: undefined });
          setEntryCheck({ status: "need_locale" });
          return;
        }

        const assessment = data.entry_assessment as
          | { ok: true }
          | {
              ok: false;
              code?: string;
              invalid_sections?: Array<{ sectionId: string | null; index: number }>;
            }
          | undefined;

        if (!assessment) {
          setEntryCheck({ status: "need_locale" });
          return;
        }
        if (assessment.ok) {
          setEntryCheck({ status: "ok" });
        } else {
          setEntryCheck({
            status: "error",
            code: assessment.code || "template_entry_not_template_shaped",
            invalidSections: assessment.invalid_sections,
          });
        }
      } catch {
        if (!cancelled) {
          setEntryLocales([]);
          setEntryCheck({
            status: "error",
            code: "template_entry_not_found",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    value.template_entry_source_slug,
    value.template_entry_source_locale,
    mode,
    contentType,
  ]);

  useEffect(() => {
    if (!onSourceEligibleChange) return;
    if (mode === "keep_existing") {
      onSourceEligibleChange(true);
      return;
    }
    if (!value.template_entry_source_slug) {
      onSourceEligibleChange(false);
      return;
    }
    if (entryCheck.status === "ok") {
      onSourceEligibleChange(true);
      return;
    }
    onSourceEligibleChange(false);
  }, [
    mode,
    value.template_entry_source_slug,
    entryCheck.status,
    onSourceEligibleChange,
  ]);

  const baseLocales =
    divergences.length > 0
      ? divergences.map((d) => d.locale)
      : value.template_entry_source_locale
        ? [value.template_entry_source_locale]
        : ["en"];

  return (
    <div className="space-y-4">
      {usableTemplate ? (
        <div className="space-y-2">
          <Label>Shared template source</Label>
          <div className="grid gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange({
                  template_mode: "keep_existing",
                  shared_layout_base_locale:
                    value.shared_layout_base_locale ||
                    (baseLocales.includes("en") ? "en" : baseLocales[0]),
                })
              }
              className={`rounded-md border p-3 text-left text-sm transition-colors ${
                mode === "keep_existing"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/40"
              }`}
              data-testid="option-keep-existing-template"
            >
              <strong className="text-foreground">Keep existing template</strong>
              <p className="text-xs text-muted-foreground mt-1">
                Continue using the current <code className="text-[11px]">template.{"{locale}"}.yml</code>{" "}
                shell (non-empty sections).
              </p>
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...value,
                  template_mode: "from_entry",
                })
              }
              className={`rounded-md border p-3 text-left text-sm transition-colors ${
                mode === "from_entry"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/40"
              }`}
              data-testid="option-from-entry-template"
            >
              <strong className="text-foreground">Create from an entry</strong>
              <p className="text-xs text-muted-foreground mt-1">
                Copy sections from one entry into{" "}
                <code className="text-[11px]">template.{"{locale}"}.yml</code>. Requires fully bound{" "}
                <code className="text-[11px]">{"{{ entry.* }}"}</code> props.
              </p>
            </button>
          </div>
        </div>
      ) : null}

      {mode === "keep_existing" && (
        <div className="space-y-2">
          <Label htmlFor="shared-layout-base-locale">Base locale for sibling align</Label>
          <Select
            value={
              value.shared_layout_base_locale ||
              (baseLocales.includes("en") ? "en" : baseLocales[0] || "en")
            }
            onValueChange={(loc) =>
              onChange({ ...value, template_mode: "keep_existing", shared_layout_base_locale: loc })
            }
            disabled={disabled}
          >
            <SelectTrigger id="shared-layout-base-locale" data-testid="select-shared-layout-base">
              <SelectValue placeholder="Select locale" />
            </SelectTrigger>
            <SelectContent>
              {baseLocales.map((loc) => (
                <SelectItem key={loc} value={loc}>
                  {loc}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {mode === "from_entry" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="template-entry-search">Search and choose a location</Label>
            <Input
              id="template-entry-search"
              value={entrySearch}
              onChange={(e) => setEntrySearch(e.target.value)}
              placeholder="Search by title or slug…"
              disabled={disabled}
              data-testid="input-template-entry-search"
            />
            {value.template_entry_source_slug && (
              <p className="text-xs text-foreground" data-testid="text-selected-entry-slug">
                Selected: <code className="font-mono">{value.template_entry_source_slug}</code>
              </p>
            )}
            <ul className="max-h-40 overflow-y-auto rounded-md border border-border divide-y text-sm">
              {searching && (
                <li className="px-3 py-2 text-muted-foreground text-xs">Searching…</li>
              )}
              {!searching && entryResults.length === 0 && (
                <li className="px-3 py-2 text-muted-foreground text-xs">No entries found</li>
              )}
              {entryResults.map((e) => (
                <li key={e.slug}>
                  <button
                    type="button"
                    disabled={disabled}
                    className={`w-full px-3 py-2 text-left hover:bg-muted/50 ${
                      value.template_entry_source_slug === e.slug ? "bg-primary/10" : ""
                    }`}
                    onClick={() =>
                      onChange({
                        ...value,
                        template_mode: "from_entry",
                        template_entry_source_slug: e.slug,
                        template_entry_source_locale: undefined,
                        shared_layout_base_locale: value.shared_layout_base_locale,
                      })
                    }
                    data-testid={`button-pick-entry-${e.slug}`}
                  >
                    <span className="font-medium text-foreground">{e.title || e.slug}</span>
                    <span className="block text-xs text-muted-foreground font-mono">{e.slug}</span>
                  </button>
                </li>
              ))}
            </ul>
            {entryCheck.status === "checking" && (
              <p className="text-xs text-muted-foreground" data-testid="text-entry-check-loading">
                Checking if this location can be used as a template…
              </p>
            )}
            {entryCheck.status === "error" && (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-foreground space-y-1"
                data-testid="text-entry-check-error"
              >
                <p className="font-medium text-destructive">Cannot use this location</p>
                <p className="text-muted-foreground">
                  {templateEntryRejectMessage(entryCheck.code, entryCheck.invalidSections)}
                </p>
              </div>
            )}
            {entryCheck.status === "ok" && (
              <p className="text-xs text-muted-foreground" data-testid="text-entry-check-ok">
                This location can be used as a template.
              </p>
            )}
          </div>

          {entryLocales.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="template-entry-locale">Entry locale</Label>
              <Select
                value={value.template_entry_source_locale || ""}
                onValueChange={(loc) =>
                  onChange({
                    ...value,
                    template_mode: "from_entry",
                    template_entry_source_locale: loc,
                    shared_layout_base_locale: loc,
                  })
                }
                disabled={disabled}
              >
                <SelectTrigger id="template-entry-locale" data-testid="select-template-entry-locale">
                  <SelectValue placeholder="Select locale" />
                </SelectTrigger>
                <SelectContent>
                  {entryLocales.map((loc) => (
                    <SelectItem key={loc} value={loc}>
                      {loc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {divergences.length > 0 && (
        <div className="rounded-md border border-border p-3 space-y-2">
          <p className="text-sm font-medium text-foreground">Current template shells</p>
          <ul className="text-xs text-muted-foreground space-y-1 max-h-40 overflow-y-auto">
            {divergences.map((d) => (
              <li key={d.locale} data-testid={`divergence-row-${d.locale}`}>
                <strong className="text-foreground">{d.locale}</strong>: {d.sectionCount}{" "}
                section{d.sectionCount === 1 ? "" : "s"}
                {d.basename ? ` · ${d.basename}` : ""}
                {d.sectionIds.length > 0
                  ? ` (${d.sectionIds.slice(0, 6).join(", ")}${d.sectionIds.length > 6 ? "…" : ""})`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {bindings.length > 0 && (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2"
          data-testid="shared-layout-bindings-warning"
        >
          <p className="text-sm font-medium text-foreground">
            {bindings.length} section binding{bindings.length === 1 ? "" : "s"} will be removed
          </p>
          <p className="text-xs text-muted-foreground">
            Shared layout and section bindings do not mix. Confirming dissolves these binding groups
            for this content type.
          </p>
        </div>
      )}
    </div>
  );
}

export function SharedLayoutEnableDialog({
  open,
  onClose,
  onConfirm,
  contentType,
  usableTemplate,
  divergences,
  bindings = [],
  isLoading = false,
  replacePreview = null,
  onClearReplacePreview,
}: SharedLayoutEnableDialogProps) {
  const [payload, setPayload] = useState<SharedLayoutEnablePayload>(() => ({
    template_mode: usableTemplate ? "keep_existing" : "from_entry",
    shared_layout_base_locale: "en",
  }));
  const [sourceEligible, setSourceEligible] = useState(true);

  useEffect(() => {
    if (open) {
      setPayload({
        template_mode: usableTemplate ? "keep_existing" : "from_entry",
        shared_layout_base_locale:
          divergences.find((d) => d.sectionCount > 0 && d.locale === "en")?.locale ||
          divergences.find((d) => d.sectionCount > 0)?.locale ||
          "en",
      });
      setSourceEligible(usableTemplate);
    }
  }, [open, usableTemplate, divergences]);

  const canSubmit =
    (payload.template_mode === "keep_existing" ||
      !!payload.template_entry_source_slug) &&
    sourceEligible;

  if (replacePreview) {
    return (
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && !isLoading) {
            onClearReplacePreview?.();
            onClose();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirm template replace
            </DialogTitle>
            <DialogDescription>
              This overwrites the shared template shell for every attached entry of this type.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3 space-y-1">
              <p className="font-medium text-foreground">Current</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                {replacePreview.current.map((c) => (
                  <li key={c.locale}>
                    {c.locale}: {c.sectionCount} sections
                    {c.sectionIds.length
                      ? ` (${c.sectionIds.slice(0, 8).join(", ")}${c.sectionIds.length > 8 ? "…" : ""})`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border border-amber-500/40 p-3 space-y-1">
              <p className="font-medium text-foreground">
                Proposed ({replacePreview.proposed.locale})
              </p>
              <p className="text-xs text-muted-foreground">
                {replacePreview.proposed.sectionCount} sections
                {replacePreview.proposed.sectionIds.length
                  ? `: ${replacePreview.proposed.sectionIds.slice(0, 12).join(", ")}${replacePreview.proposed.sectionIds.length > 12 ? "…" : ""}`
                  : ""}
              </p>
            </div>
            <p className="text-xs text-muted-foreground font-mono">
              {replacePreview.paths_to_overwrite.join(", ")}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={isLoading}
              onClick={() => {
                onClearReplacePreview?.();
              }}
              data-testid="button-shared-layout-replace-back"
            >
              Back
            </Button>
            <Button
              disabled={isLoading}
              onClick={() => onConfirm({ ...payload, confirm: true })}
              data-testid="button-shared-layout-replace-confirm"
            >
              {isLoading ? "Replacing…" : "Overwrite and enable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isLoading) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Enable shared layout
          </DialogTitle>
          <DialogDescription>
            Choose whether to keep the current shared template shell or seed it from one entry.
            Sibling locale templates are aligned to the chosen structure.
            {bindings.length > 0
              ? " Section bindings cannot be used with shared layout and will be removed."
              : ""}
          </DialogDescription>
        </DialogHeader>

        <SharedLayoutEnableFields
          contentType={contentType}
          usableTemplate={usableTemplate}
          divergences={divergences}
          bindings={bindings}
          value={payload}
          onChange={setPayload}
          disabled={isLoading}
          onSourceEligibleChange={setSourceEligible}
        />

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
            data-testid="button-shared-layout-enable-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(payload)}
            disabled={
              isLoading ||
              !canSubmit ||
              (payload.template_mode === "from_entry" && !payload.template_entry_source_slug)
            }
            data-testid="button-shared-layout-enable-confirm"
          >
            {isLoading
              ? "Enabling…"
              : bindings.length > 0
                ? "Enable and remove bindings"
                : "Enable shared layout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
