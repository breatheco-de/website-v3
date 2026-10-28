import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  OPEN_CONSENT_BANNER_EVENT,
  readConsentCookie,
  recordBannerShown,
  saveConsentDecision,
} from "@/lib/consent";
import type { ConsentDecision, ConsentMode, CookieBannerCopy } from "@shared/consent";

interface ConsentWindowResponse {
  mode: ConsentMode;
  country: string | null;
  copy: CookieBannerCopy;
  privacy_url: string | null;
}

/** Scroll distance (px) that counts as "kept browsing" in notice mode. */
const IMPLIED_SCROLL_PX = 250;

function isStaffPath(path: string): boolean {
  return path.startsWith("/private") || path.startsWith("/preview-frame");
}

/**
 * Non-blocking bottom bar for tracking consent.
 * - Ask regions: Accept (primary) then Reject; ignoring it means no consent.
 * - Notice regions: OK, or the first scroll, counts as consent.
 * - The footer "Privacy choices" link reopens it with Accept / Reject everywhere.
 */
export function ConsentBanner() {
  const [location] = useLocation();
  const { i18n } = useTranslation();
  const locale = (i18n.language || "en").split("-")[0];
  const [config, setConfig] = useState<ConsentWindowResponse | null>(null);
  const [visible, setVisible] = useState(false);
  const [reopened, setReopened] = useState(false);
  const shownRecorded = useRef(false);
  const landingSaved = useRef(false);
  const staff = isStaffPath(location);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/consent-window?locale=${encodeURIComponent(locale)}`, {
        credentials: "same-origin",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as ConsentWindowResponse;
      setConfig(data);
      return data;
    } catch {
      return null;
    }
  }, [locale]);

  useEffect(() => {
    if (staff || readConsentCookie()) return;
    let cancelled = false;
    void load().then((data) => {
      if (cancelled || !data) return;
      setVisible(true);
      if (!shownRecorded.current) {
        shownRecorded.current = true;
        void recordBannerShown(data.mode, data.country);
      }
      // Ads-first landing in a notice country: consent counts on landing; store it and keep the bar.
      // index.html already granted it when the server knew the country; otherwise this is the first point we know.
      if (!landingSaved.current && window.__4G_PAGE__?.af === 1 && data.mode === "notice") {
        landingSaved.current = true;
        void saveConsentDecision("granted_implied", "notice", data.country);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [staff, load]);

  useEffect(() => {
    const onOpen = () => {
      setReopened(true);
      if (config) setVisible(true);
      else void load().then((data) => data && setVisible(true));
    };
    window.addEventListener(OPEN_CONSENT_BANNER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CONSENT_BANNER_EVENT, onOpen);
  }, [config, load]);

  const decide = useCallback(
    (decision: ConsentDecision) => {
      if (!config) return;
      setVisible(false);
      setReopened(false);
      void saveConsentDecision(decision, config.mode, config.country);
    },
    [config],
  );

  const noticeMode = config?.mode === "notice" && !reopened;

  useEffect(() => {
    if (!visible || !noticeMode) return;
    const onScroll = () => {
      if (window.scrollY >= IMPLIED_SCROLL_PX) decide("granted_implied");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [visible, noticeMode, decide]);

  if (staff || !visible || !config) return null;
  const { copy } = config;

  return (
    <div
      role="region"
      aria-label={copy.cookie_banner_privacy_link}
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-background/95 text-foreground shadow-[0_-4px_24px_rgba(0,0,0,0.25)] backdrop-blur supports-[backdrop-filter]:bg-background/85"
      data-testid="consent-banner"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-snug text-foreground/85">
          {noticeMode ? copy.cookie_banner_notice : copy.cookie_banner_ask}{" "}
          {config.privacy_url ? (
            <a
              href={config.privacy_url}
              className="underline underline-offset-2 hover:text-foreground"
              data-testid="link-consent-privacy"
            >
              {copy.cookie_banner_privacy_link}
            </a>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {noticeMode ? (
            <Button size="sm" onClick={() => decide("granted_explicit")} data-testid="button-consent-ok">
              {copy.cookie_banner_ok}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                className="min-w-24"
                onClick={() => decide("granted_explicit")}
                data-testid="button-consent-accept"
              >
                {copy.cookie_banner_accept}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="min-w-24"
                onClick={() => decide("denied")}
                data-testid="button-consent-reject"
              >
                {copy.cookie_banner_reject}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConsentBanner;
