import { useState, useEffect, createContext, useContext, createElement, type ReactNode } from "react";
import { setAuthToken } from "@/lib/sessionHeaders";
import { VIEW_ONLY_CAPABILITIES, SCOPED_CAPABILITIES, type CapabilityName } from "@shared/capabilities";

const DEBUG_SESSION_KEY = "debug_validated";
const DEBUG_SESSION_EXPIRY_KEY = "debug_validated_expiry";
const DEBUG_TOKEN_KEY = "debug_token";
/** localStorage: explicit debug UI opt-in (set by ?debug=true). Cleared by dismiss. */
const DEBUG_MODE_KEY = "debug_mode";
/** localStorage: staff hid DebugBubble without logging out. Cleared by ?debug=true or logout. */
const DEBUG_UI_DISMISSED_KEY = "debug_ui_dismissed";
const DEBUG_CAPABILITIES_KEY = "debug_capabilities";
const DEBUG_ROLES_KEY = "debug_roles";
const DEBUG_USERNAME_KEY = "debug_username";
const DEBUG_STAFF_ID_KEY = "debug_staff_id";

export interface CapabilityGrant {
  name: string;
  contentTypes?: string[] | "*";
}

const DEFAULT_CAPABILITIES: CapabilityGrant[] = [];

/** Pure precedence for tests and isDebugModeActive side-effect wrapper. */
export function resolveDebugModeActive(input: {
  debugParam: string | null;
  isDismissed: boolean;
  isDev: boolean;
  hasDebugModeFlag: boolean;
  hasNonExpiredStaffToken: boolean;
}): boolean {
  if (input.debugParam === "false") return false;
  if (input.isDismissed && input.debugParam !== "true") return false;
  if (input.debugParam === "true") return true;
  if (input.isDev) return true;
  if (input.hasDebugModeFlag) return true;
  if (input.hasNonExpiredStaffToken) return true;
  return false;
}

function hasNonExpiredStaffToken(): boolean {
  if (typeof window === "undefined") return false;
  const cachedToken = localStorage.getItem(DEBUG_TOKEN_KEY);
  const cachedExpiry = localStorage.getItem(DEBUG_SESSION_EXPIRY_KEY);
  if (!cachedToken || !cachedExpiry) return false;
  const expiryTime = parseInt(cachedExpiry, 10);
  return Number.isFinite(expiryTime) && Date.now() < expiryTime;
}

function isDebugUiDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEBUG_UI_DISMISSED_KEY) === "true";
}

function setDebugUiDismissed(dismissed: boolean): void {
  if (typeof window === "undefined") return;
  if (dismissed) {
    localStorage.setItem(DEBUG_UI_DISMISSED_KEY, "true");
  } else {
    localStorage.removeItem(DEBUG_UI_DISMISSED_KEY);
  }
}

/**
 * Sync gate for DebugBubble / staff UI.
 * Precedence: ?debug=false → dismiss → ?debug=true → DEV → debug_mode flag → staff token.
 */
export function isDebugModeActive(): boolean {
  if (typeof window === "undefined") return false;
  const urlParams = new URLSearchParams(window.location.search);
  const debugParam = urlParams.get("debug");

  if (debugParam === "true") {
    setDebugUiDismissed(false);
    localStorage.setItem(DEBUG_MODE_KEY, "true");
    const url = new URL(window.location.href);
    url.searchParams.delete("debug");
    window.history.replaceState({}, "", url.toString());
  }

  return resolveDebugModeActive({
    debugParam,
    isDismissed: isDebugUiDismissed(),
    isDev: import.meta.env.DEV,
    hasDebugModeFlag: localStorage.getItem(DEBUG_MODE_KEY) === "true",
    hasNonExpiredStaffToken: hasNonExpiredStaffToken(),
  });
}

