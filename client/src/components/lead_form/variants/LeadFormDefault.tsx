// section-spacing: self-padded
import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { Check, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Turnstile } from "@marsidev/react-turnstile";
import { normalizeLocale } from "@/lib/locale";
import { leadSubmitErrorMessage } from "@/lib/leadSubmitError";
import { localeFromPath } from "@shared/runtime-issues";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useSession, useLocation as useSessionLocation, useUTM } from "@/contexts/SessionContext";
import { useSectionContext } from "@/contexts/SectionContext";
import { useLocation } from "wouter";
import { apiRequest, apiRequestWithAuth, apiFetch, queryClient } from "@/lib/queryClient";
import {
  buildLeadAdContext,
  needsStaffSubmitConfirm,
  newSubmissionId,
  skipStaffSubmitConfirmThisSession,
  staffLeadHeaders,
} from "@/lib/leadAdContext";
import { getApiPath } from "@shared/api-paths";
import type { Country } from "react-phone-number-input";
import { trackFormSubmission, trackConversion, resolveWebhook, hashEmail, getEcommerceProductLookup, type ConversionName, type FormSubmissionTrackingData, type TrackingSettingsResponse } from "@/lib/tracking";
import { ensureEcommerceProductLookup, ensureTrackingKeys } from "@/lib/ecommerceProductMap";
import { usePageFunnel } from "@/contexts/PageFunnelContext";
import { resolveFormTrackingContext, type PageTrackingContext } from "@shared/tracking-context";
import {
  DEFAULT_ECOMMERCE_PRODUCT_FIELD,
  resolveConversionProduct,
} from "@shared/resolveConversionProduct";
import {
  buildSignupPayloadFromFieldMap,
  isGlobalEntry,
  isSignupFieldMapReady,
  type AuthSignupFieldMapEntry,
} from "@shared/authSignupFieldMap";
import { useVariableDefinitions, useVariableContext } from "@/hooks/useVariables";
import { resolveTemplateString, resolveDeep, resolveVariable } from "@/lib/variable-manager";
import {
  isAuthConversionName,
  parseAuthConversionEventConfig,
} from "@shared/authConversionEvents";
import { resolveFormDefaults } from "@shared/resolveFormDefaults";
import { isUsVisitor } from "@shared/usVisitor";
import { resolveConsentCopy, extraConsentYamlFieldsFromObject, consentKeyFromYamlField, isBlankConsentHtml, parseConsentSettingsResponse, resolveConsentRequirement } from "@shared/consent-settings";
import { RichTextContent } from "@/components/ui/rich-text-content";
import {
  applyLeadFormOverrideOutcome,
  normalizeLeadFormTags,
  resolveLeadFormOverride,
  type LeadFormOverride,
} from "@shared/resolveLeadFormOverride";
import { useAuthUser, getConsumerToken } from "@/hooks/useAuthUser";
import { useInternalNav } from "@/hooks/useInternalNav";
import { resolveFormFields, type IdentityField } from "@/lib/resolveFormFields";
import {
  resolveLeadFormPhase,
  resolveLeadFormCopy,
  leadFormSubtitleClassName,
  type LeadFormLocale,
  type LeadFormSubtitleStyle,
} from "@/lib/resolveLeadFormCopy";
import {
  LeadFormFieldControl,
  type LeadFormComponentRenderer,
  type LeadFormCardsLayout,
  type LeadFormOption,
} from "@/components/lead_form/LeadFormFieldControl";
import {
  parseFormFieldSource,
  buildQueryOptionsUrl,
  catalogSourceKey,
  type FormFieldSourceInput,
} from "@shared/parseFormFieldSource";
import {
  applyChoiceCardinality,
  resolveFormFieldRelationSource,
  resolveSubmitValueFromOptions,
  type FormFieldOption as RelationFormFieldOption,
} from "@shared/resolveFormFieldRelationSource";
import type { RelationEditorHint } from "@shared/relation-field";

const StaffLeadConfirmDialog = lazy(() => import("@/components/lead_form/StaffLeadConfirmDialog"));

/** Runtime defaults when YAML omits `fields.*.component_renderer`. */
const SELECT_DEFAULT_FIELDS = new Set(["program", "plan", "location", "region"]);

function defaultComponentRenderer(fieldName: string): LeadFormComponentRenderer {
  if (fieldName === "phone") return "phone";
  if (fieldName === "client_comments") return "textarea";
  if (SELECT_DEFAULT_FIELDS.has(fieldName)) return "select";
  return "text";
}

/**
 * Merge pool options (form-options / source / locations) with form YAML `options[]` by `value`.
 * YAML overlays marketing copy; unknown values from YAML are appended.
 */
function mergeLeadFormOptions(
  pool: Array<{ value: string; label: string; description?: string; group?: string }>,
  overrides?: Array<Partial<LeadFormOption> & { value: string }> | null,
): LeadFormOption[] {
  if (!overrides?.length) {
    return pool.map((p) => ({
      value: p.value,
      label: p.label,
      description: p.description,
      group: p.group,
    }));
  }

  const overrideByValue = new Map(overrides.map((o) => [o.value, o]));
  const merged = pool.map((p) => {
    const ov = overrideByValue.get(p.value);
    if (!ov) {
      return {
        value: p.value,
        label: p.label,
        description: p.description,
        group: p.group,
      };
    }
    return {
      value: p.value,
      label: typeof ov.label === "string" && ov.label.trim() ? ov.label : p.label,
      title: typeof ov.title === "string" && ov.title.trim() ? ov.title.trim() : undefined,
      description: ov.description ?? p.description,
      group: ov.group ?? p.group,
      cta: ov.cta,
      icon: ov.icon,
      badge: ov.badge,
    };
  });

  const poolValues = new Set(pool.map((p) => p.value));
  for (const ov of overrides) {
    if (poolValues.has(ov.value)) continue;
    merged.push({
      value: ov.value,
      label: typeof ov.label === "string" && ov.label.trim() ? ov.label : ov.value,
      title: typeof ov.title === "string" && ov.title.trim() ? ov.title.trim() : undefined,
      description: ov.description,
      group: ov.group,
      cta: ov.cta,
      icon: ov.icon,
      badge: ov.badge,
    });
  }

  return merged;
}

/** Hidden payload defaults may be numbers/bools after resolveDeep (e.g. entry.id). */
type LeadFormFieldDefault = string | number | boolean;

/** Non-empty string, or any number/boolean (ids like event_id). */
function isNonEmptyLeadFormWireScalar(
  value: unknown,
): value is LeadFormFieldDefault {
  if (typeof value === "string") return value.trim() !== "";
  return typeof value === "number" || typeof value === "boolean";
}

interface FieldConfig {
  visible?: boolean;
  required?: boolean;
  /** String in YAML; may be number/boolean after section resolveDeep. */
  default?: LeadFormFieldDefault;
  default_country?: string; // e.g. "ES", "US" – passed to PhoneInput defaultCountry
  helper_text?: string;
  placeholder?: string;
  show_label?: boolean;
  label?: string;
  rows?: number;
  slugs?: string[]; // Legacy: limits which programs appear when `source` is omitted
  /** When set, options come from `/api/query-options` (content type or database). */
  source?: FormFieldSourceInput;
  /** Omitting uses `defaultComponentRenderer(fieldName)` at runtime. */
  component_renderer?: LeadFormComponentRenderer | string;
  /** Cards only: `grid` (default) or `showcase`. */
  layout?: LeadFormCardsLayout | string;
  /** Merged by `value` over pool options (programs/locations/source). */
  options?: Array<{
    value: string;
    label?: string;
    /** Cards only: card heading; falls back to `label`. Closed input uses `label`. */
    title?: string;
    description?: string;
    group?: string;
    cta?: string;
    icon?: string;
    /** Cards renderer: chip top-right on the option card. */
    badge?: string;
    [key: string]: unknown;
  }>;
}

export interface LeadFormData {
  variant?: "stacked" | "inline";
  conversion_name?: ConversionName;
  /**
   * Submit field that supplies ecommerce product identity for analytics (item_id).
   * Default "program". Scoped by page funnel.products when set.
   */
  ecommerce_product_field?: string;
  /** Signup mode: guests are registered via site auth settings; logged-in users skip known fields. */
  is_signup?: boolean;
  /**
   * When is_signup: if false, guests may only log in (no account create).
   * Default true when omitted.
   */
  allow_signup?: boolean;
  /** @deprecated Prefer `fields.plan.default`. Legacy fallback when fields.plan is omitted. */
  plan?: string;
  subtitle?: string;
  submit_label?: string;
  tags?: string;
  automations?: string;
  webhook?: {
    url?: string;
    method?: "POST" | "GET";
    headers?: Record<string, string>;
    fail_silently?: boolean;
  };
  fields?: {
    email?: FieldConfig;
    first_name?: FieldConfig;
    last_name?: FieldConfig;
    phone?: FieldConfig;
    program?: FieldConfig;
    plan?: FieldConfig;
    region?: FieldConfig;
    location?: FieldConfig;
    coupon?: FieldConfig;
    referral_key?: FieldConfig;
    client_comments?: FieldConfig;
    /** Sent on the lead webhook as current_download; usually hidden via visible: false. */
    current_download?: FieldConfig;
    /** Extra hidden payload keys (e.g. event_id) — not rendered in UI slots. */
    [key: string]: FieldConfig | undefined;
  };
  success?: {
    url?: string;
    message?: string;
    /** Invalidate entry page query in background after success (non-blocking). */
    reload_entry_fields?: boolean;
  };
  /**
   * Continuous form_overrides: first matching conditions (AND) overlays form props for UI + submit
   * (messages, webhook, success, tags, …). Condition values support {{ entry.* }} / {{ visitor.* }}
   * via resolveTemplateString. match_method: equals (default) | contains.
   * No match → root form props. See shared/resolveLeadFormOverride.ts.
   */
  form_overrides?: LeadFormOverride[];
  /** Phase copy for signup forms. Locale defaults apply when a stage is omitted. */
  messages?: {
    guest?: {
      title?: string | null;
      subtitle?: string | null;
      subtitle_style?: LeadFormSubtitleStyle;
      submit_label?: string;
      submit_disabled?: boolean;
    } | null;
    login?: {
      title?: string | null;
      subtitle?: string | null;
      subtitle_style?: LeadFormSubtitleStyle;
      submit_label?: string;
      back_label?: string;
      submit_disabled?: boolean;
    } | null;
    incomplete?: {
      title?: string | null;
      subtitle?: string | null;
      subtitle_style?: LeadFormSubtitleStyle;
      submit_label?: string;
      submit_disabled?: boolean;
    } | null;
    ready?: {
      title?: string | null;
      subtitle?: string | null;
      subtitle_style?: LeadFormSubtitleStyle;
      submit_label?: string;
      submit_disabled?: boolean;
    } | null;
  };
  consent?: {
    email?: boolean;
    sms?: boolean;
    whatsapp?: boolean;
    marketing?: boolean;
    marketing_text?: string;
    sms_text?: string;
    sms_usa_only?: boolean;
    [key: string]: boolean | string | undefined;
  };
  show_terms?: boolean;
  terms_url?: string;
  privacy_url?: string;
  className?: string;
  button_className?: string;
  terms_className?: string;
  turnstile?: {
    enabled?: boolean;
    theme?: "light" | "dark" | "auto";
    size?: "normal" | "compact";
  };
}

interface LeadFormProps {
  data: LeadFormData;
  termsStyle?: React.CSSProperties;
}

interface FormOptions {
  programs: Array<{ slug: string; title: string; bc_slug?: string }>;
  locations: Array<{ slug: string; name: string; city: string; country: string; country_code?: string; region: string }>;
  regions: Array<{ slug: string; label: string }>;
}

interface FormValues {
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  program: string;
  plan: string;
  region: string;
  location: string;
  coupon: string;
  referral_key: string;
  client_comments: string;
  current_download: string;
  consent_email: boolean;
  consent_sms: boolean;
  consent_whatsapp: boolean;
  consent_general: boolean;
  [key: string]: string | boolean;
}

interface ConsentSectionProps {
  consent: NonNullable<LeadFormData["consent"]>;
  form: ReturnType<typeof useForm<FormValues>>;
  locale: string;
  formOptions?: FormOptions;
  sessionLocation: { slug: string; region: string; country?: string; country_code?: string } | null;
  geo?: { country_code?: string } | null;
  consentSettings?: Record<string, Record<string, string> | string>;
  fallbackKey?: string | null;
}

