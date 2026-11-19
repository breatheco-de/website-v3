import type { Session, Location, GeoData, UTMParams, DeviceData, WorkerMessage, WorkerResponse } from '@shared/session';
import { defaultSession, SESSION_VERSION } from '@shared/session';
import {
  channelTouchFor,
  mergeUtmSets,
  nextEntryChannel,
  nextFirstTouch,
  nextPaidLanding,
  paidLandingFor,
  parseMarketingParams,
} from '@shared/session-marketing';
import { normalizeLandingPath } from '@shared/paid-traffic';

const GEO_API_URL = '/api/geo';
const CATALOG_API_URL = '/api/session/location-catalog';

/** In-worker cache so refresh does not re-hit the catalog every time. */
let catalogCache: Location[] = [];
let catalogFetchedAt = 0;
const CATALOG_TTL_MS = 5 * 60 * 1000;

function workerOrigin(): string {
  try {
    return (self as unknown as { location?: { origin?: string } }).location?.origin ?? '';
  } catch {
    return '';
  }
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getBrowserLanguage(navigatorJson: string): string {
  try {
    const nav = JSON.parse(navigatorJson);
    const propertyKeys = ['language', 'browserLanguage', 'systemLanguage', 'userLanguage'];
    
    if (Array.isArray(nav.languages)) {
      for (const lang of nav.languages) {
        if (lang && lang.length >= 2) {
          return lang.substring(0, 2).toLowerCase();
        }
      }
    }
    
    for (const key of propertyKeys) {
      const lang = nav[key];
      if (lang && lang.length >= 2) {
        return lang.substring(0, 2).toLowerCase();
      }
    }
  } catch {
    // Ignore parse errors
  }
  return 'en';
}

function getClosestLocation(lat: number, lon: number, filteredLocations: Location[]): Location | null {
  const listed = filteredLocations.filter(loc => loc.visibility === 'listed' && loc.slug !== 'online');
  
  if (listed.length === 0) return null;
  
  let closest: Location | null = null;
  let minDistance = Infinity;
  
  for (const loc of listed) {
    const dist = haversineDistance(lat, lon, loc.latitude, loc.longitude);
    if (dist < minDistance) {
      minDistance = dist;
      closest = loc;
    }
  }
  
  return closest;
}

function getRegionFromCountry(countryCode: string): Location['region'] | null {
  const latamCountries = [
    'MX', 'GT', 'BZ', 'SV', 'HN', 'NI', 'CR', 'PA',
    'CO', 'VE', 'EC', 'PE', 'BO', 'CL', 'AR', 'UY', 'PY', 'BR',
    'CU', 'DO', 'PR', 'JM', 'HT', 'TT'
  ];
  
  const europeCountries = [
    'ES', 'PT', 'FR', 'DE', 'IT', 'GB', 'IE', 'NL', 'BE', 'AT', 'CH',
    'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'SE', 'NO', 'DK', 'FI'
  ];
  
  if (countryCode === 'US' || countryCode === 'CA') return 'usa-canada';
  if (latamCountries.includes(countryCode)) return 'latam';
  if (europeCountries.includes(countryCode)) return 'europe';
  
  return null;
}

async function fetchGeoData(): Promise<GeoData | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const url = workerOrigin() ? `${workerOrigin()}${GEO_API_URL}` : GEO_API_URL;
    
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeout);
    
    if (!response.ok) return null;
    
    const data = await response.json();
    
    if (data.status !== 'success') return null;
    
    return {
      city: data.city,
      country: data.country,
      country_code: data.countryCode,
      region: data.regionName,
      timezone: data.timezone,
      latitude: data.lat,
      longitude: data.lon,
    };
  } catch {
    return null;
  }
}

async function fetchLocationCatalog(force = false): Promise<Location[]> {
  const now = Date.now();
  if (!force && catalogCache.length > 0 && now - catalogFetchedAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const url = workerOrigin() ? `${workerOrigin()}${CATALOG_API_URL}` : CATALOG_API_URL;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);
    if (!response.ok) return catalogCache;
    const data = (await response.json()) as { locations?: Location[] };
    catalogCache = Array.isArray(data.locations) ? data.locations : [];
    catalogFetchedAt = now;
    return catalogCache;
  } catch {
    return catalogCache;
  }
}