export function getDebugToken(): string | null {
  if (typeof window === 'undefined') return null;
  const cachedToken = localStorage.getItem(DEBUG_TOKEN_KEY);
  const cachedExpiry = localStorage.getItem(DEBUG_SESSION_EXPIRY_KEY);
  
  if (cachedToken && cachedExpiry) {
    const expiryTime = parseInt(cachedExpiry, 10);
    if (Date.now() < expiryTime) {
      return cachedToken;
    }
  }
  
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get("token");
  const envToken = import.meta.env.VITE_BREATHECODE_TOKEN;
  
  return urlToken || envToken || null;
}

export function getCachedCapabilities(): CapabilityGrant[] {
  if (typeof window === 'undefined') return DEFAULT_CAPABILITIES;
  try {
    const cached = localStorage.getItem(DEBUG_CAPABILITIES_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) return parsed as CapabilityGrant[];
      if (typeof parsed === 'object' && parsed !== null) {
        return Object.entries(parsed)
          .filter(([, v]) => v === true)
          .map(([k]) => ({ name: k } as CapabilityGrant));
      }
    }
  } catch {
  }
  return DEFAULT_CAPABILITIES;
}

export function getCachedRoles(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const cached = localStorage.getItem(DEBUG_ROLES_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) return parsed.filter((r): r is string => typeof r === "string");
    }
  } catch {
  }
  return [];
}

function rolesFromResponse(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is string => typeof r === "string");
}

function cacheRoles(roles: string[]) {
  localStorage.setItem(DEBUG_ROLES_KEY, JSON.stringify(roles));
}

function clearRolesCache() {
  localStorage.removeItem(DEBUG_ROLES_KEY);
}

export function getDebugUserName(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(DEBUG_USERNAME_KEY) || "";
}

/** Immutable staff id used in `_label.requester` / `owner`. */
export function getDebugStaffId(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(DEBUG_STAFF_ID_KEY) || "";
}

