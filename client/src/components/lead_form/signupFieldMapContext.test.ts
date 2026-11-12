import { describe, expect, it } from "vitest";
import {
  buildSignupPayloadFromFieldMap,
  isGlobalEntry,
  type AuthSignupFieldMapEntry,
} from "@shared/authSignupFieldMap";
import { buildSignupFieldMapContext } from "./signupFieldMapContext";

const fieldMap: AuthSignupFieldMapEntry[] = [
  { key: "email", from: "form.email", required: true },
  { key: "course", from: "form.program" },
  { key: "plan", global: "global.default_free_signup_plan" },
  { key: "source", constant: "website" },
  { key: "country", from: "session.geo.country" },
  { key: "campus", from: "session.location.slug" },
  { key: "coupon", from: "session.utm.coupon" },
  { key: "has_marketing_consent", from: "form.consent_email" },
];

const values = { email: "a@b.co", program: "raw-pick", consent_email: true };
const fields = { program: "full-stack-bc", location: "miami" };
const consents = { consent_email: true, consent_sms: false, consent_whatsapp: true };
const session = {
  language: "en" as const,
  browserLang: "en-US",
  landing_page: "/landing",
  conversion_page: undefined,
  userId: "u1",
  geo: { country: "US", city: "Miami" } as never,
};
const sessionLocation = { slug: "miami", region: "usa-canada" };
const utm = { utm_source: "google", coupon: "SAVE10", ref: "abc" };
const globals = { "global.default_free_signup_plan": "free-plan" };

/** Pre-refactor inline construction in LeadFormDefault submitMutation. */
function legacyPayload() {
  const formCtx = { ...values, ...fields, ...consents };
  const sessionCtx = {
    language: session.language,
    browserLang: session.browserLang,
    landing_page: session.landing_page,
    conversion_page: session.conversion_page,
    userId: session.userId,
    geo: session.geo ?? {},
    location: sessionLocation ?? {},
    utm: {
      utm_source: utm.utm_source,
      utm_medium: undefined,
      utm_campaign: undefined,
      utm_content: undefined,
      utm_term: undefined,
      utm_url: undefined,
      utm_placement: undefined,
      utm_plan: undefined,
      coupon: utm.coupon,
      referral_key: undefined,
      referral: undefined,
      ref: utm.ref,
    },
  };
  const g: Record<string, string> = {};
  for (const entry of fieldMap) if (isGlobalEntry(entry)) g[entry.global] = globals[entry.global as keyof typeof globals] ?? "";
  return buildSignupPayloadFromFieldMap(fieldMap, { form: formCtx, session: sessionCtx, globals: g }, { x: 1 });
}

describe("buildSignupFieldMapContext", () => {
  it("builds the same signup payload as the pre-refactor submit", () => {
    const ctx = buildSignupFieldMapContext({
      values,
      fields,
      consents,
      session,
      sessionLocation,
      utm,
      fieldMap,
      resolveGlobal: (name) => globals[name as keyof typeof globals] ?? "",
    });
    const payload = buildSignupPayloadFromFieldMap(fieldMap, ctx, { x: 1 });
    expect(payload).toEqual(legacyPayload());
    expect(payload).toMatchObject({
      course: "full-stack-bc",
      plan: "free-plan",
      source: "website",
      country: "US",
      campus: "miami",
      coupon: "SAVE10",
      has_marketing_consent: true,
    });
  });

  it("sends empty globals while variable definitions are not loaded", () => {
    const ctx = buildSignupFieldMapContext({
      values,
      fields,
      consents,
      session,
      sessionLocation,
      utm,
      fieldMap,
      resolveGlobal: null,
    });
    expect(ctx.globals).toEqual({ "global.default_free_signup_plan": "" });
  });
});