function findLocationForUser(
  geo: GeoData | null,
  browserLang: string,
  locations: Location[],
): Location | null {
  const listedLocations = locations.filter(loc => loc.visibility === 'listed');
  if (listedLocations.length === 0) return null;
  
  if (geo?.latitude && geo?.longitude && geo?.country_code) {
    const inCountry = listedLocations.filter(
      loc => loc.country_code === geo.country_code && loc.slug !== 'online'
    );
    
    if (inCountry.length > 0) {
      const inCity = inCountry.find(loc => 
        loc.city.toLowerCase() === geo.city?.toLowerCase()
      );
      if (inCity) {
        return { ...inCity, reliable: true };
      }
      
      const closest = getClosestLocation(geo.latitude, geo.longitude, inCountry);
      if (closest) {
        return { ...closest, reliable: true };
      }
    }
    
    const region = getRegionFromCountry(geo.country_code);
    if (region && region !== 'online') {
      const inRegion = listedLocations.filter(
        loc => loc.region === region && loc.slug !== 'online'
      );
      if (inRegion.length > 0) {
        const closest = getClosestLocation(geo.latitude, geo.longitude, inRegion);
        if (closest) {
          return { ...closest, reliable: true };
        }
      }
    }
    
    const closest = getClosestLocation(
      geo.latitude, 
      geo.longitude, 
      listedLocations.filter(loc => loc.slug !== 'online')
    );
    if (closest) {
      return { ...closest, reliable: true };
    }
  }
  
  const langLocations = listedLocations.filter(
    loc => loc.default_language === (browserLang === 'es' ? 'es' : 'en') && loc.slug !== 'online'
  );
  
  if (langLocations.length > 0) {
    return { ...langLocations[0], reliable: false };
  }
  
  const first = listedLocations.find(loc => loc.slug !== 'online') || listedLocations[0];
  return first ? { ...first, reliable: false } : null;
}

function determineLanguage(
  browserLang: string,
  location: Location | null,
  path: string
): 'en' | 'es' {
  const pathLang = path.split('/').filter(Boolean)[0];
  if (pathLang === 'es') return 'es';
  if (pathLang === 'en') return 'en';
  
  if (browserLang === 'es') return 'es';
  
  if (location?.default_language === 'es') return 'es';
  
  return 'en';
}

function parseDeviceInfo(deviceJson: string): DeviceData | undefined {
  try {
    const raw = JSON.parse(deviceJson);
    if (!raw.userAgent) return undefined;
    
    const ua = raw.userAgent.toLowerCase();
    
    let osFamily = 'Unknown';
    if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) osFamily = 'iOS';
    else if (ua.includes('android')) osFamily = 'Android';
    else if (ua.includes('windows phone')) osFamily = 'Windows Phone';
    else if (ua.includes('windows')) osFamily = 'Windows';
    else if (ua.includes('mac os') || ua.includes('macos')) osFamily = 'macOS';
    else if (ua.includes('chrome os') || ua.includes('cros')) osFamily = 'ChromeOS';
    else if (ua.includes('linux')) osFamily = 'Linux';
    
    let browserFamily = 'Unknown';
    if (ua.includes('edg/') || ua.includes('edge/')) browserFamily = 'Edge';
    else if (ua.includes('opr/') || ua.includes('opera')) browserFamily = 'Opera';
    else if (ua.includes('chrome')) browserFamily = 'Chrome';
    else if (ua.includes('safari') && !ua.includes('chrome')) browserFamily = 'Safari';
    else if (ua.includes('firefox')) browserFamily = 'Firefox';
    
    let deviceCategory: DeviceData['deviceCategory'] = 'desktop';
    
    const isTablet = ua.includes('ipad') || 
      (ua.includes('android') && !ua.includes('mobile')) ||
      ua.includes('tablet');
    
    const isMobile = !isTablet && (
      ua.includes('iphone') ||
      ua.includes('ipod') ||
      (ua.includes('android') && ua.includes('mobile')) ||
      ua.includes('windows phone') ||
      ua.includes('blackberry') ||
      ua.includes('opera mini') ||
      ua.includes('opera mobi')
    );
    
    if (isTablet) deviceCategory = 'tablet';
    else if (isMobile) deviceCategory = 'mobile';
    
    const orientation: DeviceData['orientation'] = 
      (raw.viewportWidth > raw.viewportHeight) ? 'landscape' : 'portrait';
    
    return {
      deviceCategory,
      osFamily,
      browserFamily,
      viewportWidth: raw.viewportWidth || 0,
      viewportHeight: raw.viewportHeight || 0,
      screenWidth: raw.screenWidth || 0,
      screenHeight: raw.screenHeight || 0,
      devicePixelRatio: raw.devicePixelRatio || 1,
      orientation,
    };
  } catch {
    return undefined;
  }
}

