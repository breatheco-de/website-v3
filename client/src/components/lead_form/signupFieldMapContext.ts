/**
 * Context for the Consumer Auth signup field_map (form.* / session.* / global.*),
 * shared by the LeadForm signup submit and the edit-mode hidden fields notice.
 */
import {
  isGlobalEntry,
  type AuthSignupFieldMapEntry,
  type SignupFieldMapResolveContext,
} from "@shared/authSignupFieldMap";
import type { Session, UTMParams } from "@shared/session";

export interface BuildSignupFieldMapContextInput {
  /** Raw react-hook-form values. */
  values: Record<string, unknown>;
  /** Effective field values (resolveEffectiveFieldValues); win over raw values. */
  fields: Record<string, unknown>;
  consents: { consent_email?: boolean; consent_sms?: boolean; consent_whatsapp?: boolean };
  session: Pick<
    Session,
    "language" | "browserLang" | "landing_page" | "conversion_page" | "userId" | "geo"
  >;
  sessionLocation: unknown;
  utm: Partial<UTMParams>;
  fieldMap: AuthSignupFieldMapEntry[];
  /** Resolves `global.*`; null while variable definitions are not loaded (globals → ""). */
  resolveGlobal: ((name: string) => string) | null;
}

export function buildSignupFieldMapContext(
  input: BuildSignupFieldMapContextInput,
): SignupFieldMapResolveContext {
  const { values, fields, consents, session, sessionLocation, utm, fieldMap, resolveGlobal } = input;
  const form: Record<string, unknown> = {
    ...values,
    ...fields,
    consent_email: consents.consent_email,
    consent_sms: consents.consent_sms,
    consent_whatsapp: consents.consent_whatsapp,
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
  const globals: Record<string, string> = {};
  for (const entry of fieldMap) {
    if (!isGlobalEntry(entry)) continue;
    globals[entry.global] = resolveGlobal ? resolveGlobal(entry.global) : "";
  }
  return { form, session: sessionCtx, globals };
}
