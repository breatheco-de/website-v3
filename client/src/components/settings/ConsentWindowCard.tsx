import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconCookie,
  IconDeviceFloppy,
  IconLoader2,
  IconPencil,
  IconRestore,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { countries, hasFlag } from "country-flag-icons";
import * as CountryFlags from "country-flag-icons/react/3x2";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  SearchableMultiSelect,
  type SearchableMultiSelectOption,
} from "@/components/ui/searchable-multi-select";
import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import { useToast } from "@/hooks/use-toast";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ASK_COUNTRIES,
  DEFAULT_COOKIE_BANNER_COPY,
  REJECT_RISK_THRESHOLD_DAYS,
  resolveCookieBannerCopy,
  type ConsentMode,
  type ConsentWindowSettings,
  type CookieBannerKey,
} from "@shared/consent";

type WindowResponse = {
  window: ConsentWindowSettings;
  effective_ask_countries: string[];
  reject_duration_risky: boolean;
  copy: Record<CookieBannerKey, Record<string, string>>;
  default_locale: string;
};

type LocaleOption = { code: string; label?: string };

const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

function CountryFlag({ code }: { code: string }) {
  const Flag = (CountryFlags as Record<string, ComponentType<{ className?: string; title?: string }>>)[
    code.toUpperCase()
  ];
  if (!Flag) return null;
  return <Flag className="h-3 w-4 rounded-[1px] object-cover" title={code} />;
}