async function initSession(message: WorkerMessage['payload']): Promise<Session> {
  const { cachedSession, path, search, navigator, device, existingUserId } = message;
  
  const browserLang = getBrowserLanguage(navigator);
  const now = Date.now();
  const ownHosts = message.ownHosts ?? (message.host ? [message.host] : []);
  const newUtm = parseMarketingParams(search, { fbp: message.fbp, fbc: message.fbc, now, ownHosts });
  const mergedUtm: UTMParams = mergeUtmSets(cachedSession?.utm, newUtm);
  const first_touch = nextFirstTouch(cachedSession?.first_touch, newUtm);
  const paid_landing = nextPaidLanding(
    cachedSession?.paid_landing,
    paidLandingFor(newUtm, { host: message.host || '', path, now }),
  );
  let entry_channel = cachedSession?.entry_channel;
  if (message.referrer !== undefined) {
    const touch = channelTouchFor(newUtm, { referrer: message.referrer, ownHosts, path, now });
    entry_channel = nextEntryChannel(
      entry_channel,
      touch ?? (entry_channel ? null : { channel: 'direct', path: normalizeLandingPath(path), at: now }),
    );
  }
  
  let geo: GeoData | null = cachedSession?.geo || null;
  let location: Location | null = cachedSession?.location || null;
  
  const sessionAge = cachedSession?.timestamp 
    ? Date.now() - cachedSession.timestamp 
    : Infinity;
  const isStale = sessionAge > 24 * 60 * 60 * 1000;
  
  const needGeo = !geo || isStale;
  // Catalog always fetched in parallel with geo (or alone when geo is fresh).
  const [freshGeo, catalog] = await Promise.all([
    needGeo ? fetchGeoData() : Promise.resolve(geo),
    fetchLocationCatalog(),
  ]);
  if (needGeo) geo = freshGeo;

  const cachedSlugStillValid =
    !!location?.slug && catalog.some((loc) => loc.slug === location!.slug);

  if (!location || isStale || !location.reliable || !cachedSlugStillValid) {
    location = findLocationForUser(geo, browserLang, catalog);
  }
  
  const searchParams = new URLSearchParams(search);
  const locationOverride = searchParams.get('location');
  if (locationOverride) {
    const overrideLocation = catalog.find(loc => loc.slug === locationOverride);
    if (overrideLocation) {
      location = { ...overrideLocation, reliable: true };
    }
  }
  
  const language = determineLanguage(browserLang, location, path);
  
  const deviceData = parseDeviceInfo(device);
  
  const userId = cachedSession?.userId || existingUserId || crypto.randomUUID();

  const pathnameOnly = path.split('?')[0] || path;
  const landing_page = cachedSession?.landing_page || pathnameOnly;
  const conversion_page = cachedSession?.conversion_page;

  const session: Session = {
    version: SESSION_VERSION,
    initialized: true,
    userId,
    location,
    language,
    browserLang,
    geo,
    utm: mergedUtm,
    device: deviceData,
    landing_page,
    conversion_page,
    first_touch,
    paid_landing,
    entry_channel,
    consent: cachedSession?.consent || { geolocation: null },
    timestamp: now,
  };
  
  return session;
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  if (event.data.type === 'INIT_SESSION') {
    const session = await initSession(event.data.payload);
    
    const response: WorkerResponse = {
      type: 'SESSION_READY',
      payload: session,
    };
    
    self.postMessage(response);
  }
};
