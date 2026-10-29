import { useEffect } from "react";
import { useLocation } from "wouter";
import { installSectionTracking } from "@/lib/section-tracking";
import { notePageRoute, startPageReady } from "@/lib/page-ready";
import {
  isPageContextSet,
  isStaffSession,
  onPageContextSet,
  refreshVisitExperiment,
  setPageTrackingContext,
} from "@/lib/tracking";

type DataLayerEvent = {
  event: string;
  pagePath?: string;
  pageTitle?: string;
  [key: string]: unknown;
};

/** Longest an in-site page view waits for the new page's product / persona values. */
const ROUTE_CHANGE_WAIT_MS = 2000;

/** Location whose page view is already scheduled, so a re-run of the effect (e.g. React StrictMode) never sends twice. */
let handledLocation: string | null = null;

export function usePageTracking() {
  const [location] = useLocation();

  useEffect(() => installSectionTracking(location), [location]);

  useEffect(() => {
    startPageReady();
    notePageRoute(window.location.pathname);
  }, [location]);

  useEffect(() => {
    // Runs on the first load too, so one website-route-change covers every page view.
    if (handledLocation === location) return;
    handledLocation = location;

    // The page view goes out on the first of: the new page's context is set, the wait runs
    // out, the visitor navigates again, or the tab is hidden / closed. It is never dropped.
    const pathname = window.location.pathname;
    let sent = false;
    let stopWaiting = () => {};
      const send = () => {
        if (sent) return;
        sent = true;
        stopWaiting();
        if (!isPageContextSet(pathname)) setPageTrackingContext(null, pathname);
        const dataLayer = (window as unknown as { dataLayer: DataLayerEvent[] }).dataLayer || [];
        (window as unknown as { dataLayer: DataLayerEvent[] }).dataLayer = dataLayer;
        dataLayer.push({
          is_staff: isStaffSession(),
          event: "website-route-change",
          pagePath: location,
          pageTitle: document.title,
        });
        refreshVisitExperiment();
      };
    const onHidden = () => {
      if (document.visibilityState === "hidden") send();
    };
    const timer = window.setTimeout(send, ROUTE_CHANGE_WAIT_MS);
    window.addEventListener("pagehide", send);
    document.addEventListener("visibilitychange", onHidden);
    const offContext = onPageContextSet(pathname, () => {
      // Let the page title update in the same tick before reporting.
      window.setTimeout(send, 0);
    });
    stopWaiting = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", send);
      document.removeEventListener("visibilitychange", onHidden);
      offContext();
    };
    return send;
  }, [location]);
}
