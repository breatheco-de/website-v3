/**
 * Client helper: load product map and register trackEcommerce lookup.
 */

import {
  setEcommerceProductLookup,
  type ProductLookup,
} from "@/lib/tracking";
import type { TrackingKeyIndex } from "@shared/tracking-keys";

export interface EcommerceProductMapEntry {
  product_id: string;
  name: string;
  content_type: string;
  content_slug: string;
  actively_selling?: boolean;
  /** @deprecated use actively_selling */
  active?: boolean;
  short_key?: string;
}

/** Site tracking keys + whether product/persona tracking fields are on. */
export interface TrackingKeysState {
  ready: boolean;
  keys: TrackingKeyIndex;
}

const EMPTY_TRACKING: TrackingKeysState = { ready: false, keys: { products: [] } };
let trackingState: TrackingKeysState | null = null;

export function isActivelySelling(p: {
  actively_selling?: boolean;
  active?: boolean;
}): boolean {
  if (typeof p.actively_selling === "boolean") return p.actively_selling;
  if (typeof p.active === "boolean") return p.active;
  return true;
}

let cachedMap: Map<string, EcommerceProductMapEntry> | null = null;
let loadPromise: Promise<Map<string, EcommerceProductMapEntry>> | null = null;

function buildLookup(map: Map<string, EcommerceProductMapEntry>): ProductLookup {
  return (programId: string) => {
    const bySlug = map.get(programId);
    if (bySlug) {
        return {
        product_id: bySlug.product_id,
        name: bySlug.name,
        active: isActivelySelling(bySlug),
        content_type: bySlug.content_type,
      };
    }
    // Also allow lookup by full product_id
    for (const entry of map.values()) {
      if (entry.product_id === programId) {
        return {
          product_id: entry.product_id,
          name: entry.name,
          active: isActivelySelling(entry),
          content_type: entry.content_type,
        };
      }
    }
    return undefined;
  };
}

export async function ensureEcommerceProductLookup(): Promise<Map<string, EcommerceProductMapEntry>> {
  if (cachedMap) return cachedMap;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const map = new Map<string, EcommerceProductMapEntry>();
    try {
      const res = await fetch("/api/ecommerce/product-map");
      if (res.ok) {
        const data = await res.json();
        const entries = (data.products ?? data.map ?? []) as EcommerceProductMapEntry[];
        for (const e of entries) {
          if (e?.content_slug) map.set(e.content_slug, e);
        }
        const tracking = data.tracking as Partial<TrackingKeysState> | undefined;
        if (tracking && Array.isArray(tracking.keys?.products)) {
          trackingState = { ready: tracking.ready === true, keys: tracking.keys };
        }
      }
    } catch {
      // non-fatal
    }
    cachedMap = map;
    if (!trackingState) trackingState = EMPTY_TRACKING;
    setEcommerceProductLookup(buildLookup(map));
    return map;
  })();

  return loadPromise;
}

export function getCachedProductBySlug(slug: string): EcommerceProductMapEntry | undefined {
  return cachedMap?.get(slug);
}

/** Tracking keys for the current site (loads the product map once). */
export async function ensureTrackingKeys(): Promise<TrackingKeysState> {
  await ensureEcommerceProductLookup();
  return trackingState ?? EMPTY_TRACKING;
}

export function getCachedTrackingKeys(): TrackingKeysState | null {
  return trackingState;
}
