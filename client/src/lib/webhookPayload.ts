/**
 * Builds a sample webhook payload by merging the base SAMPLE_LEAD_PAYLOAD with:
 * - YML form-settings fields (program, tags, automations, consent) extracted from
 *   `sectionSource` at the given `formSettingsPath`
 * - Session-derived fields: language, browser language, location, geo-coordinates,
 *   and all UTM / referral parameters
 *
 * Pass the result directly as `samplePayload` to WebhookCard and as the `payload`
 * body when calling the webhook test endpoint.
 *
 * `formSettingsPath` of `""` / `"."` means settings live at the section root (lead_form).
 * When `singleEntry` is provided and the form field uses `source.related_field`, resolve
 * the program value from that entry field; otherwise fall back to authored `default`.
 */

import type { Session } from "@shared/session";
import { joinFormSettingsPath } from "@shared/joinFormSettingsPath";
import { buildSamplePayload } from "@/lib/tracking";
import { parseFormFieldSource } from "@shared/parseFormFieldSource";
import {
  applyChoiceCardinality,
  resolveFormFieldRelationSource,
  resolveSubmitValueFromOptions,
} from "@shared/resolveFormFieldRelationSource";
import type { RelationEditorHint } from "@shared/relation-field";

function getValueAtPath(obj: unknown, fieldPath: string): unknown {
  if (!fieldPath) return obj;
  const parts = fieldPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export type BuildWebhookSamplePayloadOptions = {
  singleEntry?: Record<string, unknown>;
  editor?: Record<string, { type?: string } & RelationEditorHint> | null;
};

function resolveProgramFromFormSettings(
  sectionSource: unknown,
  formSettingsPath: string,
  opts?: BuildWebhookSamplePayloadOptions,
): string | undefined {
  const fp = (relative: string) => joinFormSettingsPath(formSettingsPath, relative);
  const sourceRaw = getValueAtPath(sectionSource, fp("fields.program.source"));
  const authoredDefault = getValueAtPath(
    sectionSource,
    fp("fields.program.default"),
  ) as string | undefined;

  if (sourceRaw != null && opts?.singleEntry) {
    const src = parseFormFieldSource(
      sourceRaw as string | { related_field?: string; content_type?: string },
    );
    if (src.related_field) {
      const resolved = resolveFormFieldRelationSource({
        formFieldName: "program",
        relationField: src.related_field,
        singleEntry: opts.singleEntry,
        editorHint: opts.editor?.[src.related_field],
        requireCatalogHit: false,
        valuePath: src.value_path,
        labelPath: src.label_path,
      });
      if (resolved.ok && resolved.options.length > 0) {
        const card = applyChoiceCardinality(
          { default: typeof authoredDefault === "string" ? authoredDefault : "" },
          resolved.options,
        );
        const selected = card.default || resolved.options[0]!.value;
        return resolveSubmitValueFromOptions(selected, resolved.options);
      }
      // Runtime/sample fallback when relation empty
      return typeof authoredDefault === "string" && authoredDefault !== "auto"
        ? authoredDefault
        : undefined;
    }
  }

  return typeof authoredDefault === "string" && authoredDefault.trim()
    ? authoredDefault
    : undefined;
}

export function buildWebhookSamplePayload(
  sectionSource: unknown,
  formSettingsPath: string | null | undefined,
  session: Session,
  opts?: BuildWebhookSamplePayloadOptions,
): Record<string, unknown> {
  const formSettingsOverrides: Partial<Record<string, unknown>> = {};

  if (formSettingsPath != null) {
    const fp = (relative: string) => joinFormSettingsPath(formSettingsPath, relative);
    const program = resolveProgramFromFormSettings(
      sectionSource,
      formSettingsPath,
      opts,
    );
    const currentDownload = getValueAtPath(sectionSource, fp("fields.current_download.default")) as string | undefined;
    const tags = getValueAtPath(sectionSource, fp("tags"));
    const automations = getValueAtPath(sectionSource, fp("automations")) as string | undefined;
    const consentEmail = getValueAtPath(sectionSource, fp("consent.marketing")) as boolean | undefined;
    const consentSms = getValueAtPath(sectionSource, fp("consent.sms")) as boolean | undefined;
    const consentWhatsapp = getValueAtPath(sectionSource, fp("consent.whatsapp")) as boolean | undefined;
    const consentObj = getValueAtPath(sectionSource, fp("consent"));

    if (program) formSettingsOverrides.program = program;
    if (currentDownload) formSettingsOverrides.current_download = currentDownload;
    if (tags != null) formSettingsOverrides.tags = tags;
    if (automations) formSettingsOverrides.automations = automations;
    if (consentEmail != null) formSettingsOverrides.consent_email = consentEmail;
    if (consentSms != null) formSettingsOverrides.sms_consent = consentSms;
    if (consentWhatsapp != null) formSettingsOverrides.consent_whatsapp = consentWhatsapp;
    if (consentObj && typeof consentObj === "object") {
      for (const [key, value] of Object.entries(consentObj as Record<string, unknown>)) {
        if (typeof value !== "boolean") continue;
        if (
          key === "marketing" ||
          key === "sms" ||
          key === "whatsapp" ||
          key === "email" ||
          key === "sms_usa_only" ||
          key === "sms_countries" ||
          key === "sms_countries_mode" ||
          key === "whatsapp_countries" ||
          key === "whatsapp_countries_mode"
        ) {
          continue;
        }
        formSettingsOverrides[`consent_${key}`] = value;
      }
    }
  }

  const sessionOverrides: Partial<Record<string, unknown>> = {};

  if (session.language) sessionOverrides.language = session.language;
  if (session.browserLang) sessionOverrides.browser_lang = session.browserLang;
  if (session.location?.slug) sessionOverrides.location = session.location.slug;
  if (session.location?.region) sessionOverrides.region = session.location.region;
  if (session.location?.city) sessionOverrides.city = session.location.city;
  if (session.location?.country_code) sessionOverrides.country = session.location.country_code;
  if (session.geo?.latitude != null) sessionOverrides.latitude = String(session.geo.latitude);
  if (session.geo?.longitude != null) sessionOverrides.longitude = String(session.geo.longitude);
  if (session.utm?.utm_source) sessionOverrides.utm_source = session.utm.utm_source;
  if (session.utm?.utm_medium) sessionOverrides.utm_medium = session.utm.utm_medium;
  if (session.utm?.utm_campaign) sessionOverrides.utm_campaign = session.utm.utm_campaign;
  if (session.utm?.utm_content) sessionOverrides.utm_content = session.utm.utm_content;
  if (session.utm?.utm_term) sessionOverrides.utm_term = session.utm.utm_term;
  if (session.utm?.utm_url) sessionOverrides.utm_url = session.utm.utm_url;
  if (session.utm?.utm_placement) sessionOverrides.utm_placement = session.utm.utm_placement;
  if (session.utm?.utm_plan) sessionOverrides.utm_plan = session.utm.utm_plan;
  if (session.utm?.ppc_tracking_id) sessionOverrides.ppc_tracking_id = session.utm.ppc_tracking_id;
  if (session.utm?.referral) sessionOverrides.referral = session.utm.referral;
  if (session.utm?.referral_key) sessionOverrides.referral_key = session.utm.referral_key;
  if (session.utm?.coupon) sessionOverrides.coupon = session.utm.coupon;
  if (session.utm?.utm_id) sessionOverrides.utm_id = session.utm.utm_id;
  for (const clickId of ["gclid", "fbclid", "msclkid", "ttclid", "li_fat_id"] as const) {
    const v = session.utm?.[clickId];
    if (v) sessionOverrides[clickId] = v;
  }
  if (session.utm?.fbp) sessionOverrides.fbp = session.utm.fbp;
  if (session.utm?.fbc) sessionOverrides.fbc = session.utm.fbc;
  if (session.first_touch?.utm_source) sessionOverrides.first_utm_source = session.first_touch.utm_source;
  if (session.first_touch?.utm_medium) sessionOverrides.first_utm_medium = session.first_touch.utm_medium;
  if (session.first_touch?.utm_campaign) sessionOverrides.first_utm_campaign = session.first_touch.utm_campaign;
  if (session.landing_page) sessionOverrides.landing_url = session.landing_page;
  const lastPaid = session.paid_landing?.last;
  if (lastPaid) {
    sessionOverrides.last_paid_landing_url = `https://${lastPaid.host}${lastPaid.path}`;
    sessionOverrides.last_paid_landing_at = new Date(lastPaid.at).toISOString();
  }

  return buildSamplePayload({ ...formSettingsOverrides, ...sessionOverrides });
}
