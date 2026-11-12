/**
 * Staff choice "Don't show again this session" for the edit-mode hidden fields
 * panel. Session-scoped (sessionStorage); every open LeadForm reacts at once.
 */
import { useSyncExternalStore } from "react";

const HIDDEN_FIELDS_NOTICE_OFF_KEY = "4geeks_lead_form_hidden_fields_notice_off";

const listeners = new Set<() => void>();

export function isHiddenFieldsNoticeOffThisSession(): boolean {
  try {
    return sessionStorage.getItem(HIDDEN_FIELDS_NOTICE_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

export function hideHiddenFieldsNoticeThisSession(): void {
  try {
    sessionStorage.setItem(HIDDEN_FIELDS_NOTICE_OFF_KEY, "1");
  } catch {
    /* storage blocked: the panel keeps showing */
  }
  for (const listener of Array.from(listeners)) listener();
}

export function subscribeHiddenFieldsNoticeOff(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHiddenFieldsNoticeOff(): boolean {
  return useSyncExternalStore(
    subscribeHiddenFieldsNoticeOff,
    isHiddenFieldsNoticeOffThisSession,
    () => false,
  );
}
