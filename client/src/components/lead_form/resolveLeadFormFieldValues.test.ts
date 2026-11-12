import { describe, expect, it } from "vitest";
import { resolveSubmitValueFromOptions } from "@shared/resolveFormFieldRelationSource";
import {
  isNonEmptyLeadFormWireScalar,
  resolveLeadFormFieldValue,
  resolveLeadFormFieldValues,
  type LeadFormFieldDefault,
  type LeadFormFieldResolveContext,
} from "./resolveLeadFormFieldValues";

/** Pre-refactor LeadFormDefault chain, kept verbatim as the parity oracle. */
function legacyResolve(ctx: LeadFormFieldResolveContext): Record<string, LeadFormFieldDefault> {
  const { values, programContext, singleLandingLocation, singleLandingRegion, sessionLocation, utm } = ctx;
  const v = values as Record<string, string | undefined>;
  const resolveDefault = (fieldName: string, configDefault?: LeadFormFieldDefault): string => {
    if (configDefault === undefined || configDefault === null) return "";
    if (typeof configDefault !== "string") return String(configDefault);
    if (configDefault !== "auto") return configDefault;
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
  const def = (n: string) => ctx.getConfigDefault(n);
  const rawProgram =
    v.program ||
    ctx.formPrograms?.find((p) => p.slug === programContext)?.bc_slug ||
    programContext ||
    resolveDefault("program", def("program"));
  const resolved: Record<string, LeadFormFieldDefault> = {
    ...Object.fromEntries(
      Object.entries(values).filter((e): e is [string, string] => typeof e[1] === "string"),
    ),
    program: resolveSubmitValueFromOptions(rawProgram, ctx.programOptions) || rawProgram,
    location: singleLandingLocation || v.location || sessionLocation?.slug || resolveDefault("location", def("location")),
    region: singleLandingRegion || v.region || sessionLocation?.region || resolveDefault("region", def("region")),
    coupon: v.coupon || utm.coupon || resolveDefault("coupon", def("coupon")),
    referral_key:
      v.referral_key || utm.referral_key || utm.referral || utm.ref || resolveDefault("referral_key", def("referral_key")),
    current_download: v.current_download || resolveDefault("current_download", def("current_download")),
    plan: v.plan || resolveDefault("plan", def("plan")) || "",
  };
  for (const [key, cfg] of Object.entries(ctx.fields || {})) {
    if (!cfg || typeof cfg !== "object") continue;
    if (isNonEmptyLeadFormWireScalar(resolved[key])) continue;
    const rawDefault = cfg.default;
    if (!isNonEmptyLeadFormWireScalar(rawDefault)) continue;
    if (typeof rawDefault === "string") {
      resolved[key] = resolveDefault(key, rawDefault) || rawDefault;
    } else {
      resolved[key] = rawDefault;
    }
  }
  return resolved;
}

const BUILTIN_DEFAULTS: Record<string, LeadFormFieldDefault | undefined> = {
  program: "auto",
  region: "auto",
  location: "auto",
  coupon: "auto",
  plan: "",
};

function makeCtx(overrides: Partial<LeadFormFieldResolveContext> = {}): LeadFormFieldResolveContext {
  const fields = overrides.fields ?? {};
  return {
    values: {
      email: "",
      first_name: "",
      last_name: "",
      phone: "",
      program: "",
      plan: "",
      region: "",
      location: "",
      coupon: "",
      referral_key: "",
      client_comments: "",
      current_download: "",
      consent_email: false,
      consent_sms: false,
      consent_whatsapp: false,
      consent_general: false,
    },
    fields,
    getConfigDefault: (name) =>
      (fields[name] && "default" in fields[name]! ? fields[name]!.default : BUILTIN_DEFAULTS[name]),
    programOptions: [],
    utm: {},
    ...overrides,
  };
}

const SCENARIOS: Array<[string, LeadFormFieldResolveContext]> = [
  ["empty form", makeCtx()],
  ["detected location", makeCtx({ sessionLocation: { slug: "miami", region: "usa-canada" } })],
  [
    "detected location copied into form state",
    makeCtx({
      values: { ...makeCtx().values, location: "miami", region: "usa-canada" },
      sessionLocation: { slug: "miami", region: "usa-canada" },
    }),
  ],
  ["coupon and ref from URL", makeCtx({ utm: { coupon: "SAVE10", ref: "abc" } })],
  [
    "program page via catalog",
    makeCtx({
      programContext: "full-stack",
      formPrograms: [{ slug: "full-stack", bc_slug: "full-stack-bc" }],
    }),
  ],
  [
    "single source option",
    makeCtx({
      values: { ...makeCtx().values, program: "only-one" },
      fields: { program: { default: "only-one" } },
      programOptions: [{ value: "only-one", label: "Only", bc_slug: "only-one-bc" }],
    }),
  ],
  [
    "signup prefill",
    makeCtx({
      values: { ...makeCtx().values, email: "a@b.co", first_name: "Ana" },
      identityPrefill: { email: "a@b.co", first_name: "Ana" },
    }),
  ],
  [
    "extra keys",
    makeCtx({ fields: { event_id: { default: 42 }, product: { default: "prod-x" }, persona: { default: "" } } }),
  ],
  ["auto with nothing detected", makeCtx({ fields: { location: { default: "auto" }, coupon: { default: "auto" } } })],
  ["fixed plan default", makeCtx({ fields: { plan: { default: "free-plan" } } })],
];

describe("resolveLeadFormFieldValues parity", () => {
  it.each(SCENARIOS)("matches the pre-refactor chain: %s", (_label, ctx) => {
    expect(resolveLeadFormFieldValues(ctx)).toEqual(legacyResolve(ctx));
  });
});

describe("resolveLeadFormFieldValue sources", () => {
  it("attributes a detected location", () => {
    const r = resolveLeadFormFieldValue("location", SCENARIOS[1]![1]);
    expect(r.value).toBe("miami");
    expect(r.source).toBe("visitor_location");
    expect(r.viewerDependent).toBe(true);
    expect(r.candidates.map((c) => c.source)).toEqual([
      "page_single_location",
      "form_state",
      "visitor_location",
      "configured_default",
    ]);
  });

  it("attributes form state copied from the detected location", () => {
    const r = resolveLeadFormFieldValue("location", SCENARIOS[2]![1]);
    expect(r.source).toBe("visitor_location");
    expect(r.viaFormState).toBe(true);
  });

  it("reads coupon and ref from the URL", () => {
    const ctx = SCENARIOS[3]![1];
    expect(resolveLeadFormFieldValue("coupon", ctx)).toMatchObject({ value: "SAVE10", source: "url_coupon", viewerDependent: true });
    expect(resolveLeadFormFieldValue("referral_key", ctx)).toMatchObject({ value: "abc", source: "url_ref" });
  });

  it("uses the program page catalog id", () => {
    const r = resolveLeadFormFieldValue("program", SCENARIOS[4]![1]);
    expect(r).toMatchObject({ value: "full-stack-bc", source: "program_page_catalog", viewerDependent: false });
  });

  it("maps a single source option to its submit id", () => {
    const r = resolveLeadFormFieldValue("program", SCENARIOS[5]![1]);
    expect(r.value).toBe("only-one-bc");
    expect(r.programRawValue).toBe("only-one");
    expect(r.source).toBe("configured_default");
    expect(r.viaFormState).toBe(true);
  });

  it("marks signup prefill as the signed-in account", () => {
    const r = resolveLeadFormFieldValue("email", SCENARIOS[6]![1]);
    expect(r).toMatchObject({ value: "a@b.co", source: "signed_in_profile", viewerDependent: true });
  });

  it("resolves extra keys from their defaults", () => {
    const ctx = SCENARIOS[7]![1];
    expect(resolveLeadFormFieldValue("event_id", ctx)).toMatchObject({ value: 42, source: "configured_default" });
    expect(resolveLeadFormFieldValue("persona", ctx).value).toBeUndefined();
  });

  it("sends the literal auto when nothing is detected", () => {
    const r = resolveLeadFormFieldValue("location", SCENARIOS[8]![1]);
    expect(r).toMatchObject({ value: "auto", source: "configured_default_literal" });
  });

  it("is pending while the session is loading", () => {
    const ctx = makeCtx({ loading: { session: true } });
    expect(resolveLeadFormFieldValue("location", ctx).pending).toBe(true);
    expect(resolveLeadFormFieldValue("current_download", ctx).pending).toBe(false);
  });

  it("is not pending once a value wins before the loading source", () => {
    const ctx = makeCtx({
      values: { ...makeCtx().values, location: "typed" },
      loading: { session: true },
    });
    expect(resolveLeadFormFieldValue("location", ctx).pending).toBe(false);
  });
});