const CONSENT_COPY_CLASS =
  "text-xs text-muted-foreground max-w-none prose-p:my-0 prose-p:leading-snug [&_p]:m-0 [&_a]:underline [&_a]:text-inherit hover:[&_a]:text-foreground";

function ConsentMessage({ html, testId }: { html: string; testId?: string }) {
  if (!html?.trim()) return null;
  return (
    <RichTextContent
      html={html}
      className={CONSENT_COPY_CLASS}
      data-testid={testId}
    />
  );
}

function consentRequiredMessage(locale: string): string {
  return locale === "es" ? "Por favor marca esta casilla para continuar" : "Please check this box to continue";
}

function FallbackConsentField({
  form,
  locale,
  fallbackKey,
  html,
  className,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
  locale: string;
  fallbackKey: string;
  html: string;
  className?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={fallbackKey}
      rules={{ validate: (value) => value === true || consentRequiredMessage(locale) }}
      render={({ field, fieldState }) => (
        <FormItem className={className ?? "flex flex-col space-y-2"}>
          <div className="flex flex-row items-start space-x-3">
            <FormControl>
              <Checkbox
                checked={!!field.value}
                onCheckedChange={field.onChange}
                data-testid={fallbackKey === "consent_general" ? "checkbox-consent-general" : "checkbox-consent-fallback"}
              />
            </FormControl>
            <div
              className="min-w-0 cursor-pointer leading-none"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) return;
                field.onChange(!field.value);
              }}
            >
              <ConsentMessage html={html} />
            </div>
          </div>
          {fieldState.error && (
            <p className="text-sm text-destructive" data-testid="text-consent-general-error">
              {fieldState.error.message}
            </p>
          )}
        </FormItem>
      )}
    />
  );
}

function ConsentSection({ consent, form, locale, formOptions, sessionLocation, geo, consentSettings, fallbackKey }: ConsentSectionProps) {
  const selectedLocationSlug = form.watch("location");
  const selectedLocation = selectedLocationSlug
    ? formOptions?.locations.find((loc) => loc.slug === selectedLocationSlug)
    : undefined;

  const showSmsConsent =
    consent.sms && (!consent.sms_usa_only || isUsVisitor({ selectedLocation, sessionLocation, geo }));

  const defaultMarketingText = resolveConsentCopy("consent_marketing", consentSettings?.consent_marketing, locale);
  const defaultSmsText = resolveConsentCopy("consent_sms", consentSettings?.consent_sms, locale);
  const defaultEmailText = resolveConsentCopy("consent_email", consentSettings?.consent_email, locale);
  const defaultWhatsappText = resolveConsentCopy("consent_whatsapp", consentSettings?.consent_whatsapp, locale);
  const requirement = resolveConsentRequirement(consent, fallbackKey, { locale, messages: consentSettings });
  const requiredRule = (yamlField: string) =>
    requirement.required.includes(yamlField)
      ? { validate: (value: unknown) => value === true || consentRequiredMessage(locale) }
      : undefined;
  const fallbackCopy = requirement.fallbackKey
    ? resolveConsentCopy(requirement.fallbackKey, consentSettings?.[requirement.fallbackKey], locale)
    : "";

  return (
    <div className="space-y-4">
      {requirement.showFallback && requirement.fallbackKey && (
        <FallbackConsentField
          form={form}
          locale={locale}
          fallbackKey={requirement.fallbackKey}
          html={fallbackCopy}
        />
      )}

      {consent.marketing && (
        <FormField
          control={form.control}
          name="consent_email"
          rules={requiredRule("marketing")}
          render={({ field, fieldState }) => (
            <FormItem className="flex flex-col space-y-2">
              <div className="flex flex-row items-start space-x-3">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="checkbox-consent-marketing"
                  />
                </FormControl>
                <div
                  className="min-w-0 cursor-pointer leading-none"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a")) return;
                    field.onChange(!field.value);
                  }}
                >
                  <ConsentMessage html={consent.marketing_text || defaultMarketingText} />
                </div>
              </div>
              {fieldState.error && (
                <p className="text-sm text-destructive" data-testid="text-consent-error">
                  {fieldState.error.message}
                </p>
              )}
            </FormItem>
          )}
        />
      )}

      {!consent.marketing && consent.email && (
        <FormField
          control={form.control}
          name="consent_email"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  data-testid="checkbox-consent-email"
                />
              </FormControl>
              <div
                className="min-w-0 cursor-pointer leading-none"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a")) return;
                  field.onChange(!field.value);
                }}
              >
                <ConsentMessage html={defaultEmailText} />
              </div>
            </FormItem>
          )}
        />
      )}

      {showSmsConsent && (
        <FormField
          control={form.control}
          name="consent_sms"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  data-testid="checkbox-consent-sms"
                />
              </FormControl>
              <div
                className="min-w-0 cursor-pointer leading-none"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a")) return;
                  field.onChange(!field.value);
                }}
              >
                <ConsentMessage html={consent.sms_text || defaultSmsText} />
              </div>
            </FormItem>
          )}
        />
      )}

      {!consent.marketing && consent.whatsapp && (
        <FormField
          control={form.control}
          name="consent_whatsapp"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  data-testid="checkbox-consent-whatsapp"
                />
              </FormControl>
              <div
                className="min-w-0 cursor-pointer leading-none"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a")) return;
                  field.onChange(!field.value);
                }}
              >
                <ConsentMessage html={defaultWhatsappText} />
              </div>
            </FormItem>
          )}
        />
      )}

      {extraConsentYamlFieldsFromObject(consent).map((yamlField) => {
        const settingsKey = consentKeyFromYamlField(yamlField);
        if (consent[yamlField] !== true) return null;
        const text = resolveConsentCopy(settingsKey, consentSettings?.[settingsKey], locale);
        if (isBlankConsentHtml(text)) return null;
        return (
          <FormField
            key={yamlField}
            control={form.control}
            name={`consent_${yamlField}`}
            rules={requiredRule(yamlField)}
            render={({ field, fieldState }) => (
              <FormItem className="flex flex-col space-y-2">
                <div className="flex flex-row items-start space-x-3">
                  <FormControl>
                    <Checkbox
                      checked={!!field.value}
                      onCheckedChange={field.onChange}
                      data-testid={`checkbox-consent-${yamlField}`}
                    />
                  </FormControl>
                  <div
                    className="min-w-0 cursor-pointer leading-none"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a")) return;
                      field.onChange(!field.value);
                    }}
                  >
                    <ConsentMessage html={text} />
                  </div>
                </div>
                {fieldState.error && (
                  <p className="text-sm text-destructive" data-testid={`text-consent-${yamlField}-error`}>
                    {fieldState.error.message}
                  </p>
                )}
              </FormItem>
            )}
          />
        );
      })}
    </div>
  );
}

/** Public, non-secret subset of a conversion event (GET /api/settings/tracking/conversion-events). */
type PublicConversionEventConfig = Pick<
  TrackingSettingsResponse["conversion_events"][number],
  "name" | "tags" | "automations" | "consent" | "success"
>;

/** GET /api/settings/tracking/conversion-events — public list; no webhooks or staff intent. */
type PublicConversionEventsResponse = {
  events: PublicConversionEventConfig[];
  auth: Record<string, unknown>;
};

function findPublicConversionEvent(
  events: PublicConversionEventConfig[] | undefined,
  name: string | undefined,
): PublicConversionEventConfig | undefined {
  if (!name || !events?.length) return undefined;
  return events.find((event) => event.name === name);
}

type EffectiveWebhook = {
  url?: string;
  method?: "POST" | "GET";
  headers?: Record<string, string>;
  fail_silently?: boolean;
};

/** Resolve conversion/success/tags/webhook for one submit (override > form root > event). */
function buildEffectiveSubmitConfig(
  formData: LeadFormData,
  values: Record<string, unknown>,
  events: PublicConversionEventConfig[] | undefined,
  resolveValue?: (raw: string) => unknown,
  entry?: Record<string, unknown> | null,
): {
  conversion_name?: string;
  success?: { url?: string; message?: string; reload_entry_fields?: boolean };
  tags: string;
  automations: string;
  /** Delivery override when url is set. */
  formWebhook: EffectiveWebhook | null;
} {
  const override = resolveLeadFormOverride(values, formData.form_overrides, {
    resolveValue,
    entry,
  });
  const overlaid = applyLeadFormOverrideOutcome(
    formData as Record<string, unknown>,
    override,
  ) as LeadFormData;

  const conversionName = overlaid.conversion_name;
  const eventEntry = findPublicConversionEvent(events, conversionName) ?? null;

  let resolved: LeadFormData = overlaid;
  if (eventEntry) {
    const wrapped = resolveFormDefaults(
      { _f: overlaid } as Record<string, unknown>,
      {
        name: eventEntry.name,
        automations: eventEntry.automations,
        tags: eventEntry.tags,
        consent: eventEntry.consent,
        success: eventEntry.success,
      },
      "_f",
    );
    resolved = wrapped._f as LeadFormData;
  }

  const wh = resolved.webhook;
  const formWebhook: EffectiveWebhook | null =
    wh && wh.url
      ? {
          url: wh.url,
          method: (wh.method === "GET" ? "GET" : "POST") as "POST" | "GET",
          ...(wh.headers && Object.keys(wh.headers).length > 0
            ? { headers: wh.headers }
            : {}),
          ...(wh.fail_silently === true ? { fail_silently: true } : {}),
        }
      : null;

  return {
    conversion_name: resolved.conversion_name ?? conversionName,
    success: resolved.success,
    tags: normalizeLeadFormTags(resolved.tags),
    automations: resolved.automations || "strong",
    formWebhook,
  };
}