export async function resolveAuthorName(): Promise<string> {
  const cached = localStorage.getItem(DEBUG_USERNAME_KEY);
  if (cached) return cached;

  const token = getDebugToken();
  if (!token) return "Unknown";

  try {
    const response = await fetch("/api/debug/validate-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();
    if (data.valid && data.userName) {
      localStorage.setItem(DEBUG_USERNAME_KEY, data.userName);
      if (typeof data.staffId === "string" && data.staffId) {
        localStorage.setItem(DEBUG_STAFF_ID_KEY, data.staffId);
      }
      return data.userName;
    }
  } catch {
  }
  return "Unknown";
}

/** Resolve current staff id for label writes (preferred over username). */
export async function resolveStaffId(): Promise<string | null> {
  const cached = getDebugStaffId();
  if (cached) return cached;

  const token = getDebugToken();
  if (!token) return null;

  try {
    const response = await fetch("/api/debug/validate-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();
    if (data.valid && typeof data.staffId === "string" && data.staffId) {
      localStorage.setItem(DEBUG_STAFF_ID_KEY, data.staffId);
      if (data.userName) localStorage.setItem(DEBUG_USERNAME_KEY, data.userName);
      return data.staffId;
    }
  } catch {
  }
  return null;
}

interface DebugAuthValue {
  isValidated: boolean | null;
  hasToken: boolean;
  isLoading: boolean;
  isDevelopment: boolean;
  isDebugMode: boolean;
  capabilities: CapabilityGrant[];
  roles: string[];
  hasCapability: (capability: string, contentType?: string) => boolean;
  /** True if user can run metrics jobs / change tracking (not metrics_view-only). */
  canMutateMetrics: boolean;
  canEdit: boolean;
  retryValidation: () => Promise<void>;
  validateManualToken: (manualToken: string) => Promise<void>;
  clearToken: () => void;
  /** Hide DebugBubble without clearing staff session. Restore with ?debug=true. */
  dismissDebugUi: () => void;
  checkSession: () => Promise<{ valid: boolean; expired?: boolean; networkError?: boolean }>;
}

const DebugAuthContext = createContext<DebugAuthValue | null>(null);

function capabilityGrantsFromResponse(raw: unknown): CapabilityGrant[] {
  if (Array.isArray(raw)) {
    return raw as CapabilityGrant[];
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, boolean>)
      .filter(([, v]) => v === true)
      .map(([k]) => ({ name: k } as CapabilityGrant));
  }
  return [];
}

function cacheStaffIdentity(data: { userName?: string; staffId?: string }) {
  if (data.userName) localStorage.setItem(DEBUG_USERNAME_KEY, data.userName);
  if (typeof data.staffId === "string" && data.staffId) {
    localStorage.setItem(DEBUG_STAFF_ID_KEY, data.staffId);
  }
}

function clearStaffIdentity() {
  localStorage.removeItem(DEBUG_USERNAME_KEY);
  localStorage.removeItem(DEBUG_STAFF_ID_KEY);
}

function grantHasCapability(
  capabilities: CapabilityGrant[],
  capabilityName: string,
  contentType?: string
): boolean {
  const grant = capabilities.find((g) => g.name === capabilityName);
  if (!grant) return false;
  const isScoped = (SCOPED_CAPABILITIES as readonly string[]).includes(capabilityName);
  if (isScoped) {
    // Match server grantAllowsCap: missing contentType only allows "*" grants.
    if (!contentType) return grant.contentTypes === "*";
    if (grant.contentTypes === "*") return true;
    if (Array.isArray(grant.contentTypes)) return grant.contentTypes.includes(contentType);
    return false;
  }
  return true;
}

export function DebugAuthProvider({ children }: { children: ReactNode }) {
  const [isValidated, setIsValidated] = useState<boolean | null>(null);
  const [hasToken, setHasToken] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);
  const [capabilities, setCapabilities] = useState<CapabilityGrant[]>(DEFAULT_CAPABILITIES);
  const [roles, setRoles] = useState<string[]>([]);
  const [isDebugMode, setIsDebugMode] = useState(() => isDebugModeActive());
  
  const isDevelopment = import.meta.env.DEV;

  const refreshDebugMode = () => {
    setIsDebugMode(isDebugModeActive());
  };

  const validateToken = async (skipCache = false) => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get("token");
    
    const forceValidate = !!urlToken || skipCache;
    
    let revalidateWithCachedToken = false;

    if (!forceValidate) {
      const cachedValidation = localStorage.getItem(DEBUG_SESSION_KEY);
      const cachedExpiry = localStorage.getItem(DEBUG_SESSION_EXPIRY_KEY);
      const cachedToken = localStorage.getItem(DEBUG_TOKEN_KEY);
      const cachedCaps = localStorage.getItem(DEBUG_CAPABILITIES_KEY);
      const cachedUsername = localStorage.getItem(DEBUG_USERNAME_KEY);
      
      if (cachedValidation === "true" && cachedExpiry && cachedToken) {
        const expiryTime = parseInt(cachedExpiry, 10);
        if (Date.now() < expiryTime) {
          if (cachedUsername) {
            const cachedRoles = getCachedRoles();
            let cachedCapCount = 0;
            if (cachedCaps) {
              try {
                cachedCapCount = capabilityGrantsFromResponse(JSON.parse(cachedCaps)).length;
              } catch {
              }
            }
            // Roles were added later — refresh if missing, or if caps exist without roles (stale desync).
            if (
              localStorage.getItem(DEBUG_ROLES_KEY) === null ||
              (cachedRoles.length === 0 && cachedCapCount > 0)
            ) {
              revalidateWithCachedToken = true;
            } else {
              setAuthToken(cachedToken);
              setHasToken(true);
              setIsValidated(true);
              if (cachedCaps) {
                try {
                  setCapabilities(capabilityGrantsFromResponse(JSON.parse(cachedCaps)));
                } catch {
                }
              }
              setRoles(cachedRoles);
              setIsLoading(false);
              refreshDebugMode();
              return;
            }
          } else {
            revalidateWithCachedToken = true;
          }
        }
      }
    } else {
      localStorage.removeItem(DEBUG_SESSION_KEY);
      localStorage.removeItem(DEBUG_SESSION_EXPIRY_KEY);
      localStorage.removeItem(DEBUG_TOKEN_KEY);
      localStorage.removeItem(DEBUG_CAPABILITIES_KEY);
      clearRolesCache();
    }

    const envToken = import.meta.env.VITE_BREATHECODE_TOKEN;
    
    const token = urlToken || envToken || (revalidateWithCachedToken ? localStorage.getItem(DEBUG_TOKEN_KEY) : null);

    if (!token) {
      setHasToken(false);
      setIsValidated(false);
      setCapabilities(DEFAULT_CAPABILITIES);
      setRoles([]);
      setIsLoading(false);
      refreshDebugMode();
      return;
    }

    setHasToken(true);
    setIsLoading(true);

    try {
      const response = await fetch("/api/debug/validate-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();
      
      if (urlToken) {
        const url = new URL(window.location.href);
        url.searchParams.delete("token");
        window.history.replaceState({}, "", url.toString());
      }

      if (data.valid) {
        localStorage.setItem(DEBUG_SESSION_KEY, "true");
        const expiryTime = data.expiresAt 
          ? new Date(data.expiresAt).getTime() 
          : Date.now() + (24 * 60 * 60 * 1000);
        localStorage.setItem(DEBUG_SESSION_EXPIRY_KEY, String(expiryTime));
        localStorage.setItem(DEBUG_TOKEN_KEY, token);
        setAuthToken(token);
        if (data.capabilities) {
          const grants = capabilityGrantsFromResponse(data.capabilities);
          localStorage.setItem(DEBUG_CAPABILITIES_KEY, JSON.stringify(grants));
          setCapabilities(grants);
        }
        const nextRoles = rolesFromResponse(data.roles);
        cacheRoles(nextRoles);
        setRoles(nextRoles);
        if (data.userName || data.staffId) {
          cacheStaffIdentity(data);
        }
        setIsValidated(true);
        refreshDebugMode();
      } else {
        localStorage.removeItem(DEBUG_SESSION_KEY);
        localStorage.removeItem(DEBUG_SESSION_EXPIRY_KEY);
        localStorage.removeItem(DEBUG_TOKEN_KEY);
        localStorage.removeItem(DEBUG_CAPABILITIES_KEY);
        clearRolesCache();
        clearStaffIdentity();
        setAuthToken(undefined);
        setCapabilities(data.capabilities ? capabilityGrantsFromResponse(data.capabilities) : DEFAULT_CAPABILITIES);
        setRoles([]);
        setIsValidated(false);
        refreshDebugMode();
      }
    } catch (error) {
      console.error("Debug auth validation error:", error);
      setIsValidated(false);
      setCapabilities(DEFAULT_CAPABILITIES);
      setRoles([]);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    validateToken(false);
  }, []);

  const retryValidation = () => {
    return validateToken(true);
  };

  const validateManualToken = async (manualToken: string) => {
    if (!manualToken.trim()) return;
    
    setHasToken(true);
    setIsLoading(true);
    
    localStorage.removeItem(DEBUG_SESSION_KEY);
    localStorage.removeItem(DEBUG_SESSION_EXPIRY_KEY);
    localStorage.removeItem(DEBUG_TOKEN_KEY);
    localStorage.removeItem(DEBUG_CAPABILITIES_KEY);
    clearRolesCache();
    clearStaffIdentity();

    try {
      const response = await fetch("/api/debug/validate-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: manualToken }),
      });

      const data = await response.json();
      
      if (data.valid) {
        localStorage.setItem(DEBUG_SESSION_KEY, "true");
        const expiryTime = data.expiresAt 
          ? new Date(data.expiresAt).getTime() 
          : Date.now() + (24 * 60 * 60 * 1000);
        localStorage.setItem(DEBUG_SESSION_EXPIRY_KEY, String(expiryTime));
        localStorage.setItem(DEBUG_TOKEN_KEY, manualToken);
        setAuthToken(manualToken);
        if (data.capabilities) {
          const grants = capabilityGrantsFromResponse(data.capabilities);
          localStorage.setItem(DEBUG_CAPABILITIES_KEY, JSON.stringify(grants));
          setCapabilities(grants);
        }
        const nextRoles = rolesFromResponse(data.roles);
        cacheRoles(nextRoles);
        setRoles(nextRoles);
        if (data.userName || data.staffId) {
          cacheStaffIdentity(data);
        }
        setIsValidated(true);
        refreshDebugMode();
      } else {
        setAuthToken(undefined);
        setCapabilities(data.capabilities ? capabilityGrantsFromResponse(data.capabilities) : DEFAULT_CAPABILITIES);
        setRoles([]);
        setIsValidated(false);
        refreshDebugMode();
      }
    } catch (error) {
      console.error("Debug auth validation error:", error);
      setIsValidated(false);
      setCapabilities(DEFAULT_CAPABILITIES);
      setRoles([]);
    }

    setIsLoading(false);
  };

  const checkSession = async (): Promise<{ valid: boolean; expired?: boolean; networkError?: boolean }> => {
    const cachedToken = localStorage.getItem(DEBUG_TOKEN_KEY);
    
    if (!cachedToken) {
      return { valid: false };
    }

    try {
      const response = await fetch("/api/debug/check-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: cachedToken }),
      });

      const data = await response.json();
      
      if (data.valid) {
        if (data.expiresAt) {
          const expiryTime = new Date(data.expiresAt).getTime();
          localStorage.setItem(DEBUG_SESSION_EXPIRY_KEY, String(expiryTime));
        }
        return { valid: true };
      } else if (data.networkError) {
        console.warn("Network error checking session:", data.error);
        return { valid: false, networkError: true };
      } else {
        localStorage.removeItem(DEBUG_SESSION_KEY);
        localStorage.removeItem(DEBUG_SESSION_EXPIRY_KEY);
        localStorage.removeItem(DEBUG_TOKEN_KEY);
        localStorage.removeItem(DEBUG_CAPABILITIES_KEY);
        clearRolesCache();
        clearStaffIdentity();
        setHasToken(false);
        setIsValidated(false);
        setCapabilities(DEFAULT_CAPABILITIES);
        setRoles([]);
        refreshDebugMode();
        return { valid: false, expired: data.expired };
      }
    } catch (error) {
      console.error("Session check error:", error);
      return { valid: false, networkError: true };
    }
  };

  const clearToken = () => {
    localStorage.removeItem(DEBUG_SESSION_KEY);
    localStorage.removeItem(DEBUG_SESSION_EXPIRY_KEY);
    localStorage.removeItem(DEBUG_TOKEN_KEY);
    localStorage.removeItem(DEBUG_CAPABILITIES_KEY);
    setDebugUiDismissed(false);
    clearRolesCache();
    clearStaffIdentity();
    setAuthToken(undefined);
    setHasToken(false);
    setIsValidated(false);
    setCapabilities(DEFAULT_CAPABILITIES);
    setRoles([]);
    refreshDebugMode();
  };

  const dismissDebugUi = () => {
    setDebugUiDismissed(true);
    localStorage.removeItem(DEBUG_MODE_KEY);
    setIsDebugMode(false);
  };

  const hasCapability = (capability: string, contentType?: string): boolean => {
    return grantHasCapability(capabilities, capability, contentType);
  };

  const canEdit = grantHasCapability(capabilities, "content_edit_text") ||
                  grantHasCapability(capabilities, "content_edit_structure") ||
                  grantHasCapability(capabilities, "content_edit_media");

  // Aligns with server userStore.canMutateMetrics: view-only caps do not authorize jobs.
  const canMutateMetrics =
    capabilities.length > 0 &&
    capabilities.some((c) => !VIEW_ONLY_CAPABILITIES.has(c.name as CapabilityName));

  const value: DebugAuthValue = {
    isValidated,
    hasToken,
    isLoading,
    isDevelopment,
    isDebugMode,
    capabilities,
    roles,
    hasCapability,
    canMutateMetrics,
    canEdit,
    retryValidation,
    validateManualToken,
    clearToken,
    dismissDebugUi,
    checkSession,
  };

  return createElement(DebugAuthContext.Provider, { value }, children);
}

export function useDebugAuth(): DebugAuthValue {
  const context = useContext(DebugAuthContext);
  if (!context) {
    throw new Error("useDebugAuth must be used within a DebugAuthProvider");
  }
  return context;
}
