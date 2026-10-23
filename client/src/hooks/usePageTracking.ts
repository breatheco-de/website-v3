import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { installSectionTracking } from "@/lib/section-tracking";
import { refreshVisitExperiment } from "@/lib/tracking";

type DataLayerEvent = {
  event: string;
  pagePath?: string;
  pageTitle?: string;
  [key: string]: unknown;
};

export function usePageTracking() {
  const [location] = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => installSectionTracking(location), [location]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const dataLayer = (window as unknown as { dataLayer: DataLayerEvent[] }).dataLayer || [];
    (window as unknown as { dataLayer: DataLayerEvent[] }).dataLayer = dataLayer;
    
    dataLayer.push({
      event: "website-route-change",
      pagePath: location,
      pageTitle: document.title,
    });
    refreshVisitExperiment();
  }, [location]);
}
