
import { useState, useEffect, useMemo } from "react";
import { Check, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Turnstile } from "@marsidev/react-turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import { apiRequest, apiFetch } from "@/lib/queryClient";
import type { Country } from "react-phone-number-input";
import { trackFormSubmission, resolveWebhook, hashEmail, getEcommerceProductLookup, type ConversionName, type TrackingSettingsResponse } from "@/lib/tracking";
import { ensureEcommerceProductLookup } from "@/lib/ecommerceProductMap";
import { usePageFunnel } from "@/contexts/PageFunnelContext";
import {
  DEFAULT_ECOMMERCE_PRODUCT_FIELD,
  resolveConversionProduct,
} from "@shared/resolveConversionProduct";
import { resolveFormDefaults } from "@shared/resolveFormDefaults";
import { resolveConsentCopy, extraConsentYamlFieldsFromObject, consentKeyFromYamlField, isBlankConsentHtml, parseConsentSettingsResponse, shouldShowFallbackConsent } from "@shared/consent-settings";
import { RichTextContent } from "@/components/ui/rich-text-content";
import {
  applyLeadFormRouteOutcome,
  normalizeLeadFormTags,
  resolveLeadFormRoute,
  type LeadFormRoute,
} from "@shared/resolveLeadFormRoute";
import { useAuthUser, getConsumerToken } from "@/hooks/useAuthUser";
import { resolveFormFields, type IdentityField } from "@/lib/resolveFormFields";
import {
  resolveLeadFormPhase,
  resolveLeadFormCopy,
} from "@/lib/resolveLeadFormCopy";
import {
  LeadFormFieldControl,
  type LeadFormComponentRenderer,
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
      description: ov.description ?? p.description,
      group: ov.group ?? p.group,
      cta: ov.cta,
      icon: ov.icon,
    };
  });

  const poolValues = new Set(pool.map((p) => p.value));
  for (const ov of overrides) {
    if (poolValues.has(ov.value)) continue;
    merged.push({
      value: ov.value,
      label: typeof ov.label === "string" && ov.label.trim() ? ov.label : ov.value,
      description: ov.description,
      group: ov.group,
      cta: ov.cta,
      icon: ov.icon,
    });
  }

  return merged;
}

/** For is_signup success redirects: pass auth token to external destinations only. */
function resolveSignupSuccessUrl(url: string): string {
  const token = getConsumerToken();
  if (!token) return url;
  try {
    const target = new URL(url, window.location.origin);
    if (target.origin === window.location.origin) return url;
    target.searchParams.set("token", token);
    return target.href;
  } catch {
    return url;
  }
}

