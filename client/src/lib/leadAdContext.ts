/**
 * Campaign context sent with every lead (flat scalars). Built from the in-memory
 * session, so a lead in the same visit still carries it before consent; the server
 * prefers the `4g_ads` cookie when consent was given.
 */

import type { Session } from '@shared/session';
import { CLICK_ID_PARAMS } from '@shared/paid-traffic';
import { getDebugToken } from '@/hooks/useDebugAuth';
import { getCurrentPageVersion, getVisitExperiment } from './tracking';

export function newSubmissionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Staff token header so the server can flag staff test leads (`is_test` + `is_staff`, reason staff_session). */
export function staffLeadHeaders(): Record<string, string> {
  const token = getDebugToken();
  return token ? { 'X-Debug-Token': token } : {};
}

const STAFF_SUBMIT_ACK_KEY = '4g_staff_lead_submit_ack';

/** Staff must confirm a lead submit unless they chose "don't ask again" this browser session. */
export function needsStaffSubmitConfirm(): boolean {
  if (!getDebugToken()) return false;
  try {
    return sessionStorage.getItem(STAFF_SUBMIT_ACK_KEY) !== '1';
  } catch {
    return true;
  }
}

export function skipStaffSubmitConfirmThisSession(): void {
  try {
    sessionStorage.setItem(STAFF_SUBMIT_ACK_KEY, '1');
  } catch {
    /* storage blocked: ask again next time */
  }
}

export function buildLeadAdContext(
  session: Session,
  submissionId: string,
): Record<string, string | number | undefined> {
  const utm = session.utm ?? {};
  const out: Record<string, string | number | undefined> = {
    submission_id: submissionId,
    utm_id: utm.utm_id,
    fbp: utm.fbp,
    fbc: utm.fbc,
    landing_url: session.landing_page || window.location.pathname,
    conversion_url: window.location.pathname,
  };
  for (const c of CLICK_ID_PARAMS) {
    const v = utm[c as keyof typeof utm];
    if (v) out[c] = v;
  }
  const first = session.first_touch;
  if (first) {
    out.first_utm_source = first.utm_source;
    out.first_utm_medium = first.utm_medium;
    out.first_utm_campaign = first.utm_campaign;
    out.first_utm_content = first.utm_content;
    out.first_utm_term = first.utm_term;
  }
  const pl = session.paid_landing;
  for (const prefix of ['first', 'last'] as const) {
    const ref = pl?.[prefix];
    if (!ref) continue;
    out[`${prefix}_paid_landing_host`] = ref.host;
    out[`${prefix}_paid_landing_path`] = ref.path;
    out[`${prefix}_paid_landing_at`] = ref.at;
    out[`${prefix}_paid_landing_platform`] = ref.platform ?? undefined;
    out[`${prefix}_paid_landing_campaign_id`] = ref.campaign_id ?? undefined;
    out[`${prefix}_paid_landing_adset_id`] = ref.adset_id ?? undefined;
    out[`${prefix}_paid_landing_ad_id`] = ref.ad_id ?? undefined;
  }
  const ec = session.entry_channel;
  const touch = ec?.last ?? ec?.first;
  if (touch) {
    out.channel = touch.channel;
    out.channel_landing_path = touch.path;
    out.referrer_host = touch.referrer_host;
  }
  if (ec?.first) out.first_channel = ec.first.channel;
  const pv = getVisitExperiment() ?? getCurrentPageVersion();
  if (pv) out.page_experiment_id = pv.experiment_id;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== ''));
}
