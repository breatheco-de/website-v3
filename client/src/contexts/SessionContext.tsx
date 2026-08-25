import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import type { Session, Location, UTMParams, WorkerMessage, WorkerResponse } from '@shared/session';
import { defaultSession } from '@shared/session';
import { 
  getCachedSession, 
  saveSession, 
  getNavigatorInfo,
  getDeviceInfo,
  setUserIdCookie,
  getUserIdFromCookie,
} from '../lib/sessionBootstrap';
import { locations, getLocationBySlug } from '../lib/locations';
import { setSessionHeaders } from '../lib/sessionHeaders';
import { setVisitorContext } from '../lib/tracking';
import { clearOverlayGeoCache } from '@/hooks/useOverlays';

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

interface SessionContextValue {
  session: Session;
  isLoading: boolean;
  isInitialized: boolean;
  setLocation: (slug: string) => void;
  setLanguage: (lang: 'en' | 'es') => void;
  updateUTM: (utm: Partial<UTMParams>) => void;
  /** Record the pathname of a successful conversion (overwrites prior). */
  setConversionPage: (path: string) => void;
  /**
   * Drop client geo caches (session cookie geo + overlay sessionStorage) and
   * re-fetch `/api/geo` via the session worker. Does not clear server IP cache.
   */
  refreshGeo: () => Promise<void>;
  nearestLocations: Location[];
  getLocationsByRegion: (region: Location['region']) => Location[];
}

const SessionContext = createContext<SessionContextValue | null>(null);

interface SessionProviderProps {
  children: React.ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [session, setSession] = useState<Session>(() => {
    const cached = getCachedSession();
    return cached || defaultSession;
  });
  const [isLoading, setIsLoading] = useState(true);
  const workerRef = useRef<Worker | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const initWorker = async () => {
      try {
        workerRef.current = new Worker(
          new URL('../workers/session.worker.ts', import.meta.url),
          { type: 'module' }
        );

        workerRef.current.onmessage = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.type === 'SESSION_READY') {
            const newSession = event.data.payload;
            setSession(newSession);
            saveSession(newSession);
            if (newSession.userId) {
              setUserIdCookie(newSession.userId);
            }
            setVisitorContext({
              user_id: newSession.userId,
              location_city: newSession.location?.name,
              location_country: newSession.location?.country,
              location_slug: newSession.location?.slug,
              language: newSession.language,
              latitude: newSession.geo?.latitude,
              longitude: newSession.geo?.longitude,
              utm: newSession.utm,
            });
            setIsLoading(false);
          }
        };

        workerRef.current.onerror = (error) => {
          console.error('Session worker error:', error);
          setIsLoading(false);
        };

        const message: WorkerMessage = {
          type: 'INIT_SESSION',
          payload: {
            cachedSession: getCachedSession(),
            path: window.location.pathname,
            search: window.location.search,
            navigator: getNavigatorInfo(),
            device: getDeviceInfo(),
            existingUserId: getUserIdFromCookie() ?? undefined,
          },
        };

        workerRef.current.postMessage(message);
      } catch (error) {
        console.error('Failed to initialize session worker:', error);
        setIsLoading(false);
      }
    };

    initWorker();

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const setLocation = (slug: string) => {
    const location = getLocationBySlug(slug);
    if (location) {
      setSession(prev => {
        const updated = { 
          ...prev, 
          location: { ...location, reliable: true },
          timestamp: Date.now()
        };
        saveSession(updated);
        return updated;
      });
    }
  };

  const setLanguage = (lang: 'en' | 'es') => {
    setSession(prev => {
      const updated = { ...prev, language: lang, timestamp: Date.now() };
      saveSession(updated);
      return updated;
    });
  };

  const updateUTM = (utm: Partial<UTMParams>) => {
    setSession(prev => {
      const updated = { 
        ...prev, 
        utm: { ...prev.utm, ...utm },
        timestamp: Date.now()
      };
      saveSession(updated);
      return updated;
    });
  };

  const setConversionPage = (path: string) => {
    const pathname = path.split('?')[0] || path;
    setSession(prev => {
      const updated = {
        ...prev,
        conversion_page: pathname,
        timestamp: Date.now(),
      };
      saveSession(updated);
      return updated;
    });
  };

  const refreshGeo = useCallback(async () => {
    clearOverlayGeoCache();

    const worker = workerRef.current;
    if (!worker) {
      throw new Error('Session worker is not ready');
    }

    setIsLoading(true);

    const cached = getCachedSession();
    // Strip geo + campus so the worker re-fetches and re-derives location.
    const stripped: Session | null = cached
      ? {
          ...cached,
          geo: null,
          location: null,
          timestamp: 0,
        }
      : null;

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        setIsLoading(false);
        reject(new Error('Geo refresh timed out'));
      }, 10_000);

      const cleanup = () => {
        window.clearTimeout(timeout);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };

      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type !== 'SESSION_READY') return;
        cleanup();
        const newSession = event.data.payload;
        setSession(newSession);
        saveSession(newSession);
        if (newSession.userId) {
          setUserIdCookie(newSession.userId);
        }
        setVisitorContext({
          user_id: newSession.userId,
          location_city: newSession.location?.name,
          location_country: newSession.location?.country,
          location_slug: newSession.location?.slug,
          language: newSession.language,
          latitude: newSession.geo?.latitude,
          longitude: newSession.geo?.longitude,
          utm: newSession.utm,
        });
        setIsLoading(false);
        resolve();
      };
      const onError = (error: ErrorEvent) => {
        cleanup();
        setIsLoading(false);
        reject(error.error ?? new Error(error.message || 'Geo refresh failed'));
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);

      const message: WorkerMessage = {
        type: 'INIT_SESSION',
        payload: {
          cachedSession: stripped,
          path: window.location.pathname,
          search: window.location.search,
          navigator: getNavigatorInfo(),
          device: getDeviceInfo(),
          existingUserId: getUserIdFromCookie() ?? undefined,
        },
      };
      worker.postMessage(message);
    });
  }, []);

  const nearestLocations = locations
    .filter(loc => loc.visibility === 'listed' && loc.slug !== 'online')
    .sort((a, b) => {
      if (!session.geo?.latitude || !session.geo?.longitude) return 0;
      
      const distA = haversineDistance(
        session.geo.latitude, 
        session.geo.longitude, 
        a.latitude, 
        a.longitude
      );
      const distB = haversineDistance(
        session.geo.latitude, 
        session.geo.longitude, 
        b.latitude, 
        b.longitude
      );
      return distA - distB;
    });

  const getLocationsByRegion = (region: Location['region']) => {
    return locations.filter(loc => loc.region === region && loc.visibility === 'listed');
  };

  useEffect(() => {
    setSessionHeaders(
      session.location?.slug,
      session.location?.region,
      session.language,
      session.userId
    );
  }, [session.location?.slug, session.location?.region, session.language, session.userId]);

  const value: SessionContextValue = {
    session,
    isLoading,
    isInitialized: session.initialized,
    setLocation,
    setLanguage,
    updateUTM,
    setConversionPage,
    refreshGeo,
    nearestLocations,
    getLocationsByRegion,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}

export function useLocation(): Location | null {
  const { session } = useSession();
  return session.location;
}

export function useLanguage(): 'en' | 'es' {
  const { session } = useSession();
  return session.language;
}

export function useUTM(): UTMParams {
  const { session } = useSession();
  return session.utm;
}

export function useRegion(): Location['region'] | null {
  const { session } = useSession();
  return session.location?.region || null;
}