export default function LeadForm({ data, termsStyle }: LeadFormProps) {
  const landingLocations = undefined as string[] | undefined;
  const { slug, contentType, singleEntry, locale: sectionLocale } = useSectionContext();
  const programContext = contentType === "program" ? slug : undefined;
  const pageFunnel = usePageFunnel();
  const [locationPath] = useLocation();
  /** Page locale (SectionContext → path). Used for copy, options, and reload_entry_fields queryKeys. */
  const locale: LeadFormLocale =
    normalizeLocale(sectionLocale || localeFromPath(locationPath)) === "es" ? "es" : "en";
  const { session, setConversionPage } = useSession();
  const sessionLocation = useSessionLocation();
  const utm = useUTM();
  const nav = useInternalNav();
  const [isSuccess, setIsSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showTurnstileModal, setShowTurnstileModal] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<FormValues | null>(null);
  const [staffConfirmValues, setStaffConfirmValues] = useState<FormValues | null>(null);
  const [loginMode, setLoginMode] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [pendingAutoSubmit, setPendingAutoSubmit] = useState(false);

  const turnstileEnabled = false; // TEMP-TURNSTILE-BYPASS was: data.turnstile?.enabled ?? true

  const { data: turnstileSiteKey, isLoading: turnstileSiteKeyLoading } = useQuery<{ siteKey: string }>({
    queryKey: ["/api/turnstile/site-key"],
    enabled: turnstileEnabled,
  });
  // Captcha only gates submit when a site key is actually available; otherwise
  // we'd open a modal that never renders and the form would appear stuck.
  const turnstileReady = turnstileEnabled && !!turnstileSiteKey?.siteKey;
  // Enabled in YAML but no site key configured (keys missing / endpoint erroring).
  const turnstileMisconfigured =
    turnstileEnabled && !turnstileSiteKeyLoading && !turnstileSiteKey?.siteKey;

  // Public, non-secret defaults for every conversion event. The full /api/settings/tracking
  // is admin-only (metrics_view) and is intentionally NOT used here, so anonymous visitors,
  // staff and local dev all get identical behavior. One list covers form_overrides that
  // switch conversion_name, and forms without a name still get `auth` for signup/login.
  const { data: publicConversionEvents } = useQuery<PublicConversionEventsResponse>({
    queryKey: ["/api/settings/tracking/conversion-events"],
    staleTime: 5 * 60 * 1000,
  });
  const conversionEventConfig = findPublicConversionEvent(
    publicConversionEvents?.events,
    data.conversion_name,
  );

  const { data: legalSettings } = useQuery<{ legal_terms_url: string; legal_privacy_url: string }>({
    queryKey: ["/api/settings/legal"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: consentSettingsRaw } = useQuery({
    queryKey: ["/api/settings/consent"],
    staleTime: 5 * 60 * 1000,
  });
  const { fallback: consentFallbackKey, messages: consentSettings } = parseConsentSettingsResponse(consentSettingsRaw);

  // Signup mode (is_signup): active only when site auth settings are configured,
  // so a stale YAML flag can never break submissions.
  const isSignupRequested = data.is_signup === true;
  const allowSignup = data.allow_signup !== false;
  const { data: authSettings } = useQuery<{
    signup_configured: boolean;
    signup_field_map_ready?: boolean;
    host?: string;
    login?: { url?: string };
    signup?: { field_map?: AuthSignupFieldMapEntry[] };
  }>({
    queryKey: ["/api/settings/auth"],
    enabled: isSignupRequested,
    staleTime: 5 * 60 * 1000,
  });
  const { data: variableDefinitions } = useVariableDefinitions();
  const variableContext = useVariableContext();
  const authConversionCfg = parseAuthConversionEventConfig(publicConversionEvents?.auth ?? {});
  // Account create path: needs field_map. Login-only gate does not.
  const signupActive =
    isSignupRequested &&
    allowSignup &&
    authSettings?.signup_configured === true &&
    isSignupFieldMapReady(authSettings?.signup?.field_map);

  const {
    profile: authProfile,
    isLoggedIn,
    isLoading: authProfileLoading,
    token: consumerAuthToken,
    setToken: setConsumerToken,
    clearToken: clearConsumerAuth,
  } = useAuthUser({
    enabled: isSignupRequested,
  });

  // Login-only: guests must use in-form login (no account create).
  useEffect(() => {
    if (!isSignupRequested || allowSignup || isLoggedIn) return;
    setLoginMode(true);
  }, [isSignupRequested, allowSignup, isLoggedIn]);

  // Show for any signup form guest (is_signup), even if signup API isn't fully configured.
  // Hide when login-only (already on login UI) or already in login mode.
  const showSignupLoginPrompt =
    isSignupRequested && allowSignup && !isLoggedIn && !loginMode;

  const signupLoginPrompt = showSignupLoginPrompt ? (
    <p
      className="text-sm text-center text-muted-foreground mt-3"
      data-testid="text-signup-login-prompt"
    >
      {locale === "es" ? "¿Ya tienes una cuenta? " : "Already have an account? "}
      <button
        type="button"
        onClick={() => {
          setLoginError(null);
          setLoginPassword("");
          setLoginMode(true);
        }}
        className="underline hover:text-foreground font-medium text-primary"
        data-testid="button-signup-login"
      >
        {locale === "es" ? "Inicia sesión aquí" : "Login here"}
      </button>
    </p>
  ) : null;

  // Always when logged in on a signup form (mirrors the guest login prompt chrome).
  const switchAccountName =
    (authProfile?.first_name || "").trim() ||
    (authProfile?.email || "").trim() ||
    (authProfile?.username || "").trim();

  const switchAccountPrompt =
    isSignupRequested && isLoggedIn ? (
      <p
        className="text-sm text-center text-muted-foreground mt-3"
        data-testid="text-switch-account-prompt"
      >
        {switchAccountName
          ? locale === "es"
            ? `¿No eres ${switchAccountName}? `
            : `Not ${switchAccountName}? `
          : locale === "es"
            ? "¿No eres tú? "
            : "Not you? "}
        <button
          type="button"
          onClick={() => {
            clearConsumerAuth();
            setLoginMode(false);
            setLoginError(null);
            setLoginPassword("");
            setPendingAutoSubmit(false);
            setSubmitError(null);
          }}
          className="underline hover:text-foreground font-medium text-primary"
          data-testid="button-switch-account-logout"
        >
          {locale === "es" ? "Cerrar sesión" : "Log out"}
        </button>
      </p>
    ) : null;

  // Identity fields already known from the logged-in profile: hidden from the UI
  // but prefilled so they are still part of the submitted payload.
  // Use is_signup (not signup API configured) so in-place login still skips known fields.
  const { hidden: hiddenIdentityFields, prefill: identityPrefill } = resolveFormFields(
    isSignupRequested && isLoggedIn,
    authProfile
      ? {
          email: authProfile.email,
          first_name: authProfile.first_name,
          last_name: authProfile.last_name,
          phone: authProfile.phone,
        }
      : null,
  );

  const variant = data.variant || "stacked";
  const fields = data.fields || {};

  // Apply per-event defaults via resolveFormDefaults (form-level YAML values always win)
  const eventEntry = data.conversion_name ? conversionEventConfig : undefined;

  const resolvedData: LeadFormData = (() => {
    if (!eventEntry) return data;
    const wrapped = resolveFormDefaults(
      { _f: data } as Record<string, unknown>,
      {
        name: eventEntry.name,
        automations: eventEntry.automations,
        tags: eventEntry.tags,
        consent: eventEntry.consent,
        success: eventEntry.success,
      },
      "_f"
    );
    return wrapped._f as LeadFormData;
  })();

  const consent: NonNullable<LeadFormData["consent"]> = resolvedData.consent ?? {};
  const extraConsentFields = extraConsentYamlFieldsFromObject(consent);
  const showTerms = resolvedData.show_terms ?? true;
  // Effective terms/privacy URLs: form YAML wins; event default fills gap; legal settings fallback
  const effectiveTermsUrl = resolvedData.terms_url || null;
  const effectivePrivacyUrl = resolvedData.privacy_url || null;

  const hasLandingLocations = landingLocations && landingLocations.length > 0;
  const singleLandingLocation = hasLandingLocations && landingLocations.length === 1 ? landingLocations[0] : null;
  const multipleLandingLocations = hasLandingLocations && landingLocations.length > 1 ? landingLocations : null;

  const { data: formOptions } = useQuery<FormOptions>({
    queryKey: ["/api/form-options", locale],
  });

  const { data: contentTypeConfig } = useQuery<{
    editor?: Record<string, { type?: string } & RelationEditorHint>;
  }>({
    queryKey: [`/api/content-types/${contentType}/config`],
    enabled: !!contentType,
    staleTime: 5 * 60 * 1000,
  });

  const programSourceRaw = fields.program?.source;
  const programSource = programSourceRaw
    ? parseFormFieldSource(programSourceRaw)
    : null;
  const programCatalogKey = programSource ? catalogSourceKey(programSource) : undefined;

  const planSourceRaw = fields.plan?.source;
  const planSource = planSourceRaw ? parseFormFieldSource(planSourceRaw) : null;
  const planCatalogKey = planSource ? catalogSourceKey(planSource) : undefined;

  const { data: programQueryOptions } = useQuery<{
    options: Array<{ value: string; label: string }>;
  }>({
    queryKey: [
      "/api/query-options",
      programCatalogKey,
      programSource?.content_type,
      programSource?.database,
      programSource?.query,
      programSource?.value_path,
      programSource?.label_path,
      locale,
    ],
    enabled: !!programCatalogKey && !!programSource?.value_path && !!programSource?.label_path,
    queryFn: async () => {
      if (!programCatalogKey) return { options: [] };
      const url = buildQueryOptionsUrl(programSource!, locale);
      const res = await apiFetch(url);
      if (!res.ok) {
        throw new Error(`${res.status}: ${await res.text()}`);
      }
      return res.json();
    },
  });

  const { data: planQueryOptions } = useQuery<{
    options: Array<{ value: string; label: string }>;
  }>({
    queryKey: [
      "/api/query-options",
      "plan",
      planCatalogKey,
      planSource?.content_type,
      planSource?.database,
      planSource?.query,
      planSource?.value_path,
      planSource?.label_path,
      locale,
    ],
    enabled: !!planCatalogKey && !!planSource?.value_path && !!planSource?.label_path,
    queryFn: async () => {
      if (!planCatalogKey) return { options: [] };
      const url = buildQueryOptionsUrl(planSource!, locale);
      const res = await apiFetch(url);
      if (!res.ok) {
        throw new Error(`${res.status}: ${await res.text()}`);
      }
      return res.json();
    },
  });

  const programCatalogByPointer = useMemo(() => {
    const map = new Map<string, { label?: string; bc_slug?: string }>();
    for (const p of formOptions?.programs ?? []) {
      map.set(p.slug, { label: p.title, bc_slug: p.bc_slug || p.slug });
      if (p.bc_slug) map.set(p.bc_slug, { label: p.title, bc_slug: p.bc_slug });
    }
    return map;
  }, [formOptions?.programs]);

  const programRelationOptions = useMemo((): RelationFormFieldOption[] => {
    if (!programSource?.related_field) return [];
    const resolved = resolveFormFieldRelationSource({
      formFieldName: "program",
      relationField: programSource.related_field,
      singleEntry: singleEntry ?? {},
      editorHint: contentTypeConfig?.editor?.[programSource.related_field],
      catalogByPointer: programCatalogByPointer,
      requireCatalogHit: false,
      valuePath: programSource.value_path,
      labelPath: programSource.label_path,
    });
    return resolved.ok ? resolved.options : [];
  }, [
    programSource?.related_field,
    programSource?.value_path,
    programSource?.label_path,
    singleEntry,
    contentTypeConfig?.editor,
    programCatalogByPointer,
  ]);

  const planRelationOptions = useMemo((): RelationFormFieldOption[] => {
    if (!planSource?.related_field) return [];
    const resolved = resolveFormFieldRelationSource({
      formFieldName: "plan",
      relationField: planSource.related_field,
      singleEntry: singleEntry ?? {},
      editorHint: contentTypeConfig?.editor?.[planSource.related_field],
      requireCatalogHit: false,
      valuePath: planSource.value_path,
      labelPath: planSource.label_path,
    });
    return resolved.ok ? resolved.options : [];
  }, [
    planSource?.related_field,
    planSource?.value_path,
    planSource?.label_path,
    singleEntry,
    contentTypeConfig?.editor,
  ]);

  const landingRegions = (() => {
    if (!hasLandingLocations || !formOptions?.locations) return null;
    const regionSlugs = new Set<string>();
    for (const locSlug of landingLocations!) {
      const found = formOptions.locations.find(l => l.slug === locSlug);
      if (found) regionSlugs.add(found.region);
    }
    return regionSlugs.size > 0 ? Array.from(regionSlugs) : null;
  })();

  const singleLandingRegion = landingRegions && landingRegions.length === 1 ? landingRegions[0] : null;
  const multipleLandingRegions = landingRegions && landingRegions.length > 1 ? landingRegions : null;

  const getFieldConfig = (fieldName: keyof NonNullable<LeadFormData["fields"]>): FieldConfig => {
    const defaults: Record<string, FieldConfig> = {
      email: { visible: true, required: true },
      first_name: { visible: false, required: false },
      last_name: { visible: false, required: false },
      phone: { visible: false, required: false },
      program: { visible: false, required: false, default: "auto" },
      // Legacy top-level `plan` seeds the default when fields.plan is omitted.
      plan: { visible: false, required: false, default: data.plan || "" },
      region: { visible: false, required: false, default: "auto" },
      location: { visible: false, required: false, default: "auto" },
      coupon: { visible: false, required: false, default: "auto" },
      referral_key: { visible: false, required: false },
      client_comments: { visible: false, required: false },
      current_download: { visible: false, required: false },
    };
    let baseConfig = { ...defaults[fieldName], ...fields[fieldName] };

    // Signup mode: identity fields already known from the profile are hidden
    // (their values are prefilled and still submitted).
    if (hiddenIdentityFields.has(fieldName as IdentityField)) {
      return { ...baseConfig, visible: false, required: false };
    }

    if (fieldName === "location" && hasLandingLocations) {
      if (singleLandingLocation) {
        return { ...baseConfig, visible: false, default: singleLandingLocation };
      }
      if (multipleLandingLocations) {
        return { ...baseConfig, visible: true, required: true, default: "" };
      }
    }

    if (fieldName === "region" && hasLandingLocations) {
      if (singleLandingRegion) {
        return { ...baseConfig, visible: false, required: false, default: singleLandingRegion };
      }
      if (multipleLandingRegions) {
        return { ...baseConfig, visible: true, required: true, default: "" };
      }
    }

    // When source is set, cardinality overrides authored visible/default/required.
    // relation ignores default: auto (options drive the default).
    const sourceRaw = baseConfig.source;
    if (sourceRaw) {
      const src = parseFormFieldSource(sourceRaw);
      let options: RelationFormFieldOption[] = [];
      if (fieldName === "program") {
        if (src.related_field) options = programRelationOptions;
        else if (catalogSourceKey(src)) {
          options = (programQueryOptions?.options ?? []).map((o) => ({
            value: o.value,
            label: o.label,
            bc_slug: o.value,
          }));
        }
      } else if (fieldName === "plan") {
        if (src.related_field) options = planRelationOptions;
        else if (catalogSourceKey(src)) {
          options = (planQueryOptions?.options ?? []).map((o) => ({
            value: o.value,
            label: o.label,
          }));
        }
      }
      if (src.related_field || catalogSourceKey(src)) {
        const normalizedDefault =
          typeof baseConfig.default === "string"
            ? baseConfig.default
            : baseConfig.default !== undefined
              ? String(baseConfig.default)
              : undefined;
        const authoredDefault =
          src.related_field && normalizedDefault === "auto"
            ? { ...baseConfig, default: "" }
            : { ...baseConfig, default: normalizedDefault };
        const { mode: _mode, ...card } = applyChoiceCardinality(authoredDefault, options);
        baseConfig = card;
      }
    }

    return baseConfig;
  };

  const resolveFieldRenderer = (
    fieldName: keyof NonNullable<LeadFormData["fields"]>,
  ): LeadFormComponentRenderer => {
    const raw = getFieldConfig(fieldName).component_renderer;
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim() as LeadFormComponentRenderer;
    }
    return defaultComponentRenderer(fieldName as string);
  };

  const resolveFieldCardsLayout = (
    fieldName: keyof NonNullable<LeadFormData["fields"]>,
  ): LeadFormCardsLayout | undefined => {
    const raw = getFieldConfig(fieldName).layout;
    if (raw === "showcase" || raw === "grid") return raw;
    return undefined;
  };

  const resolveDefault = (
    fieldName: string,
    configDefault?: LeadFormFieldDefault,
  ): string => {
    if (configDefault === undefined || configDefault === null) return "";
    if (typeof configDefault !== "string") return String(configDefault);
    if (configDefault !== "auto") {
      return configDefault;
    }

    switch (fieldName) {
      case "program":
        return programContext || "";
      case "location":
        if (singleLandingLocation) return singleLandingLocation;
        return sessionLocation?.slug || "";
      case "region":
        if (singleLandingRegion) return singleLandingRegion;
        return sessionLocation?.region || "";
      case "coupon":
        return utm.coupon || "";
      case "referral_key":
        return utm.referral_key || utm.referral || utm.ref || "";
      default:
        return "";
    }
  };

  const programFieldSlugs = fields.program?.slugs;
  const visiblePrograms = (() => {
    if (programSource?.related_field) {
      return programRelationOptions.map((o) => ({
        slug: o.value,
        bc_slug: o.bc_slug || o.value,
        title: o.label,
      }));
    }
    if (programCatalogKey) {
      return (programQueryOptions?.options ?? []).map((o) => ({
        slug: o.value,
        bc_slug: o.value,
        title: o.label,
      }));
    }
    if (!formOptions?.programs) return [];
    // An empty slugs array is treated the same as "not configured" — show all programs.
    // This avoids an empty dropdown when slugs is accidentally set to [].
    if (!programFieldSlugs || programFieldSlugs.length === 0) return formOptions.programs;
    return programFieldSlugs
      .map(slug => formOptions.programs.find(p => p.slug === slug || p.bc_slug === slug))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);
  })();

  const planFieldSlugs = fields.plan?.slugs;
  const visiblePlans = (() => {
    if (planSource?.related_field) {
      return planRelationOptions.map((o) => ({ value: o.bc_slug || o.value, label: o.label }));
    }
    if (planCatalogKey) {
      return planQueryOptions?.options ?? [];
    }
    if (planFieldSlugs && planFieldSlugs.length > 0) {
      return planFieldSlugs.map((slug) => ({ value: slug, label: slug }));
    }
    return [] as Array<{ value: string; label: string }>;
  })();

  const form = useForm<FormValues>({
    defaultValues: {
      email: "",
      first_name: resolveDefault("first_name", getFieldConfig("first_name").default),
      last_name: resolveDefault("last_name", getFieldConfig("last_name").default),
      phone: resolveDefault("phone", getFieldConfig("phone").default),
      program: resolveDefault("program", getFieldConfig("program").default),
      plan: resolveDefault("plan", getFieldConfig("plan").default),
      region: resolveDefault("region", getFieldConfig("region").default),
      location: resolveDefault("location", getFieldConfig("location").default),
      coupon: resolveDefault("coupon", getFieldConfig("coupon").default),
      referral_key: resolveDefault("referral_key", getFieldConfig("referral_key").default),
      client_comments: resolveDefault("client_comments", getFieldConfig("client_comments").default),
      current_download: resolveDefault("current_download", getFieldConfig("current_download").default),
      consent_email: false,
      consent_sms: false,
      consent_whatsapp: false,
      consent_general: false,
      ...Object.fromEntries(extraConsentFields.map((field) => [`consent_${field}`, false])),
    },
  });

  useEffect(() => {
    for (const field of extraConsentFields) {
      const name = `consent_${field}`;
      if (form.getValues(name) === undefined) {
        form.setValue(name, false);
      }
    }
    if (consentFallbackKey && form.getValues(consentFallbackKey) === undefined) {
      form.setValue(consentFallbackKey, false);
    }
    // extraConsentFields is derived from YAML; join() is the stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraConsentFields.join(","), consentFallbackKey, form]);

  // Prefill identity fields from the logged-in profile (signup mode). The values
  // stay in the form state so hidden fields are still included in the payload.
  useEffect(() => {
    if (identityPrefill.email) form.setValue("email", identityPrefill.email);
    if (identityPrefill.first_name) form.setValue("first_name", identityPrefill.first_name);
    if (identityPrefill.last_name) form.setValue("last_name", identityPrefill.last_name);
    if (identityPrefill.phone) form.setValue("phone", identityPrefill.phone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    identityPrefill.email,
    identityPrefill.first_name,
    identityPrefill.last_name,
    identityPrefill.phone,
    form,
  ]);

  // Carry email into the in-place login form when switching views.
  useEffect(() => {
    if (!loginMode) return;
    const email = form.getValues("email");
    if (email) setLoginEmail(email);
  }, [loginMode, form]);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/password-login", {
        email: loginEmail.trim(),
        password: loginPassword,
      });
      const text = await res.text();
      try {
        return JSON.parse(text) as { token: string };
      } catch {
        throw new Error(
          locale === "es"
            ? "El servidor de login devolvió una respuesta inválida. Reinicia el servidor de desarrollo e inténtalo de nuevo."
            : "Login server returned an invalid response. Restart the dev server and try again.",
        );
      }
    },
    onSuccess: (data) => {
      if (!data?.token) {
        setLoginError(locale === "es" ? "Login sin token" : "Login succeeded but no token returned");
        return;
      }
      trackConversion(authConversionCfg.login_event_name, {
        email: loginEmail.trim() || undefined,
      });
      setConsumerToken(data.token);
      setLoginMode(false);
      setLoginPassword("");
      setLoginError(null);
      setPendingAutoSubmit(true);
    },
    onError: (error: Error) => {
      let message = error.message || (locale === "es" ? "No se pudo iniciar sesión" : "Login failed");
      try {
        const jsonPart = message.replace(/^\d+:\s*/, "");
        const parsed = JSON.parse(jsonPart) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        // keep message
      }
      if (
        message.length > 200 ||
        /<[^>]+>/.test(message) ||
        /unexpected token/i.test(message) ||
        /<!doctype/i.test(message)
      ) {
        message = locale === "es" ? "No se pudo iniciar sesión" : "Login failed";
      }
      setLoginError(message);
    },
  });

  useEffect(() => {
    if (singleLandingLocation) {
      form.setValue("location", singleLandingLocation);
    } else if (sessionLocation && !form.getValues("location")) {
      // Only autofill when the session campus is among listed form options
      // (Florida etc. hide most campuses — a foreign slug blanks the Select).
      const listed = formOptions?.locations;
      const sessionSlugOk =
        !listed || listed.some((loc) => loc.slug === sessionLocation.slug);
      if (sessionSlugOk) {
        form.setValue("location", sessionLocation.slug);
      }
    }
    if (singleLandingRegion) {
      form.setValue("region", singleLandingRegion);
    } else if (sessionLocation?.region && !form.getValues("region")) {
      const listedRegions = formOptions?.locations?.map((loc) => loc.region) ?? [];
      const sessionRegionOk =
        listedRegions.length === 0 || listedRegions.includes(sessionLocation.region);
      if (sessionRegionOk) {
        form.setValue("region", sessionLocation.region);
      }
    }
    if (utm.coupon && !form.getValues("coupon")) {
      form.setValue("coupon", utm.coupon);
    }
    const urlReferral = utm.referral_key || utm.referral || utm.ref;
    if (urlReferral && !form.getValues("referral_key")) {
      form.setValue("referral_key", urlReferral);
    }
    if (programContext && !form.getValues("program")) {
      form.setValue("program", programContext);
    }
  }, [sessionLocation, utm, programContext, form, singleLandingLocation, singleLandingRegion, formOptions?.locations]);

  useEffect(() => {
    if (programSource?.related_field || programCatalogKey) {
      if (programCatalogKey && !programQueryOptions?.options) return;
      const currentValue = form.getValues("program");
      if (!currentValue) return;
      const isValid = visiblePrograms.some(p => (p.bc_slug || p.slug) === currentValue);
      if (!isValid) form.setValue("program", "");
      return;
    }
    if (!programFieldSlugs?.length || !formOptions?.programs) return;
    const currentValue = form.getValues("program");
    if (!currentValue) return;
    const isValid = visiblePrograms.some(p => (p.bc_slug || p.slug) === currentValue);
    if (!isValid) {
      form.setValue("program", "");
    }
  }, [visiblePrograms, programFieldSlugs, formOptions?.programs, programSource, programQueryOptions?.options, form]);

  // When source cardinality hides + autofills a single option, keep form value in sync.
  useEffect(() => {
    const programCfg = getFieldConfig("program");
    if (programSource && programCfg.default && !programCfg.visible) {
      form.setValue("program", resolveDefault("program", programCfg.default));
    }
    const planCfg = getFieldConfig("plan");
    if (planSource && planCfg.default && !planCfg.visible) {
      form.setValue("plan", resolveDefault("plan", planCfg.default));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    programSource?.related_field,
    programCatalogKey,
    planSource?.related_field,
    planCatalogKey,
    programRelationOptions,
    planRelationOptions,
    programQueryOptions?.options,
    planQueryOptions?.options,
    form,
  ]);

  /** Same field defaults used for lead payload and route matching. */
  const resolveEffectiveFieldValues = (values: FormValues) => {
    const programOpts: RelationFormFieldOption[] = programSource?.related_field
      ? programRelationOptions
      : programCatalogKey
        ? (programQueryOptions?.options ?? []).map((o) => ({
            value: o.value,
            label: o.label,
            bc_slug: o.value,
          }))
        : visiblePrograms.map((p) => ({
            value: p.slug,
            label: p.title,
            bc_slug: p.bc_slug || p.slug,
          }));

    const rawProgram =
      values.program ||
      formOptions?.programs.find((p) => p.slug === programContext)?.bc_slug ||
      programContext ||
      resolveDefault("program", getFieldConfig("program").default);

    const resolved: Record<string, LeadFormFieldDefault> = {
      ...Object.fromEntries(
        Object.entries(values).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
      program: resolveSubmitValueFromOptions(rawProgram, programOpts) || rawProgram,
      location:
        singleLandingLocation ||
        values.location ||
        sessionLocation?.slug ||
        resolveDefault("location", getFieldConfig("location").default),
      region:
        singleLandingRegion ||
        values.region ||
        sessionLocation?.region ||
        resolveDefault("region", getFieldConfig("region").default),
      coupon:
        values.coupon ||
        utm.coupon ||
        resolveDefault("coupon", getFieldConfig("coupon").default),
      referral_key:
        values.referral_key ||
        utm.referral_key ||
        utm.referral ||
        utm.ref ||
        resolveDefault("referral_key", getFieldConfig("referral_key").default),
      current_download:
        values.current_download ||
        resolveDefault("current_download", getFieldConfig("current_download").default),
      plan:
        values.plan ||
        resolveDefault("plan", getFieldConfig("plan").default) ||
        "",
    };

    // Any fields.* default not already filled (SectionRenderer resolveDeep already
    // expanded {{ entry.* }}; extras like event_id land here for lead body + GTM).
    for (const [key, cfg] of Object.entries(data.fields || {})) {
      if (!cfg || typeof cfg !== "object") continue;
      if (isNonEmptyLeadFormWireScalar(resolved[key])) continue;
      const rawDefault = cfg.default;
      if (!isNonEmptyLeadFormWireScalar(rawDefault)) continue;
      if (typeof rawDefault === "string") {
        const fromAuto = resolveDefault(key, rawDefault);
        resolved[key] = fromAuto || rawDefault;
      } else {
        resolved[key] = rawDefault;
      }
    }

    return resolved;
  };

  /** Ecommerce product for this submit: GA4 item_id and the lead ledger use the same result. */
  const resolveSubmitProduct = async (fields: Record<string, LeadFormFieldDefault>) => {
    await ensureEcommerceProductLookup();
    const productField =
      (typeof data.ecommerce_product_field === "string" && data.ecommerce_product_field.trim()) ||
      DEFAULT_ECOMMERCE_PRODUCT_FIELD;
    const fieldRaw = fields[productField];
    const fieldValue =
      typeof fieldRaw === "string"
        ? fieldRaw
        : typeof fields.program === "string"
          ? fields.program
          : "";
    const resolved = resolveConversionProduct({
      funnel: pageFunnel,
      contentType,
      contentSlug: slug,
      fieldValue,
      productLookup: getEcommerceProductLookup(),
    });
    if (!resolved.ok) {
      console.warn(
        `[LeadForm] ecommerce product not resolved for analytics (${resolved.reason}). CRM program unchanged.`,
        { productField, fieldValue },
      );
    }
    return resolved;
  };

  /**
   * Product / persona for this submit: the page funnel, unless the form overrides them with
   * hidden `product` / `persona` fields (full id or short code). GTM gets codes once the site's
   * tracking switch is on; the lead ledger / CRM always get full ids.
   */
  const resolveLeadTracking = async (fields: Record<string, LeadFormFieldDefault>) => {
    const { ready, keys } = await ensureTrackingKeys();
    const override = {
      product: typeof fields.product === "string" ? fields.product : undefined,
      persona: typeof fields.persona === "string" ? fields.persona : undefined,
    };
    const page = { contentType: contentType || "page", contentSlug: slug || "" };
    const pick = (ctx: PageTrackingContext) =>
      Object.fromEntries(
        (["product", "persona", "product_persona", "tracking_truncated"] as const)
          .filter((k) => ctx[k] !== undefined)
          .map((k) => [k, ctx[k]]),
      ) as Record<string, string | boolean>;
    return {
      codes: ready ? pick(resolveFormTrackingContext(pageFunnel, page, keys, override)) : null,
      ids: pick(resolveFormTrackingContext(pageFunnel, page, keys, override, { mode: "ids" })),
    };
  };

  /** Same dataLayer body for signup and every other form conversion. */
  const trackLeadConversion = async (
    eventName: ConversionName,
    formValues: FormValues,
    fields: Record<string, LeadFormFieldDefault>,
    submissionId: string,
  ) => {
    const resolvedProduct = await resolveSubmitProduct(fields);
    const leadTracking = await resolveLeadTracking(fields);
    const tracking: FormSubmissionTrackingData = {
      email: formValues.email,
      first_name: formValues.first_name,
      last_name: formValues.last_name,
      phone: formValues.phone,
      program: typeof fields.program === "string" ? fields.program : undefined,
      ...(resolvedProduct.ok
        ? { item_id: resolvedProduct.item_id, program_id: resolvedProduct.program_id }
        : {}),
      plan: typeof fields.plan === "string" ? fields.plan : undefined,
      location: typeof fields.location === "string" ? fields.location : undefined,
      region: typeof fields.region === "string" ? fields.region : undefined,
      coupon: typeof fields.coupon === "string" ? fields.coupon : undefined,
      referral_key: typeof fields.referral_key === "string" ? fields.referral_key : undefined,
      client_comments: formValues.client_comments,
      current_download:
        typeof fields.current_download === "string" ? fields.current_download : undefined,
      consent_email: formValues.consent_email,
      consent_sms: formValues.consent_sms,
      consent_whatsapp: formValues.consent_whatsapp,
      consent_general: formValues.consent_general,
      ...Object.fromEntries(
        extraConsentFields.map((field) => [
          `consent_${field}`,
          Boolean(formValues[`consent_${field}`]),
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(fields).filter(([, value]) => isNonEmptyLeadFormWireScalar(value)),
      ),
      ...(leadTracking.codes ?? {}),
      submission_id: submissionId,
    };
    await trackFormSubmission(eventName, tracking);
  };

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      // Map consent fields to backend field names
      const { consent_email, consent_sms, consent_whatsapp, ...restValues } = values;

      const fields = resolveEffectiveFieldValues(values);
      const effective = buildEffectiveSubmitConfig(
        data,
        fields,
        publicConversionEvents?.events,
        resolveConditionValue,
        singleEntry as Record<string, unknown> | undefined,
      );
      
      // When marketing consent is enabled, derive both email and whatsapp from consent_email checkbox
      const effectiveEmailConsent = consent_email || false;
      const effectiveWhatsappConsent = consent.marketing ? effectiveEmailConsent : (consent_whatsapp || false);
      const fieldScalars = Object.fromEntries(
        Object.entries(fields).filter(([, value]) =>
          isNonEmptyLeadFormWireScalar(value),
        ),
      );
      const submissionId = newSubmissionId();
      const submitProduct = await resolveSubmitProduct(fields);
      const leadTracking = await resolveLeadTracking(fields);
      const payload = {
        ...restValues,
        ...fieldScalars,
        // Consent fields mapped to backend names
        consent_email: effectiveEmailConsent,
        sms_consent: consent_sms || false,
        consent_whatsapp: effectiveWhatsappConsent,
        location: fields.location,
        region: fields.region,
        coupon: fields.coupon,
        referral_key: fields.referral_key,
        program: fields.program,
        current_download: fields.current_download,
        language: session.language,
        browser_lang: session.browserLang,
        latitude: session.geo?.latitude?.toString(),
        longitude: session.geo?.longitude?.toString(),
        city: session.geo?.city,
        country: session.geo?.country,
        utm_url: window.location.href,
        utm_source: utm.utm_source,
        utm_medium: utm.utm_medium,
        utm_campaign: utm.utm_campaign,
        utm_content: utm.utm_content,
        utm_term: utm.utm_term,
        utm_placement: utm.utm_placement,
        utm_plan: utm.utm_plan,
        ppc_tracking_id: utm.ppc_tracking_id,
        referral: utm.referral || utm.ref,
        ...(effective.tags ? { tags: effective.tags } : {}),
        automations: effective.automations,
        conversion_name: effective.conversion_name,
        token: turnstileToken,
        ...buildLeadAdContext(session, submissionId),
        ...(submitProduct.ok
          ? { ledger_product_id: submitProduct.item_id, ledger_product_slug: submitProduct.program_id }
          : {}),
        ...leadTracking.ids,
      };

      // Token written during this submit (signup) — cookie may lag React state; prefer this.
      let submitAuthToken: string | null = null;

      // Signup mode: guests are registered first via the site auth endpoint;
      // logged-in users skip this and go straight to the lead/conversion flow.
      if (signupActive && !isLoggedIn) {
        const fieldMap = authSettings?.signup?.field_map ?? [];
        const formCtx: Record<string, unknown> = {
          ...values,
          ...fields,
          consent_email: effectiveEmailConsent,
          consent_sms: consent_sms || false,
          consent_whatsapp: effectiveWhatsappConsent,
        };
        const sessionCtx: Record<string, unknown> = {
          language: session.language,
          browserLang: session.browserLang,
          landing_page: session.landing_page,
          conversion_page: session.conversion_page,
          userId: session.userId,
          geo: session.geo ?? {},
          location: sessionLocation ?? {},
          utm: {
            utm_source: utm.utm_source,
            utm_medium: utm.utm_medium,
            utm_campaign: utm.utm_campaign,
            utm_content: utm.utm_content,
            utm_term: utm.utm_term,
            utm_url: utm.utm_url,
            utm_placement: utm.utm_placement,
            utm_plan: utm.utm_plan,
            coupon: utm.coupon,
            referral_key: utm.referral_key,
            referral: utm.referral,
            ref: utm.ref,
          },
        };
        const conversion_info: Record<string, unknown> = {
          user_agent: navigator.userAgent,
          landing_url:
            session.landing_page || utm.utm_url || window.location.pathname,
          conversion_url: window.location.pathname,
          ...(utm.utm_placement ? { internal_cta_placement: utm.utm_placement } : {}),
        };
        const globals: Record<string, string> = {};
        for (const entry of fieldMap) {
          if (!isGlobalEntry(entry)) continue;
          if (!variableDefinitions) {
            globals[entry.global] = "";
            continue;
          }
          const resolved = resolveVariable(
            entry.global,
            variableDefinitions,
            variableContext,
          );
          globals[entry.global] = resolved?.value ?? "";
        }
        const signupPayload = buildSignupPayloadFromFieldMap(
          fieldMap,
          { form: formCtx, session: sessionCtx, globals },
          conversion_info,
        );
        const signupRes = await apiRequest("POST", "/api/auth/signup", signupPayload);
        try {
          const signupJson = (await signupRes.json()) as {
            data?: { access_token?: string; token?: string };
          };
          const newToken = signupJson?.data?.access_token || signupJson?.data?.token;
          if (newToken) {
            setConsumerToken(newToken);
            submitAuthToken = newToken;
          }
          await trackLeadConversion(
            authConversionCfg.signup_event_name,
            values,
            fields,
            submissionId,
          );
        } catch {
          // Signup succeeded but response was not JSON — continue as guest
          await trackLeadConversion(
            authConversionCfg.signup_event_name,
            values,
            fields,
            submissionId,
          );
        }
      }

      // Resolve templates with a fresh visitor bag (post-signup token), not the render-time closure.
      const resolveTemplatedUrl = (raw: string | undefined): string | undefined => {
        if (!raw) return undefined;
        const token = submitAuthToken || getConsumerToken();
        const visitor: Record<string, unknown> = {
          ...(visitorBag ?? {}),
          ...(token ? { token } : {}),
        };
        return resolveTemplateString(
          raw,
          variableDefinitions ?? {},
          variableContext,
          {
            singleEntry: (singleEntry as Record<string, unknown> | undefined) ?? undefined,
            visitor: Object.keys(visitor).length > 0 ? visitor : undefined,
          },
        ).text;
      };

      // Single submission path: POST /api/leads/webhook-delivery. The section (form YAML)
      // webhook is resolved here (form_overrides + {{ visitor.* }} / {{ entry.* }} templates)
      // and sent along; otherwise the server resolves event → global → DEFAULT_WEBHOOK_URL.
      const deliveryOverride = effective.formWebhook?.url ? effective.formWebhook : null;

      const body: Record<string, unknown> = { payload };
      if (deliveryOverride?.url) {
        const resolvedUrl = resolveTemplatedUrl(deliveryOverride.url) || deliveryOverride.url;
        const resolvedHeaders: Record<string, string> = {};
        if (deliveryOverride.headers) {
          for (const [hk, hv] of Object.entries(deliveryOverride.headers)) {
            if (typeof hv !== "string") continue;
            resolvedHeaders[hk] = resolveTemplatedUrl(hv) || hv;
          }
        }
        body.webhook = {
          url: resolvedUrl,
          method: deliveryOverride.method || "POST",
          ...(Object.keys(resolvedHeaders).length > 0 ? { headers: resolvedHeaders } : {}),
          ...(deliveryOverride.fail_silently === true ? { fail_silently: true } : {}),
        };
      }
      const response = await fetch("/api/leads/webhook-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...staffLeadHeaders() },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`${response.status}: ${errText || response.statusText}`);
      }

      return { response, fields, effective, resolveTemplatedUrl, submissionId };
    },
    onSuccess: async ({ fields, effective, resolveTemplatedUrl, submissionId }, variables) => {
      setSubmitError(null);
      setConversionPage(window.location.pathname);
      // Track conversion if conversion_name is defined (skip auth events — fired on signup/login)
      const skipFormConversion =
        !effective.conversion_name ||
        isAuthConversionName(effective.conversion_name, authConversionCfg);
      if (!effective.conversion_name && !isSignupRequested) {
        console.error(
          '[LeadForm] Missing conversion_name in form configuration. ' +
          'Add conversion_name to the form YAML (or a matching route) to enable tracking.'
        );
      }
      if (effective.conversion_name && !skipFormConversion) {
        await trackLeadConversion(effective.conversion_name, variables, fields, submissionId);

        // The secondary curated webhook is only fired when ALL three webhook levels
        // are unconfigured (i.e., primary submission went to Breathecode).
        // When any webhook level was used above, the full payload was already delivered.
        const hasAnyWebhook = !!effective.formWebhook?.url;
        if (!hasAnyWebhook) {
          try {
            const resolvedWebhook = resolveWebhook(
              effective.formWebhook?.url ? effective.formWebhook : null,
              effective.conversion_name,
              null, // full tracking settings are admin-only; not available in the form
            );
            if (resolvedWebhook) {
              const webhookPayload: Record<string, unknown> = {
                conversion_name: effective.conversion_name,
                program: fields.program,
                location: fields.location,
                utm_source: utm.utm_source,
                utm_medium: utm.utm_medium,
                utm_campaign: utm.utm_campaign,
                utm_content: utm.utm_content,
                utm_term: utm.utm_term,
              };
              if (variables.email) {
                webhookPayload.email_hash = await hashEmail(variables.email);
              }
              fetch("/api/conversion-webhook", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  url: resolvedWebhook.url,
                  method: resolvedWebhook.method || "POST",
                  payload: webhookPayload,
                }),
              }).catch((err) => console.warn("[LeadForm] Webhook delivery failed (non-blocking):", err));
            }
          } catch (err) {
            console.warn("[LeadForm] Webhook resolution failed (non-blocking):", err);
          }
        }
      }

      if (effective.success?.reload_entry_fields && contentType && slug) {
        const entryKey = [getApiPath(contentType), slug, locale] as const;
        // Non-blocking: refresh entry page data so overrides re-resolve (e.g. registered).
        void queryClient.invalidateQueries({ queryKey: [...entryKey] });
      }

      if (effective.success?.url) {
        const successUrl =
          resolveTemplatedUrl(effective.success.url) || effective.success.url;
        // Submit already awaited the lead request, so a new tab is outside the
        // tap and mobile browsers block it. Stay in this tab instead.
        nav.navigate(successUrl, { external: "same-tab" });
      } else {
        setIsSuccess(true);
        setSuccessMessage(effective.success?.message || (locale === "es" 
          ? "¡Gracias! Te contactaremos pronto." 
          : "Thanks! We'll contact you soon."));
      }
    },
    onError: (error: Error) => {
      console.error("Lead submission error:", error);
      setSubmitError(leadSubmitErrorMessage(error.message, locale));
    },
  });

  const onSubmit = (values: FormValues) => {
    // Read at submit time: the staff token and the session opt-out live in browser storage.
    if (needsStaffSubmitConfirm()) {
      setStaffConfirmValues(values);
      return;
    }
    submitLead(values);
  };

  const confirmStaffSubmit = (skipForSession: boolean) => {
    const values = staffConfirmValues;
    setStaffConfirmValues(null);
    if (skipForSession) skipStaffSubmitConfirmThisSession();
    if (values) submitLead(values);
  };

  const staffConfirmDialog = staffConfirmValues ? (
    <Suspense fallback={null}>
      <StaffLeadConfirmDialog
        locale={locale}
        onConfirm={confirmStaffSubmit}
        onCancel={() => setStaffConfirmValues(null)}
      />
    </Suspense>
  ) : null;

  const submitLead = (values: FormValues) => {
    setTurnstileError(null);
    setSubmitError(null);

    // Dev: surface the misconfiguration instead of silently skipping captcha.
    // Prod: degrade gracefully and submit without captcha.
    if (turnstileMisconfigured && import.meta.env.DEV) {
      setTurnstileError(
        locale === "es"
          ? "Turnstile no está configurado: define TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY (o desactiva turnstile en el YAML del formulario)."
          : "Turnstile is not configured: set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY (or disable turnstile in the form YAML).",
      );
      return;
    }

    // If turnstile is ready and we don't have a token yet, show the modal and wait
    if (turnstileReady && !turnstileToken) {
      setPendingFormData(values);
      setShowTurnstileModal(true);
      return;
    }
    
    submitMutation.mutate(values);
  };

  // Auto-submit when turnstile token is received and we have pending form data
  useEffect(() => {
    if (turnstileToken && pendingFormData) {
      setShowTurnstileModal(false);
      submitMutation.mutate(pendingFormData);
      setPendingFormData(null);
    }
  }, [turnstileToken, pendingFormData]);

  const filteredLocations = formOptions?.locations.filter(loc => {
    if (multipleLandingLocations) {
      if (!multipleLandingLocations.includes(loc.slug)) return false;
      const selectedRegion = form.watch("region");
      if (selectedRegion && getFieldConfig("region").visible) {
        return loc.region === selectedRegion;
      }
      return true;
    }
    const selectedRegion = form.watch("region");
    if (!selectedRegion || !getFieldConfig("region").visible) return true;
    return loc.region === selectedRegion;
  }) || [];

  const programChoiceOptions = mergeLeadFormOptions(
    visiblePrograms.map((p) => ({
      value: p.bc_slug || p.slug,
      label: p.title,
    })),
    getFieldConfig("program").options,
  );

  const planChoiceOptions = mergeLeadFormOptions(
    visiblePlans.map((p) => ({ value: p.value, label: p.label })),
    getFieldConfig("plan").options,
  );

  // Only offer regions that have at least one listed campus (e.g. Florida site
  // → usa-canada only from Miami/Orlando/Tampa). Landing-location constraints
  // can narrow further.
  const regionsWithListedLocations = new Set(
    (formOptions?.locations ?? []).map((loc) => loc.region).filter(Boolean),
  );

  const regionPool = (
    singleLandingRegion
      ? formOptions?.regions.filter((r) => r.slug === singleLandingRegion)
      : multipleLandingRegions
        ? formOptions?.regions.filter((r) => multipleLandingRegions.includes(r.slug))
        : formOptions?.regions?.filter((r) => regionsWithListedLocations.has(r.slug))
  ) ?? [];

  const regionChoiceOptions = mergeLeadFormOptions(
    regionPool.map((r) => ({ value: r.slug, label: r.label })),
    getFieldConfig("region").options,
  );

  const locationChoiceOptions = mergeLeadFormOptions(
    filteredLocations.map((loc) => {
      const region = formOptions?.regions.find((r) => r.slug === loc.region);
      const countryLabel =
        loc.country && loc.country !== "Unknown" ? loc.country : region?.label || "";
      return {
        value: loc.slug,
        label: countryLabel ? `${loc.name} - ${countryLabel}` : loc.name,
        group: region?.label,
      };
    }),
    getFieldConfig("location").options,
  );

  // Drop campus (and region) values that are not in the current choice lists so
  // Select shows the placeholder instead of a blank trigger.
  useEffect(() => {
    if (!formOptions?.locations) return;
    const locationValue = form.getValues("location");
    if (locationValue && !locationChoiceOptions.some((o) => o.value === locationValue)) {
      form.setValue("location", "");
    }
    const regionValue = form.getValues("region");
    if (
      regionValue &&
      getFieldConfig("region").visible &&
      !regionChoiceOptions.some((o) => o.value === regionValue)
    ) {
      form.setValue("region", "");
    }
  }, [formOptions?.locations, locationChoiceOptions, regionChoiceOptions, form]);

  // Watch form values to determine if required visible fields are filled
  const watchedValues = form.watch();

  const visitorBag = useMemo((): Record<string, unknown> | undefined => {
    const token =
      consumerAuthToken ??
      (typeof window !== "undefined" ? getConsumerToken() : null);
    if (isLoggedIn && authProfile) {
      const { valid: _valid, ...rest } = authProfile;
      return {
        ...(rest as Record<string, unknown>),
        ...(token ? { token } : {}),
      };
    }
    if (token) return { token };
    return undefined;
  }, [isLoggedIn, authProfile, consumerAuthToken]);

  const resolveTemplateValue = useMemo(() => {
    const defs = variableDefinitions ?? {};
    const entry = (singleEntry as Record<string, unknown> | undefined) ?? undefined;
    return (raw: string) =>
      resolveTemplateString(raw, defs, variableContext, {
        singleEntry: entry,
        visitor: visitorBag,
      }).text;
  }, [variableDefinitions, variableContext, singleEntry, visitorBag]);

  /** Condition values: resolveDeep so exact {{ entry.* }} / {{ visitor.* }} keep arrays/numbers. */
  const resolveConditionValue = useMemo(() => {
    const defs = variableDefinitions ?? {};
    const entry = (singleEntry as Record<string, unknown> | undefined) ?? undefined;
    return (raw: string): unknown =>
      resolveDeep(raw, defs, variableContext, {
        singleEntry: entry,
        visitor: visitorBag,
      }).data;
  }, [variableDefinitions, variableContext, singleEntry, visitorBag]);

  const effectiveData = useMemo(() => {
    const override = resolveLeadFormOverride(
      watchedValues as Record<string, unknown>,
      data.form_overrides,
      {
        resolveValue: resolveConditionValue,
        entry: (singleEntry as Record<string, unknown> | undefined) ?? undefined,
      },
    );
    return applyLeadFormOverrideOutcome(
      data as Record<string, unknown>,
      override,
    ) as LeadFormData;
  }, [watchedValues, data, resolveConditionValue, singleEntry]);

  const isFieldValueFilled = (field: keyof FormValues): boolean => {
    const value = watchedValues[field];
    if (typeof value === "string") {
      if (field === "email") {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      }
      return value.trim() !== "";
    }
    return !!value;
  };

  const collectVisibleFields = (onlyRequired: boolean): (keyof FormValues)[] => {
    const names: (keyof FormValues)[] = [
      "email",
      "first_name",
      "last_name",
      "phone",
      "program",
      "plan",
      "region",
      "location",
      "coupon",
      "referral_key",
      "client_comments",
      "current_download",
    ];
    return names.filter((name) => {
      const cfg = getFieldConfig(name as keyof NonNullable<LeadFormData["fields"]>);
      if (!cfg.visible) return false;
      return onlyRequired ? !!cfg.required : true;
    });
  };

  const allRequiredFieldsFilled = collectVisibleFields(true).every(isFieldValueFilled);

  const formPhase = resolveLeadFormPhase({
    isSignup: isSignupRequested,
    loginMode,
    isLoggedIn,
    allRequiredFieldsFilled,
  });
  const formCopy = resolveLeadFormCopy(formPhase, effectiveData, locale);

  const showField = (name: keyof NonNullable<LeadFormData["fields"]>) => {
    const hideOptionals =
      isSignupRequested && isLoggedIn && !loginMode && allRequiredFieldsFilled;
    const cfg = getFieldConfig(name);
    return !!cfg.visible && !(hideOptionals && !cfg.required);
  };

  // Avoid an empty space-y wrapper pushing the submit button away from the message.
  const hasVisibleStackedFields =
    showField("first_name") ||
    showField("last_name") ||
    showField("phone") ||
    showField("email") ||
    showField("region") ||
    showField("location") ||
    showField("program") ||
    showField("plan") ||
    showField("coupon") ||
    showField("referral_key") ||
    showField("current_download");

  // Legal notice + marketing consent: show for guests (lead submit or signup).
  // Non-signup forms also resolve to guest_signup phase; hide once logged in.
  const showLegalAndConsent = formPhase === "guest_signup";

  // After in-place login: if profile filled every required field, finish submission
  // (redirect / success message). Otherwise stay on the form for remaining fields.
  useEffect(() => {
    if (!pendingAutoSubmit || !isLoggedIn || authProfileLoading) return;
    // Ensure identity prefill has been applied to form state
    if (identityPrefill.email) form.setValue("email", identityPrefill.email);
    if (identityPrefill.first_name) form.setValue("first_name", identityPrefill.first_name);
    if (identityPrefill.last_name) form.setValue("last_name", identityPrefill.last_name);
    if (identityPrefill.phone) form.setValue("phone", identityPrefill.phone);

    const values = form.getValues();
    const requiredKeys: (keyof FormValues)[] = [];
    const check = (name: keyof FormValues) => {
      const cfg = getFieldConfig(name as keyof NonNullable<LeadFormData["fields"]>);
      if (cfg.visible && cfg.required) requiredKeys.push(name);
    };
    check("email");
    check("first_name");
    check("last_name");
    check("phone");
    check("program");
    check("plan");
    check("region");
    check("location");
    check("coupon");
    check("referral_key");
    check("client_comments");
    check("current_download");

    const ready = requiredKeys.every((field) => {
      const value = values[field];
      if (typeof value === "string") {
        if (field === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        return value.trim() !== "";
      }
      return !!value;
    });

    setPendingAutoSubmit(false);
    if (ready) {
      onSubmit(values);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingAutoSubmit,
    isLoggedIn,
    authProfileLoading,
    identityPrefill.email,
    identityPrefill.first_name,
    identityPrefill.last_name,
    identityPrefill.phone,
  ]);

  const isInline = variant === "inline";

  if (isSuccess) {
    // Inline variant: compact horizontal success message
    if (isInline) {
      return (
        <div className="flex items-center gap-2 mb-4" data-testid="lead-form-success">
          <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
            <Check className="w-4 h-4 text-green-500" />
          </div>
          <p className="text-foreground text-sm" data-testid="text-success-message">
            {successMessage}
          </p>
        </div>
      );
    }

    // Stacked variant: centered success message
    return (
      <div className="text-center" data-testid="lead-form-success">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-500/20 flex items-center justify-center">
          <Check className="w-6 h-6 text-green-500" />
        </div>
        <p className="text-foreground" data-testid="text-success-message">
          {successMessage}
        </p>
      </div>
    );
  }

  if (loginMode) {
    return (
      <div className={data.className} data-testid="lead-form-login">
        {formCopy.title ? (
          <p
            className="font-inter text-[21px] font-bold tracking-tight text-foreground text-center mb-1"
            data-testid="text-login-title"
          >
            {formCopy.title}
          </p>
        ) : null}
        {(!allowSignup || formCopy.subtitle) && (
          <p
            className={`${leadFormSubtitleClassName(formCopy.subtitle_style)} mb-3`}
            data-testid="text-login-subtitle"
          >
            {!allowSignup
              ? locale === "es"
                ? "Inicia sesión con tu cuenta existente. Los visitantes nuevos no pueden registrarse en este formulario."
                : "Sign in with your existing account. New visitors cannot create an account on this form."
              : formCopy.subtitle}
          </p>
        )}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setLoginError(null);
            loginMutation.mutate();
          }}
          data-testid="form-inplace-login"
        >
          <Input
            id="inplace-login-email"
            type="email"
            autoComplete="email"
            aria-label={locale === "es" ? "Correo" : "Email"}
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            placeholder={locale === "es" ? "Correo" : "Email"}
            required
            data-testid="input-login-email"
          />
          <Input
            id="inplace-login-password"
            type="password"
            autoComplete="current-password"
            aria-label={locale === "es" ? "Contraseña" : "Password"}
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            placeholder={locale === "es" ? "Contraseña" : "Password"}
            required
            data-testid="input-login-password"
          />
          {loginError && (
            <p className="text-sm text-destructive" data-testid="text-login-error">
              {loginError}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={loginMutation.isPending || !loginEmail.trim() || !loginPassword}
            data-testid="button-login-submit"
          >
            {loginMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              formCopy.submit_label
            )}
          </Button>
          {allowSignup && (
            <p className="text-sm text-center text-muted-foreground">
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => {
                  setLoginMode(false);
                  setLoginError(null);
                  setLoginPassword("");
                }}
                data-testid="button-back-to-signup"
              >
                {formCopy.back_label}
              </button>
            </p>
          )}
        </form>
      </div>
    );
  }

  const emailConfig = getFieldConfig("email");

  const hasVisibleFieldsBeyondEmailAndFirstName =
    showField("last_name") ||
    showField("phone") ||
    showField("program") ||
    showField("plan") ||
    showField("region") ||
    showField("location") ||
    showField("coupon") ||
    showField("referral_key") ||
    showField("client_comments") ||
    showField("current_download");

  const firstNameConfig = getFieldConfig("first_name");

  if (isInline && !hasVisibleFieldsBeyondEmailAndFirstName) {
    return (
      <div className={data.className} data-testid="lead-form">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="flex gap-2 items-start flex-wrap">
              {showField("first_name") && (
                <FormField
                  control={form.control}
                  name="first_name"
                  rules={{ required: firstNameConfig.required ? (locale === "es" ? "Nombre requerido" : "First name is required") : false }}
                  render={({ field }) => (
                    <FormItem className="flex-1 min-w-[140px]">
                      <FormControl>
                        <Input 
                          placeholder={firstNameConfig.placeholder || (locale === "es" ? "Tu nombre" : "Your name")} 
                          {...field} 
                          data-testid="input-first-name"
                        />
                      </FormControl>
                      <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                    </FormItem>
                  )}
                />
              )}
              {showField("email") && (
              <FormField
                control={form.control}
                name="email"
                rules={{ 
                  required: emailConfig.required ? (locale === "es" ? "Correo requerido" : "Email is required") : false,
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: locale === "es" ? "Correo inválido" : "Invalid email address"
                  }
                }}
                render={({ field }) => (
                  <FormItem className="flex-1 min-w-[180px]">
                    <FormControl>
                      <Input 
                        type="email" 
                        placeholder={emailConfig.placeholder || (locale === "es" ? "tu@email.com" : "you@email.com")} 
                        {...field} 
                        data-testid="input-email"
                      />
                    </FormControl>
                    <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                  </FormItem>
                )}
              />
              )}
              <Button 
                type="submit" 
                variant={formCopy.submit_disabled === true ? "secondary" : "default"}
                disabled={submitMutation.isPending || formCopy.submit_disabled === true}
                data-testid="button-submit"
              >
                {submitMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  formCopy.submit_label
                )}
              </Button>
            </div>
            {turnstileReady && showTurnstileModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                <div className="bg-card p-card-padding rounded-card shadow-card">
                  <Turnstile
                    siteKey={turnstileSiteKey.siteKey}
                    onSuccess={(token: string) => setTurnstileToken(token)}
                    onError={() => {
                      setTurnstileError(locale === "es" ? "Error de verificación" : "Verification error");
                      setShowTurnstileModal(false);
                      setPendingFormData(null);
                    }}
                    onExpire={() => setTurnstileToken(null)}
                    options={{
                      theme: data.turnstile?.theme || "auto",
                      size: data.turnstile?.size || "compact",
                    }}
                  />
                </div>
              </div>
            )}
            {turnstileError && (
              <p className="text-sm text-destructive mt-2" data-testid="text-turnstile-error">
                {turnstileError}
              </p>
            )}
            {submitError && (
              <p className="text-sm text-destructive mt-2" data-testid="text-submit-error">
                {submitError}
              </p>
            )}
            {emailConfig.helper_text && (
              <p className="text-sm text-muted-foreground mt-2" data-testid="text-email-helper">
                {emailConfig.helper_text}
              </p>
            )}
            {showLegalAndConsent && allRequiredFieldsFilled && (
              <div className="mt-3">
                <ConsentSection
                  consent={consent}
                  form={form}
                  locale={locale}
                  formOptions={formOptions}
                  sessionLocation={sessionLocation}
                  geo={session.geo}
                  consentSettings={consentSettings}
                  fallbackKey={consentFallbackKey}
                />
              </div>
            )}
          </form>
        </Form>
        {signupLoginPrompt}
        {switchAccountPrompt}
        {staffConfirmDialog}
      </div>
    );
  }

  return (
    <div className={data.className} data-testid="lead-form">
      {formCopy.title ? (
        <p
          className="font-inter text-[21px] font-bold tracking-tight text-foreground text-center mb-1"
          data-testid="text-form-title"
        >
          {formCopy.title}
        </p>
      ) : null}
      {formCopy.subtitle && (
        <p
          className={`${leadFormSubtitleClassName(formCopy.subtitle_style)} mb-2.5`}
          data-testid="text-form-subtitle"
        >
          {formCopy.subtitle}
        </p>
      )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {hasVisibleStackedFields ? (
          <div className="space-y-4">
            {/* First + Last name on same row - NEW ORDER: Name -> Phone -> Email */}
            {(showField("first_name") || showField("last_name")) && (
              <div className={`grid gap-3 ${showField("first_name") && showField("last_name") ? "grid-cols-2" : "grid-cols-1"}`}>
                {showField("first_name") && (
                  <FormField
                    control={form.control}
                    name="first_name"
                    rules={{ required: getFieldConfig("first_name").required ? (locale === "es" ? "Nombre requerido" : "First name is required") : false }}
                    render={({ field }) => (
                      <FormItem className="space-y-2 mt-[2px] mb-[2px]">
                        {getFieldConfig("first_name").show_label && (
                          <FormLabel>{getFieldConfig("first_name").label || (locale === "es" ? "Nombre" : "First name")}</FormLabel>
                        )}
                        <FormControl>
                          <LeadFormFieldControl
                            renderer={resolveFieldRenderer("first_name")}
                            field={field}
                            options={mergeLeadFormOptions([], getFieldConfig("first_name").options)}
                            placeholder={getFieldConfig("first_name").placeholder || (locale === "es" ? "Nombre" : "First name")}
                            testId="input-first-name"
                            dialogTitle={getFieldConfig("first_name").label || (locale === "es" ? "Nombre" : "First name")}
                          />
                        </FormControl>
                        <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                      </FormItem>
                    )}
                  />
                )}
                {showField("last_name") && (
                  <FormField
                    control={form.control}
                    name="last_name"
                    rules={{ required: getFieldConfig("last_name").required ? (locale === "es" ? "Apellido requerido" : "Last name is required") : false }}
                    render={({ field }) => (
                      <FormItem className="space-y-2 mt-[2px] mb-[2px]">
                        {getFieldConfig("last_name").show_label && (
                          <FormLabel>{getFieldConfig("last_name").label || (locale === "es" ? "Apellido" : "Last name")}</FormLabel>
                        )}
                        <FormControl>
                          <LeadFormFieldControl
                            renderer={resolveFieldRenderer("last_name")}
                            field={field}
                            options={mergeLeadFormOptions([], getFieldConfig("last_name").options)}
                            placeholder={getFieldConfig("last_name").placeholder || (locale === "es" ? "Apellido" : "Last name")}
                            testId="input-last-name"
                            dialogTitle={getFieldConfig("last_name").label || (locale === "es" ? "Apellido" : "Last name")}
                          />
                        </FormControl>
                        <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            )}

            {/* Phone with country code */}
            {showField("phone") && (
              <FormField
                control={form.control}
                name="phone"
                rules={{ required: getFieldConfig("phone").required ? (locale === "es" ? "Teléfono requerido" : "Phone is required") : false }}
                render={({ field }) => (
                  <FormItem className="space-y-2 mt-[2px] mb-[2px]">
                    {getFieldConfig("phone").show_label && (
                      <FormLabel>{getFieldConfig("phone").label || (locale === "es" ? "Teléfono" : "Phone")}</FormLabel>
                    )}
                    <FormControl>
                      <LeadFormFieldControl
                        renderer={resolveFieldRenderer("phone")}
                        field={field}
                        options={mergeLeadFormOptions([], getFieldConfig("phone").options)}
                        phoneDefaultCountry={
                          (getFieldConfig("phone").default_country ||
                            session?.geo?.country_code ||
                            "US") as Country
                        }
                        placeholder={getFieldConfig("phone").placeholder || (locale === "es" ? "Teléfono" : "Phone number")}
                        testId="input-phone"
                        dialogTitle={getFieldConfig("phone").label || (locale === "es" ? "Teléfono" : "Phone")}
                      />
                    </FormControl>
                    {getFieldConfig("phone").helper_text && (
                      <p className="text-sm text-muted-foreground">{getFieldConfig("phone").helper_text}</p>
                    )}
                    <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                  </FormItem>
                )}
              />
            )}

            {/* Email */}
            {showField("email") && (
              <FormField
                control={form.control}
                name="email"
                rules={{ 
                  required: getFieldConfig("email").required ? (locale === "es" ? "Correo requerido" : "Email is required") : false,
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: locale === "es" ? "Correo inválido" : "Invalid email address"
                  }
                }}
                render={({ field }) => (
                  <FormItem className="space-y-2 mt-[2px] mb-[2px]">
                    {getFieldConfig("email").show_label && (
                      <FormLabel>{getFieldConfig("email").label || (locale === "es" ? "Correo electrónico" : "Email")}</FormLabel>
                    )}
                    <FormControl>
                      <LeadFormFieldControl
                        renderer={resolveFieldRenderer("email")}
                        field={field}
                        options={mergeLeadFormOptions([], getFieldConfig("email").options)}
                        inputType="email"
                        placeholder={getFieldConfig("email").placeholder || (locale === "es" ? "Escribe tu correo, ej: usuario@dominio.com" : "Type your email, ex: username@domain.com")}
                        testId="input-email"
                        dialogTitle={getFieldConfig("email").label || (locale === "es" ? "Correo electrónico" : "Email")}
                      />
                    </FormControl>
                    <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                  </FormItem>
                )}
              />
            )}

            {(showField("region") || showField("location")) && (
              <div className="grid grid-cols-2 gap-3">
                {showField("region") && (
                  <FormField
                    control={form.control}
                    name="region"
                    rules={{ required: getFieldConfig("region").required ? (locale === "es" ? "Región requerida" : "Region is required") : false }}
                    render={({ field }) => (
                      <FormItem>
                        {getFieldConfig("region").show_label && (
                          <FormLabel>{getFieldConfig("region").label || (locale === "es" ? "Región" : "Region")}</FormLabel>
                        )}
                        <FormControl>
                          <LeadFormFieldControl
                            renderer={resolveFieldRenderer("region")}
                            field={field}
                            options={regionChoiceOptions}
                            disabled={!!singleLandingRegion}
                            placeholder={locale === "es" ? "Selecciona una región" : "Select a region"}
                            testId="select-region"
                            dialogTitle={getFieldConfig("region").label || (locale === "es" ? "Región" : "Region")}
                          />
                        </FormControl>
                        {getFieldConfig("region").helper_text && (
                          <p className="text-sm text-muted-foreground">{getFieldConfig("region").helper_text}</p>
                        )}
                        <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                      </FormItem>
                    )}
                  />
                )}

                {showField("location") && (
                  <FormField
                    control={form.control}
                    name="location"
                    rules={{ required: getFieldConfig("location").required ? (locale === "es" ? "Campus requerido" : "Campus is required") : false }}
                    render={({ field }) => (
                      <FormItem>
                        {getFieldConfig("location").show_label && (
                          <FormLabel>{getFieldConfig("location").label || (locale === "es" ? "Campus" : "Campus")}</FormLabel>
                        )}
                        <FormControl>
                          <LeadFormFieldControl
                            renderer={resolveFieldRenderer("location")}
                            field={field}
                            options={locationChoiceOptions}
                            groupSelectByGroup
                            placeholder={locale === "es" ? "Selecciona un campus" : "Select a campus"}
                            testId="select-location"
                            dialogTitle={getFieldConfig("location").label || (locale === "es" ? "Campus" : "Campus")}
                          />
                        </FormControl>
                        {getFieldConfig("location").helper_text && (
                          <p className="text-sm text-muted-foreground">{getFieldConfig("location").helper_text}</p>
                        )}
                        <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            )}

            {showField("program") && (
              <FormField
                control={form.control}
                name="program"
                rules={{ required: getFieldConfig("program").required ? (locale === "es" ? "Programa requerido" : "Program is required") : false }}
                render={({ field }) => (
                  <FormItem>
                    {getFieldConfig("program").show_label && (
                      <FormLabel>{getFieldConfig("program").label || (locale === "es" ? "Programa" : "Program")}</FormLabel>
                    )}
                    <FormControl>
                      <LeadFormFieldControl
                        renderer={resolveFieldRenderer("program")}
                        field={field}
                        options={programChoiceOptions}
                        placeholder={locale === "es" ? "Selecciona un programa" : "Select a program"}
                        testId="select-program"
                        dialogTitle={getFieldConfig("program").label || (locale === "es" ? "Programas" : "Programs")}
                        dialogDescription={getFieldConfig("program").helper_text}
                        layout={resolveFieldCardsLayout("program")}
                      />
                    </FormControl>
                    {getFieldConfig("program").helper_text &&
                      !["cards", "simple-list", "grouped-list"].includes(
                        resolveFieldRenderer("program"),
                      ) && (
                      <p className="text-sm text-muted-foreground">{getFieldConfig("program").helper_text}</p>
                    )}
                    <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                  </FormItem>
                )}
              />
            )}

            {showField("plan") && (
              <FormField
                control={form.control}
                name="plan"
                rules={{
                  required: getFieldConfig("plan").required
                    ? locale === "es"
                      ? "Plan requerido"
                      : "Plan is required"
                    : false,
                }}
                render={({ field }) => (
                  <FormItem>
                    {getFieldConfig("plan").show_label && (
                      <FormLabel>
                        {getFieldConfig("plan").label || (locale === "es" ? "Plan" : "Plan")}
                      </FormLabel>
                    )}
                    <FormControl>
                      <LeadFormFieldControl
                        renderer={resolveFieldRenderer("plan")}
                        field={field}
                        options={planChoiceOptions}
                        placeholder={
                          getFieldConfig("plan").placeholder ||
                          (locale === "es" ? "Selecciona un plan" : "Select a plan")
                        }
                        testId={planChoiceOptions.length > 0 ? "select-plan" : "input-plan"}
                        dialogTitle={getFieldConfig("plan").label || (locale === "es" ? "Plan" : "Plan")}
                        layout={resolveFieldCardsLayout("plan")}
                        selectEmptyFallback={
                          <Input
                            placeholder={
                              getFieldConfig("plan").placeholder ||
                              (locale === "es" ? "Plan" : "Plan")
                            }
                            {...field}
                            data-testid="input-plan"
                          />
                        }
                      />
                    </FormControl>
                    {getFieldConfig("plan").helper_text && (
                      <p className="text-sm text-muted-foreground">
                        {getFieldConfig("plan").helper_text}
                      </p>
                    )}
                    <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                  </FormItem>
                )}
              />
            )}

            {showField("coupon") && (
              <FormField
                control={form.control}
                name="coupon"
                render={({ field }) => (
                  <FormItem>
                    {getFieldConfig("coupon").show_label && (
                      <FormLabel>{getFieldConfig("coupon").label || (locale === "es" ? "Código de cupón" : "Coupon Code")}</FormLabel>
                    )}
                    <FormControl>
                      <LeadFormFieldControl
                        renderer={resolveFieldRenderer("coupon")}
                        field={field}
                        options={mergeLeadFormOptions([], getFieldConfig("coupon").options)}
                        placeholder={getFieldConfig("coupon").placeholder || (locale === "es" ? "Código de cupón" : "Coupon Code")}
                        testId="input-coupon"
                        dialogTitle={getFieldConfig("coupon").label || (locale === "es" ? "Código de cupón" : "Coupon Code")}
                      />
                    </FormControl>
                    {getFieldConfig("coupon").helper_text && (
                      <p className="text-sm text-muted-foreground">{getFieldConfig("coupon").helper_text}</p>
                    )}
                    <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                  </FormItem>
                )}
              />
            )}

            {showField("referral_key") && (
              <FormField
                control={form.control}
                name="referral_key"
                rules={{
                  required: getFieldConfig("referral_key").required
                    ? (locale === "es" ? "Referral requerido" : "Referral is required")
                    : false,
                }}
                render={({ field }) => (
                  <FormItem>
                    {getFieldConfig("referral_key").show_label && (
                      <FormLabel>{getFieldConfig("referral_key").label || (locale === "es" ? "Referral" : "Referral")}</FormLabel>
                    )}
                    <FormControl>
                      <LeadFormFieldControl
                        renderer={resolveFieldRenderer("referral_key")}
                        field={field}
                        options={mergeLeadFormOptions([], getFieldConfig("referral_key").options)}
                        placeholder={getFieldConfig("referral_key").placeholder || (locale === "es" ? "Código de referral" : "Referral code")}
                        testId="input-referral-key"
                        dialogTitle={getFieldConfig("referral_key").label || "Referral"}
                      />
                    </FormControl>
                    {getFieldConfig("referral_key").helper_text && (
                      <p className="text-sm text-muted-foreground">{getFieldConfig("referral_key").helper_text}</p>
                    )}
                    <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                  </FormItem>
                )}
              />
            )}

            {showField("current_download") && (
              <FormField
                control={form.control}
                name="current_download"
                rules={{
                  required: getFieldConfig("current_download").required
                    ? (locale === "es" ? "Descargable requerido" : "Download is required")
                    : false,
                }}
                render={({ field }) => (
                  <FormItem>
                    {getFieldConfig("current_download").show_label && (
                      <FormLabel>
                        {getFieldConfig("current_download").label ||
                          (locale === "es" ? "Descargable" : "Download")}
                      </FormLabel>
                    )}
                    <FormControl>
                      <LeadFormFieldControl
                        renderer={resolveFieldRenderer("current_download")}
                        field={field}
                        options={mergeLeadFormOptions([], getFieldConfig("current_download").options)}
                        placeholder={
                          getFieldConfig("current_download").placeholder ||
                          (locale === "es" ? "Descargable" : "Download")
                        }
                        testId="input-current-download"
                        dialogTitle={
                          getFieldConfig("current_download").label ||
                          (locale === "es" ? "Descargable" : "Download")
                        }
                      />
                    </FormControl>
                    {getFieldConfig("current_download").helper_text && (
                      <p className="text-sm text-muted-foreground">
                        {getFieldConfig("current_download").helper_text}
                      </p>
                    )}
                    <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                  </FormItem>
                )}
              />
            )}
          </div>
          ) : null}

          {showField("client_comments") && (
            <FormField
              control={form.control}
              name="client_comments"
              render={({ field }) => (
                <FormItem>
                  {getFieldConfig("client_comments").show_label && (
                    <FormLabel>{getFieldConfig("client_comments").label || (locale === "es" ? "Comentarios" : "Comments")}</FormLabel>
                  )}
                  <FormControl>
                    <LeadFormFieldControl
                      renderer={resolveFieldRenderer("client_comments")}
                      field={field}
                      options={mergeLeadFormOptions([], getFieldConfig("client_comments").options)}
                      placeholder={getFieldConfig("client_comments").placeholder || (locale === "es" ? "Comentarios" : "Comments")}
                      rows={getFieldConfig("client_comments").rows}
                      testId="textarea-client-comments"
                      dialogTitle={getFieldConfig("client_comments").label || (locale === "es" ? "Comentarios" : "Comments")}
                    />
                  </FormControl>
                  {getFieldConfig("client_comments").helper_text && (
                    <p className="text-sm text-muted-foreground">{getFieldConfig("client_comments").helper_text}</p>
                  )}
                  <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                </FormItem>
              )}
            />
          )}

          {showLegalAndConsent && allRequiredFieldsFilled && (
            <ConsentSection 
              consent={consent}
              form={form}
              locale={locale}
              formOptions={formOptions}
              sessionLocation={sessionLocation}
              geo={session.geo}
              consentSettings={consentSettings}
              fallbackKey={consentFallbackKey}
            />
          )}

          {turnstileReady && showTurnstileModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
              <div className="bg-card p-6 rounded-card shadow-card">
                <Turnstile
                  siteKey={turnstileSiteKey.siteKey}
                  onSuccess={(token: string) => setTurnstileToken(token)}
                  onError={() => {
                    setTurnstileError(locale === "es" ? "Error de verificación" : "Verification error");
                    setShowTurnstileModal(false);
                    setPendingFormData(null);
                  }}
                  onExpire={() => setTurnstileToken(null)}
                  options={{
                    theme: data.turnstile?.theme || "auto",
                    size: data.turnstile?.size || "normal",
                  }}
                />
              </div>
            </div>
          )}

          {turnstileError && (
            <p className="text-sm text-destructive text-center" data-testid="text-turnstile-error">
              {turnstileError}
            </p>
          )}
          {submitError && (
            <p className="text-sm text-destructive text-center" data-testid="text-submit-error">
              {submitError}
            </p>
          )}

          <Button 
            type="submit" 
            variant={formCopy.submit_disabled === true ? "secondary" : "default"}
            className={`w-full ${data.button_className || ""}`}
            disabled={submitMutation.isPending || formCopy.submit_disabled === true}
            data-testid="button-submit"
          >
            {submitMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              formCopy.submit_label
            )}
          </Button>

          {isSignupRequested && showTerms && showLegalAndConsent && (
            <p className={`text-xs text-center ${data.terms_className || "text-muted-foreground"}`} style={termsStyle} data-testid="text-terms">
              {locale === "es" ? "Al registrarte, aceptas los " : "By signing up, you agree to the "}
              <a 
                href={effectiveTermsUrl || legalSettings?.legal_terms_url || (locale === "es" ? "/es/terminos-y-condiciones" : "/en/terms-conditions")} 
                className="underline hover:text-foreground"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-terms"
              >
                {locale === "es" ? "Términos y Condiciones" : "Terms and Conditions"}
              </a>
              {locale === "es" ? " y la " : " and "}
              <a 
                href={effectivePrivacyUrl || legalSettings?.legal_privacy_url || (locale === "es" ? "/es/politicas-de-privacidad" : "/en/privacy-policy")} 
                className="underline hover:text-foreground"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-privacy"
              >
                {locale === "es" ? "Política de Privacidad" : "Privacy Policy"}
              </a>
            </p>
          )}
        </form>
      </Form>
      {signupLoginPrompt}
      {switchAccountPrompt}
      {staffConfirmDialog}
    </div>
  );
}
