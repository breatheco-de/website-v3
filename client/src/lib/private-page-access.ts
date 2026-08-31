/**
 * Who may see /private staff UI vs the public 404.
 *
 * Capture/embed frames must stay reachable without debug mode (screenshot
 * workers and in-app iframes pass ?debug=false). Everything else requires
 * debug mode or a staff session so anonymous visitors do not learn that
 * the admin URL exists.
 */

export function isPrivateEmbedPath(pathname: string): boolean {
  const path = pathname.split("?")[0].split("#")[0];
  if (path === "/private/entry-preview-frame" || path.startsWith("/private/entry-preview-frame/")) {
    return true;
  }
  if (/^\/private\/demo\/[a-f0-9]{32}\/?$/.test(path)) {
    return true;
  }
  return /^\/private\/component-showcase\/[^/]+\/preview\/?$/.test(path);
}

export type PrivatePageAccess = "allow" | "deny" | "pending";

export type PrivatePageAccessInput = {
  pathname: string;
  isDebugMode: boolean;
  isLoading: boolean;
  isValidated: boolean | null;
  hasToken: boolean;
  hasCachedStaffSession: boolean;
};

export function resolvePrivatePageAccess(input: PrivatePageAccessInput): PrivatePageAccess {
  if (isPrivateEmbedPath(input.pathname)) return "allow";
  if (input.isDebugMode) return "allow";
  if (input.hasToken && input.isValidated) return "allow";
  if (input.isLoading || input.isValidated === null) {
    if (input.hasCachedStaffSession || input.hasToken) return "pending";
    return "deny";
  }
  return "deny";
}
