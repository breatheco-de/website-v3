/**
 * Browser-side tracking consent: read the `4g_consent` cookie, tell Google
 * Consent Mode / Meta pixel, and notify listeners (session context, ad cookie).
 * The server sets the cookie (POST /api/consent) so Safari keeps it past 7 days.
 */

import {
  CONSENT_COOKIE_NAME,
  consentModeSignals,
  isGrantedDecision,
  parseConsentCookie,
  type ConsentCookieValue,
  type ConsentDecision,
  type ConsentMode,
} from '@shared/consent';
import { clearRawCookie, readRawCookie } from './sessionCookie';
import { getDebugToken } from '@/hooks/useDebugAuth';

export type ConsentState = 'granted' | 'denied' | 'unset';

type Listener = (state: ConsentState) => void;
const listeners = new Set<Listener>();

type GtagFn = (...args: unknown[]) => void;
type FbqFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
    fbq?: FbqFn;
    __4G_CONSENT__?: { decision: string | null; mode: string | null; granted: boolean; landingImplied?: boolean };
    __4G_PAGE__?: { af?: 0 | 1; cm?: "ask" | "notice" | null; fp?: 0 | 1; t?: string };
  }
}

export function readConsentCookie(): ConsentCookieValue | null {
  return parseConsentCookie(readRawCookie(CONSENT_COOKIE_NAME));
}

export function getConsentState(): ConsentState {
  const value = readConsentCookie();
  if (!value) return 'unset';
  return isGrantedDecision(value.decision) ? 'granted' : 'denied';
}

export function hasTrackingConsent(): boolean {
  return getConsentState() === 'granted';
}

export function onConsentChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(state: ConsentState): void {
  listeners.forEach((l) => {
    try {
      l(state);
    } catch {
      /* listener errors must not block consent */
    }
  });
}

function pushSignals(granted: boolean): void {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  const gtag: GtagFn =
    window.gtag ??
    function gtagShim() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments as unknown as Record<string, unknown>);
    };
  gtag('consent', 'update', consentModeSignals(granted));
  try {
    window.fbq?.('consent', granted ? 'grant' : 'revoke');
  } catch {
    /* pixel not loaded */
  }
  window.dataLayer.push({
    is_staff: !!getDebugToken(),
    event: 'consent_update',
    consent_state: granted ? 'granted' : 'denied',
  });
  window.__4G_CONSENT__ = { ...(window.__4G_CONSENT__ ?? { decision: null, mode: null }), granted, landingImplied: false };
}

async function postConsent(body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function recordBannerShown(mode: ConsentMode, country: string | null): Promise<void> {
  await postConsent({ kind: 'shown', mode, country });
}

/** Save a decision (server sets the cookie), then update tags and listeners. */
export async function saveConsentDecision(
  decision: ConsentDecision,
  mode: ConsentMode,
  country: string | null,
): Promise<void> {
  const granted = isGrantedDecision(decision);
  pushSignals(granted);
  // Listeners may call /api/ad-context, which needs the cookie this request sets.
  await postConsent({ kind: decision, mode, country });
  notifyListeners(granted ? 'granted' : 'denied');
}

/**
 * Staff/debug helper: drop `4g_consent` so the banner can ask again.
 * Does not write a Reject decision (that would hide the banner for reject_days).
 */
export function clearConsentDecision(): void {
  clearRawCookie(CONSENT_COOKIE_NAME);
  pushSignals(false);
  window.__4G_CONSENT__ = { decision: null, mode: null, granted: false };
  notifyListeners('unset');
  openConsentBanner();
}

/** Re-open the banner from the footer "Privacy choices" link. */
export const OPEN_CONSENT_BANNER_EVENT = '4g:open-consent-banner';

export function openConsentBanner(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_CONSENT_BANNER_EVENT));
}