interface FieldConfig {
  visible?: boolean;
  required?: boolean;
  default?: string;
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
  /** Merged by `value` over pool options (programs/locations/source). */
  options?: Array<{
    value: string;
    label?: string;
    description?: string;
    group?: string;
    cta?: string;
    icon?: string;
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
  /** @deprecated Prefer `fields.plan.default`. Legacy fallback when fields.plan is omitted. */
  plan?: string;
  subtitle?: string;
  submit_label?: string;
  tags?: string;
  automations?: string;
  webhook?: {
    url: string;
    method?: "POST" | "GET";
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
  };
  success?: {
    url?: string;
    message?: string;
  };
  /**
   * Submit-time routes. First matching conditions (AND) overrides conversion/success/tags.
   * No match → root form props. See shared/resolveLeadFormRoute.ts.
   */
  routes?: LeadFormRoute[];
  /** Phase copy for signup forms. Locale defaults apply when a stage is omitted. */
  messages?: {
    guest?: {
      subtitle?: string | null;
      submit_label?: string;
    } | null;
    login?: {
      subtitle?: string | null;
      submit_label?: string;
      back_label?: string;
    } | null;
    incomplete?: {
      subtitle?: string | null;
      submit_label?: string;
    } | null;
    ready?: {
      subtitle?: string | null;
      submit_label?: string;
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
  locations: Array<{ slug: string; name: string; city: string; country: string; region: string }>;
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
  sessionLocation: { slug: string; region: string; country?: string } | null;
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
      rules={{
        validate: (value) => value === true || (locale === "es"
          ? "Por favor marca esta casilla para continuar"
          : "Please check this box to continue")
      }}
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

function ConsentSection({ consent, form, locale, formOptions, sessionLocation, consentSettings, fallbackKey }: ConsentSectionProps) {
  const selectedLocationSlug = form.watch("location");
  
  const isUSALocation = (): boolean => {
    if (consent.sms_usa_only === false) return true;
    
    if (selectedLocationSlug && formOptions?.locations) {
      const selectedLoc = formOptions.locations.find(loc => loc.slug === selectedLocationSlug);
      if (selectedLoc) {
        return selectedLoc.country === "United States" || 
               selectedLoc.slug.endsWith("-usa") ||
               selectedLoc.region === "north-america";
      }
    }
    
    if (sessionLocation) {
      if (sessionLocation.country === "United States" || 
          sessionLocation.country === "US" ||
          sessionLocation.slug?.endsWith("-usa")) {
        return true;
      }
      if (sessionLocation.region === "north-america") {
        return true;
      }
    }
    
    return false;
  };

  const showSmsConsent = consent.sms && (!consent.sms_usa_only || isUSALocation());

  const defaultMarketingText = resolveConsentCopy("consent_marketing", consentSettings?.consent_marketing, locale);
  const defaultSmsText = resolveConsentCopy("consent_sms", consentSettings?.consent_sms, locale);
  const defaultEmailText = resolveConsentCopy("consent_email", consentSettings?.consent_email, locale);
  const defaultWhatsappText = resolveConsentCopy("consent_whatsapp", consentSettings?.consent_whatsapp, locale);
  const showFallback = shouldShowFallbackConsent(consent, fallbackKey);
  const fallbackCopy = fallbackKey
    ? resolveConsentCopy(fallbackKey, consentSettings?.[fallbackKey], locale)
    : "";

  return (
    <div className="space-y-4">
      {showFallback && fallbackKey && (
        <FallbackConsentField
          form={form}
          locale={locale}
          fallbackKey={fallbackKey}
          html={fallbackCopy}
        />
      )}

      {consent.marketing && (
        <FormField
          control={form.control}
          name="consent_email"
          rules={{ 
            validate: (value) => value === true || (locale === "es" 
              ? "Por favor marca esta casilla para continuar" 
              : "Please check this box to continue")
          }}
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
            rules={{
              validate: (value) =>
                value === true ||
                (locale === "es"
                  ? "Por favor marca esta casilla para continuar"
                  : "Please check this box to continue"),
            }}
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

/** Resolve conversion/success/tags/webhook for one submit (route > form root > event). */
function buildEffectiveSubmitConfig(
  formData: LeadFormData,
  values: Record<string, unknown>,
  trackingSettings: TrackingSettingsResponse | null | undefined,
): {
  conversion_name?: string;
  success?: { url?: string; message?: string };
  tags: string;
  automations: string;
  formWebhook: { url: string; method?: "POST" | "GET" } | null;
  eventWebhook: { url: string; method?: "POST" | "GET" } | null;
} {
  const route = resolveLeadFormRoute(values, formData.routes);
  const overlaid = applyLeadFormRouteOutcome(
    formData as Record<string, unknown>,
    route,
  ) as LeadFormData;

  const conversionName = overlaid.conversion_name;
  const eventEntry = conversionName
    ? trackingSettings?.conversion_events?.find((e) => e.name === conversionName)
    : undefined;

  let resolved: LeadFormData = overlaid;
  if (eventEntry) {
    const wrapped = resolveFormDefaults(
      { _f: overlaid } as Record<string, unknown>,
      {
        name: eventEntry.name,
        automations: eventEntry.automations,
        tags: eventEntry.tags,
        consent: eventEntry.consent,
        webhook: eventEntry.webhook,
        success: eventEntry.success,
      },
      "_f",
    );
    resolved = wrapped._f as LeadFormData;
  }

  const formWebhook = resolved.webhook?.url
    ? {
        url: resolved.webhook.url,
        method: (resolved.webhook.method === "GET" ? "GET" : "POST") as "POST" | "GET",
      }
    : null;
  const eventWebhook =
    eventEntry?.webhook?.url
      ? {
          url: eventEntry.webhook.url,
          method: (eventEntry.webhook.method === "GET" ? "GET" : "POST") as "POST" | "GET",
        }
      : null;

  return {
    conversion_name: resolved.conversion_name ?? conversionName,
    success: resolved.success,
    tags: normalizeLeadFormTags(resolved.tags),
    automations: resolved.automations || "strong",
    formWebhook,
    eventWebhook,
  };
}

export default function LeadForm({ data, termsStyle }: LeadFormProps) {
  const landingLocations = undefined as string[] | undefined;
  const { slug, contentType, singleEntry } = useSectionContext();
  const programContext = contentType === "program" ? slug : undefined;
  const pageFunnel = usePageFunnel();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "es" ? "es" : "en";
  const { session, setConversionPage } = useSession();
  const sessionLocation = useSessionLocation();
  const utm = useUTM();
  const [isSuccess, setIsSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showTurnstileModal, setShowTurnstileModal] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<FormValues | null>(null);
  const [loginMode, setLoginMode] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [pendingAutoSubmit, setPendingAutoSubmit] = useState(false);

  const turnstileEnabled = data.turnstile?.enabled ?? true;

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

  const { data: trackingSettings } = useQuery<TrackingSettingsResponse>({
    queryKey: ["/api/settings/tracking"],
  });

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
  const { data: authSettings } = useQuery<{
    signup_configured: boolean;
    host?: string;
    login?: { url?: string };
    signup?: { payload?: Record<string, unknown> };
  }>({
    queryKey: ["/api/settings/auth"],
    enabled: isSignupRequested,
    staleTime: 5 * 60 * 1000,
  });
  const signupActive = isSignupRequested && authSettings?.signup_configured === true;

  const {
    profile: authProfile,
    isLoggedIn,
    isLoading: authProfileLoading,
    setToken: setConsumerToken,
  } = useAuthUser({
    enabled: isSignupRequested,
  });

  // Show for any signup form guest (is_signup), even if signup API isn't fully configured.
  const showSignupLoginPrompt = isSignupRequested && !isLoggedIn && !loginMode;

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
  const eventEntry = data.conversion_name
    ? trackingSettings?.conversion_events?.find((e) => e.name === data.conversion_name)
    : undefined;

  const resolvedData: LeadFormData = (() => {
    if (!eventEntry) return data;
    const wrapped = resolveFormDefaults(
      { _f: data } as Record<string, unknown>,
      {
        name: eventEntry.name,
        automations: eventEntry.automations,
        tags: eventEntry.tags,
        consent: eventEntry.consent,
        webhook: eventEntry.webhook,
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
        const authoredDefault =
          src.related_field && baseConfig.default === "auto"
            ? { ...baseConfig, default: "" }
            : baseConfig;
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
    return defaultComponentRenderer(fieldName);
  };

  const resolveDefault = (fieldName: string, configDefault?: string): string => {
    if (!configDefault || configDefault !== "auto") {
      return configDefault || "";
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
      form.setValue("location", sessionLocation.slug);
    }
    if (singleLandingRegion) {
      form.setValue("region", singleLandingRegion);
    } else if (sessionLocation?.region && !form.getValues("region")) {
      form.setValue("region", sessionLocation.region);
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
  }, [sessionLocation, utm, programContext, form, singleLandingLocation, singleLandingRegion]);

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

    return {
      ...values,
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
  };

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      // Map consent fields to backend field names
      const { consent_email, consent_sms, consent_whatsapp, ...restValues } = values;

      const fields = resolveEffectiveFieldValues(values);
      const effective = buildEffectiveSubmitConfig(data, fields, trackingSettings);
      
      // When marketing consent is enabled, derive both email and whatsapp from consent_email checkbox
      const effectiveEmailConsent = consent_email || false;
      const effectiveWhatsappConsent = consent.marketing ? effectiveEmailConsent : (consent_whatsapp || false);
      const payload = {
        ...restValues,
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
        tags: effective.tags,
        automations: effective.automations,
        conversion_name: effective.conversion_name,
        token: turnstileToken,
      };

      // Signup mode: guests are registered first via the site auth endpoint;
      // logged-in users skip this and go straight to the lead/conversion flow.
      if (signupActive && !isLoggedIn) {
        const liveSignup = {
          first_name: values.first_name,
          last_name: values.last_name,
          email: values.email,
          phone: values.phone,
          course: fields.program || "",
          country: session.geo?.country || "",
          city: session.geo?.city || "",
          plan: fields.plan,
          language: session.language,
          has_marketing_consent: effectiveEmailConsent,
          conversion_info: {
            user_agent: navigator.userAgent,
            landing_url:
              session.landing_page || utm.utm_url || window.location.pathname,
            conversion_url: window.location.pathname,
            ...(utm.utm_placement ? { internal_cta_placement: utm.utm_placement } : {}),
          },
        };
        // Merge live values over the site auth example payload template
        const template = authSettings?.signup?.payload || {};
        const templateInfo =
          template.conversion_info && typeof template.conversion_info === "object"
            ? (template.conversion_info as Record<string, unknown>)
            : {};
        const signupPayload = {
          ...template,
          ...liveSignup,
          conversion_info: {
            ...templateInfo,
            ...liveSignup.conversion_info,
          },
        };
        const signupRes = await apiRequest("POST", "/api/auth/signup", signupPayload);
        try {
          const signupJson = (await signupRes.json()) as {
            data?: { access_token?: string; token?: string };
          };
          const newToken = signupJson?.data?.access_token || signupJson?.data?.token;
          if (newToken) setConsumerToken(newToken);
        } catch {
          // Signup succeeded but response was not JSON — continue as guest
        }
      }

      // Webhook priority: per-form (YAML) → per-event → global.
      // Any configured level sends the full lead payload instead of Breathecode.
      // Global webhook: server reads credentials from settings (auth_header never exposed to client).
      // Per-form / per-event: client supplies the URL; no auth credentials at those levels.
      const formWebhook = effective.formWebhook;
      const eventWebhook = effective.eventWebhook;
      const globalWebhook = trackingSettings?.webhook?.url ? trackingSettings.webhook : null;

      const webhookOverride = formWebhook ?? eventWebhook ?? null;

      let response: Response;
      if (webhookOverride || globalWebhook) {
        const body: Record<string, unknown> = { payload };
        if (webhookOverride) {
          // Pass URL/method for per-form or per-event webhooks; server needs no credentials
          body.webhook = { url: webhookOverride.url, method: webhookOverride.method || "POST" };
        }
        // When no override, server reads global URL/method/auth_header from settings
        response = await fetch("/api/leads/webhook-delivery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        response = await apiRequest("POST", "/api/leads", payload);
      }

      return { response, fields, effective };
    },
    onSuccess: async ({ fields, effective }, variables) => {
      setSubmitError(null);
      setConversionPage(window.location.pathname);
      // Track conversion if conversion_name is defined
      if (!effective.conversion_name) {
        console.error(
          '[LeadForm] Missing conversion_name in form configuration. ' +
          'Add conversion_name to the form YAML (or a matching route) to enable tracking.'
        );
      }
      if (effective.conversion_name) {
        await ensureEcommerceProductLookup();
        const productField =
          (typeof data.ecommerce_product_field === "string" && data.ecommerce_product_field.trim()) ||
          DEFAULT_ECOMMERCE_PRODUCT_FIELD;
        const fieldRaw = (fields as Record<string, unknown>)[productField];
        const fieldValue =
          typeof fieldRaw === "string"
            ? fieldRaw
            : typeof fields.program === "string"
              ? fields.program
              : "";
        const resolvedProduct = resolveConversionProduct({
          funnel: pageFunnel,
          contentType,
          contentSlug: slug,
          fieldValue,
          productLookup: getEcommerceProductLookup(),
        });
        if (!resolvedProduct.ok) {
          console.warn(
            `[LeadForm] ecommerce product not resolved for analytics (${resolvedProduct.reason}). CRM program unchanged.`,
            { productField, fieldValue },
          );
        }
        await trackFormSubmission(
          effective.conversion_name,
          {
            email: variables.email,
            first_name: variables.first_name,
            last_name: variables.last_name,
            phone: variables.phone,
            program: fields.program,
            ...(resolvedProduct.ok
              ? { item_id: resolvedProduct.item_id, program_id: resolvedProduct.program_id }
              : {}),
            plan: fields.plan,
            location: fields.location,
            region: fields.region,
            coupon: fields.coupon,
            referral_key: fields.referral_key,
            client_comments: variables.client_comments,
            current_download: fields.current_download,
            consent_email: variables.consent_email,
            consent_sms: variables.consent_sms,
            consent_whatsapp: variables.consent_whatsapp,
            consent_general: variables.consent_general,
            ...Object.fromEntries(
              extraConsentFields.map((field) => [
                `consent_${field}`,
                Boolean(variables[`consent_${field}`]),
              ]),
            ),
          }
        );

        // The secondary curated webhook is only fired when ALL three webhook levels
        // are unconfigured (i.e., primary submission went to Breathecode).
        // When any webhook level was used above, the full payload was already delivered.
        const hasAnyWebhook = !!(
          effective.formWebhook ||
          effective.eventWebhook ||
          trackingSettings?.webhook?.url
        );
        if (!hasAnyWebhook) {
          try {
            const resolvedWebhook = resolveWebhook(
              effective.formWebhook ?? null,
              effective.conversion_name,
              trackingSettings ?? null,
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

      if (effective.success?.url) {
        const successUrl = isSignupRequested
          ? resolveSignupSuccessUrl(effective.success.url)
          : effective.success.url;
        window.location.href = successUrl;
      } else {
        setIsSuccess(true);
        setSuccessMessage(effective.success?.message || (locale === "es" 
          ? "¡Gracias! Te contactaremos pronto." 
          : "Thanks! We'll contact you soon."));
      }
    },
    onError: (error: Error) => {
      console.error("Lead submission error:", error);

      const defaultErrorMessage = locale === "es"
        ? "Hubo un problema al enviar tu información. Por favor intenta de nuevo."
        : "There was a problem submitting your information. Please try again.";

      let errorMessage = defaultErrorMessage;
      try {
        const jsonMatch = error.message.match(/^\d+:\s*(.+)$/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]) as {
            error?: unknown;
            details?: unknown;
          };
          if (typeof parsed.details === "string") {
            if (parsed.details.includes("<!DOCTYPE") || parsed.details.includes("<html")) {
              errorMessage = defaultErrorMessage;
            } else {
              try {
                const details = JSON.parse(parsed.details) as { detail?: unknown; message?: unknown };
                const fromDetails = details.detail ?? details.message;
                if (typeof fromDetails === "string") {
                  errorMessage = fromDetails;
                } else if (typeof parsed.error === "string") {
                  errorMessage = parsed.error;
                }
              } catch {
                errorMessage = parsed.details;
              }
            }
          } else if (
            parsed.details &&
            typeof parsed.details === "object" &&
            "detail" in parsed.details &&
            typeof (parsed.details as { detail: unknown }).detail === "string"
          ) {
            errorMessage = (parsed.details as { detail: string }).detail;
          } else if (typeof parsed.error === "string") {
            errorMessage = parsed.error;
          }
        }
      } catch {
        // keep default
      }

      if (errorMessage.length > 200 || /<[^>]+>/.test(errorMessage)) {
        errorMessage = defaultErrorMessage;
      }

      setSubmitError(errorMessage);
    },
  });

  const onSubmit = (values: FormValues) => {
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

  const regionPool = (
    singleLandingRegion
      ? formOptions?.regions.filter((r) => r.slug === singleLandingRegion)
      : multipleLandingRegions
        ? formOptions?.regions.filter((r) => multipleLandingRegions.includes(r.slug))
        : formOptions?.regions
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

  // Watch form values to determine if required visible fields are filled
  const watchedValues = form.watch();

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
  const formCopy = resolveLeadFormCopy(formPhase, data, locale);

  const showField = (name: keyof NonNullable<LeadFormData["fields"]>) => {
    const hideOptionals =
      isSignupRequested && isLoggedIn && !loginMode && allRequiredFieldsFilled;
    const cfg = getFieldConfig(name);
    return !!cfg.visible && !(hideOptionals && !cfg.required);
  };

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
        {formCopy.subtitle && (
          <p
            className="text-sm text-muted-foreground leading-snug mb-3"
            data-testid="text-login-subtitle"
          >
            {formCopy.subtitle}
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
                disabled={submitMutation.isPending}
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
            {showLegalAndConsent && allRequiredFieldsFilled && shouldShowFallbackConsent(consent, consentFallbackKey) && consentFallbackKey && (
              <FallbackConsentField
                form={form}
                locale={locale}
                fallbackKey={consentFallbackKey}
                html={resolveConsentCopy(consentFallbackKey, consentSettings?.[consentFallbackKey], locale)}
                className="flex flex-col space-y-2 mt-3"
              />
            )}
            {showLegalAndConsent && allRequiredFieldsFilled && consent.email && (
              <FormField
                control={form.control}
                name="consent_email"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 mt-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-consent-email"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <Label className="text-xs text-muted-foreground cursor-pointer" htmlFor="consent_email">
                        {locale === "es"
                          ? "Acepto recibir información por correo electrónico sobre talleres, eventos, cursos y otros materiales de marketing."
                          : "I agree to receive information via email about workshops, events, courses, and other marketing materials."
                        }
                      </Label>
                    </div>
                  </FormItem>
                )}
              />
            )}
          </form>
        </Form>
        {signupLoginPrompt}
      </div>
    );
  }

  return (
    <div className={data.className} data-testid="lead-form">
      {formCopy.subtitle && (
        <p
          className="text-sm text-muted-foreground leading-snug mb-2.5"
          data-testid="text-form-subtitle"
        >
          {formCopy.subtitle}
        </p>
      )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
            className={`w-full ${data.button_className || ""}`}
            disabled={submitMutation.isPending}
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
    </div>
  );
}