function buildCountryOptions(): SearchableMultiSelectOption[] {
  return countries
    .filter((code) => /^[A-Z]{2}$/.test(code) && hasFlag(code))
    .map((code) => {
      const name = REGION_NAMES.of(code) ?? code;
      return {
        value: code,
        label: `${name} (${code})`,
        badgeLabel: code,
        prefix: <CountryFlag code={code} />,
        searchTerms: [name, code],
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

const COUNTRY_OPTIONS = buildCountryOptions();

function sameCountrySet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((c) => set.has(c));
}

function InlineEditable({
  canEdit,
  storedValue,
  placeholder,
  onChange,
  multiline = false,
  className,
  inputClassName,
  testId,
  children,
}: {
  canEdit: boolean;
  storedValue: string;
  placeholder: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  className?: string;
  inputClassName?: string;
  testId: string;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(storedValue);

  useEffect(() => {
    if (!editing) setDraft(storedValue);
  }, [storedValue, editing]);

  function commit() {
    onChange(draft.trim());
    setEditing(false);
  }

  if (editing) {
    if (multiline) {
      return (
        <textarea
          autoFocus
          rows={3}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(storedValue);
              setEditing(false);
            }
          }}
          className={cn(
            "w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs leading-snug text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            inputClassName,
          )}
          data-testid={testId}
        />
      );
    }
    return (
      <Input
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(storedValue);
            setEditing(false);
          }
        }}
        className={cn("h-8 text-xs", inputClassName)}
        data-testid={testId}
      />
    );
  }

  return (
    <span className={cn("relative inline-flex max-w-full group/edit", className)}>
      {children}
      {canEdit ? (
        <button
          type="button"
          className="absolute -top-1.5 -right-1.5 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-80 shadow-sm hover:opacity-100 hover:text-foreground"
          title="Edit"
          onClick={() => {
            setDraft(storedValue);
            setEditing(true);
          }}
          data-testid={`${testId}-pencil`}
        >
          <IconPencil className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}

function BannerPreview({
  mode,
  locale,
  copy,
  resolved,
  canEdit,
  onChange,
}: {
  mode: ConsentMode;
  locale: string;
  copy: Record<string, Record<string, string>>;
  resolved: ReturnType<typeof resolveCookieBannerCopy>;
  canEdit: boolean;
  onChange: (key: CookieBannerKey, value: string) => void;
}) {
  const messageKey: CookieBannerKey = mode === "notice" ? "cookie_banner_notice" : "cookie_banner_ask";
  const stored = (key: CookieBannerKey) => copy[key]?.[locale] ?? "";
  const placeholder = (key: CookieBannerKey) =>
    DEFAULT_COOKIE_BANNER_COPY[key][locale] ?? DEFAULT_COOKIE_BANNER_COPY[key].en;

  return (
    <div className="dark rounded-md border border-border overflow-hidden">
      <div className="bg-background text-foreground px-3 py-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <InlineEditable
            canEdit={canEdit}
            storedValue={stored(messageKey)}
            placeholder={placeholder(messageKey)}
            onChange={(v) => onChange(messageKey, v)}
            multiline
            className="w-full block"
            testId={`consent-inline-${messageKey}`}
          >
            <p className="text-xs leading-snug text-foreground/85 pr-4">
              {resolved[messageKey]}
            </p>
          </InlineEditable>
          <InlineEditable
            canEdit={canEdit}
            storedValue={stored("cookie_banner_privacy_link")}
            placeholder={placeholder("cookie_banner_privacy_link")}
            onChange={(v) => onChange("cookie_banner_privacy_link", v)}
            className="inline-flex"
            testId="consent-inline-cookie_banner_privacy_link"
          >
            <span className="text-xs underline underline-offset-2 pr-4">
              {resolved.cookie_banner_privacy_link}
            </span>
          </InlineEditable>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mode === "notice" ? (
            <InlineEditable
              canEdit={canEdit}
              storedValue={stored("cookie_banner_ok")}
              placeholder={placeholder("cookie_banner_ok")}
              onChange={(v) => onChange("cookie_banner_ok", v)}
              inputClassName="min-w-24"
              testId="consent-inline-cookie_banner_ok"
            >
              <Button size="sm" type="button" tabIndex={-1} className="pointer-events-none min-w-24 pr-5">
                {resolved.cookie_banner_ok}
              </Button>
            </InlineEditable>
          ) : (
            <>
              <InlineEditable
                canEdit={canEdit}
                storedValue={stored("cookie_banner_accept")}
                placeholder={placeholder("cookie_banner_accept")}
                onChange={(v) => onChange("cookie_banner_accept", v)}
                inputClassName="min-w-24"
                testId="consent-inline-cookie_banner_accept"
              >
                <Button size="sm" type="button" tabIndex={-1} className="pointer-events-none min-w-24 pr-5">
                  {resolved.cookie_banner_accept}
                </Button>
              </InlineEditable>
              <InlineEditable
                canEdit={canEdit}
                storedValue={stored("cookie_banner_reject")}
                placeholder={placeholder("cookie_banner_reject")}
                onChange={(v) => onChange("cookie_banner_reject", v)}
                inputClassName="min-w-24"
                testId="consent-inline-cookie_banner_reject"
              >
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  tabIndex={-1}
                  className="pointer-events-none min-w-24 pr-5"
                >
                  {resolved.cookie_banner_reject}
                </Button>
              </InlineEditable>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ConsentWindowCard({
  locales,
  defaultLocale,
}: {
  locales: LocaleOption[];
  defaultLocale: string;
}) {
  const { toast } = useToast();
  const { hasCapability } = useDebugAuth();
  const canEdit = hasCapability("consent_settings");

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ["/api/settings/consent/window"],
    queryFn: async () => {
      const res = await apiFetch("/api/settings/consent/window");
      if (!res.ok) throw new Error(res.status === 403 ? "You need the Manage cookie consent permission." : "Failed to load");
      return res.json() as Promise<WindowResponse>;
    },
    retry: false,
  });

  const [askCountries, setAskCountries] = useState<string[]>([...DEFAULT_ASK_COUNTRIES]);
  const [unknownMode, setUnknownMode] = useState<ConsentMode>("notice");
  const [acceptDays, setAcceptDays] = useState(365);
  const [rejectDays, setRejectDays] = useState(5);
  const [copy, setCopy] = useState<Record<string, Record<string, string>>>({});
  const [previewLocale, setPreviewLocale] = useState(defaultLocale);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!data || dirty) return;
    const w = data.window;
    setAskCountries(
      Array.isArray(w.ask_countries) ? [...w.ask_countries].sort() : [...DEFAULT_ASK_COUNTRIES],
    );
    setUnknownMode(w.unknown_country_mode);
    setAcceptDays(w.accept_days);
    setRejectDays(w.reject_days);
    setCopy(data.copy ?? {});
  }, [data, dirty]);

  const previewCopy = useMemo(
    () => resolveCookieBannerCopy(copy as Record<CookieBannerKey, Record<string, string>>, previewLocale),
    [copy, previewLocale],
  );
  const rejectRisky = rejectDays < REJECT_RISK_THRESHOLD_DAYS;
  const isDefaultAskList = sameCountrySet(askCountries, DEFAULT_ASK_COUNTRIES);

  function touch<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  function setCopyValue(key: CookieBannerKey, locale: string, value: string) {
    setCopy((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), [locale]: value } }));
    setDirty(true);
  }

  function resetAskCountriesToDefaults() {
    touch(setAskCountries)([...DEFAULT_ASK_COUNTRIES].sort());
  }

  async function save() {
    if (askCountries.length === 0) {
      toast({
        title: "Add at least one country",
        description: "Or use Reset to defaults for the EU, EEA, UK and Switzerland list.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/settings/consent/window", {
        ask_countries: isDefaultAskList ? "default" : askCountries,
        unknown_country_mode: unknownMode,
        accept_days: acceptDays,
        reject_days: rejectDays,
        copy,
      });
      setDirty(false);
      toast({ title: "Consent window saved" });
      await refetch();
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="card-consent-window">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            data-testid="button-consent-window-toggle"
          >
            <CardTitle className="text-base flex items-center gap-2">
              <IconCookie className="h-5 w-5 text-muted-foreground" />
              Consent Window
            </CardTitle>
            <IconChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
          {canEdit && data ? (
            <Button size="sm" onClick={save} disabled={!dirty || saving} data-testid="button-save-consent-window">
              {saving ? <IconLoader2 className="h-4 w-4 mr-1 animate-spin" /> : <IconDeviceFloppy className="h-4 w-4 mr-1" />}
              Save
            </Button>
          ) : null}
        </div>
      </CardHeader>
      {open && (
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Visitors from the countries below must press Accept or Reject before we measure which ads and pages bring
          them in. Everyone else sees a short notice. The site works the same for everyone; lead forms and their
          checkboxes above are not affected.
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <IconLoader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error || !data ? (
          <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Failed to load"}</p>
        ) : (
          <fieldset disabled={!canEdit} className="space-y-5">
            <div className="space-y-2">
              <div className="space-y-1" data-testid="input-consent-ask-countries">
                <SearchableMultiSelect
                  label="Countries that must choose"
                  options={COUNTRY_OPTIONS}
                  value={askCountries}
                  onChange={(codes) => touch(setAskCountries)([...codes].sort())}
                  searchPlaceholder="Search by name or code…"
                  addLabel="Add countries"
                  clearAllLabel="Clear all countries"
                  testIdPrefix="consent-countries"
                  emptyMessage="No countries found"
                  headerActions={
                    !isDefaultAskList ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        onClick={resetAskCountriesToDefaults}
                        data-testid="button-consent-reset-defaults"
                      >
                        <IconRestore className="h-3.5 w-3.5 mr-1" />
                        Reset to defaults
                      </Button>
                    ) : null
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {isDefaultAskList
                    ? `Default list — EU, EEA, UK and Switzerland (${DEFAULT_ASK_COUNTRIES.length} countries).`
                    : `${askCountries.length} selected. Reset to defaults restores the EU, EEA, UK and Switzerland list.`}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="select-consent-unknown-mode">
                  When we can't tell the country
                </label>
                <select
                  id="select-consent-unknown-mode"
                  value={unknownMode}
                  onChange={(e) => touch(setUnknownMode)(e.target.value as ConsentMode)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  data-testid="select-consent-unknown-mode"
                >
                  <option value="notice">Show the notice</option>
                  <option value="ask">Ask to accept or reject</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="input-consent-accept-days">
                  Remember an accept for (days)
                </label>
                <Input
                  id="input-consent-accept-days"
                  type="number"
                  min={1}
                  max={3650}
                  value={acceptDays}
                  onChange={(e) => touch(setAcceptDays)(Number(e.target.value) || 1)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="input-consent-reject-days">
                  Ask again after a reject (days)
                </label>
                <Input
                  id="input-consent-reject-days"
                  type="number"
                  min={1}
                  max={3650}
                  value={rejectDays}
                  onChange={(e) => touch(setRejectDays)(Number(e.target.value) || 1)}
                />
              </div>
            </div>
            {rejectRisky ? (
              <div
                className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-orange-500"
                data-testid="warning-consent-reject-days"
              >
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-orange-500" />
                <p>
                  Asking again after a reject sooner than 6 months can be seen as pressuring visitors in the EU and UK.
                  Regulators generally expect about 6 months.
                </p>
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Banner text</p>
                <ToggleButtonBar
                  value={previewLocale}
                  onValueChange={setPreviewLocale}
                  listTestId="select-consent-preview-locale"
                  listClassName="flex"
                >
                  {locales.map((l) => (
                    <ToggleButtonBarTrigger
                      key={l.code}
                      value={l.code}
                      className="gap-1.5"
                      data-testid={`consent-preview-locale-${l.code}`}
                      title={l.label ?? l.code}
                    >
                      <LocaleFlag locale={l.code} className="h-3 w-4 rounded-[1px]" />
                      <span className="uppercase">{l.code}</span>
                    </ToggleButtonBarTrigger>
                  ))}
                </ToggleButtonBar>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Click the pencil on any part of the preview to edit it for the selected language. Leave a field
                  empty to keep the built-in default.
                </p>
                <BannerPreview
                  mode="ask"
                  locale={previewLocale}
                  copy={copy}
                  resolved={previewCopy}
                  canEdit={canEdit}
                  onChange={(key, value) => setCopyValue(key, previewLocale, value)}
                />
                <BannerPreview
                  mode="notice"
                  locale={previewLocale}
                  copy={copy}
                  resolved={previewCopy}
                  canEdit={canEdit}
                  onChange={(key, value) => setCopyValue(key, previewLocale, value)}
                />
              </div>
            </div>
          </fieldset>
        )}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Read more (advanced)</summary>
          <div className="mt-1 space-y-1 leading-snug">
            <p>
              Countries, unknown-country mode and durations are stored in{" "}
              <code className="font-mono">site_*/settings.yml</code> under <code className="font-mono">consent.window</code>.
              Banner text is stored as <code className="font-mono">reserved.cookie_banner_*</code> in{" "}
              <code className="font-mono">variables.yml</code> (default locale + <code className="font-mono">conditions</code>).
            </p>
            <p>
              The choice is saved in the <code className="font-mono">4g_consent</code> cookie by{" "}
              <code className="font-mono">POST /api/consent</code>. Until it says granted, Google Consent Mode stays
              denied, the Meta pixel is revoked, the <code className="font-mono">4g_ads</code> cookie is not set, and
              marketing fields in <code className="font-mono">4g_ctx</code> stay in memory only. In notice countries,
              OK or the first scroll counts as consent; on pages of content types with Optimize for ads on, landing
              counts as consent (the notice still shows). Default locale: <code className="font-mono">{defaultLocale}</code>.
              Full cookie list: <code className="font-mono">docs/cookies.md</code>.
            </p>
          </div>
        </details>
      </CardContent>
      )}
    </Card>
  );
}
