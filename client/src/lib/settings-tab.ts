export const GENERAL_SETTINGS_TABS = ["locales", "migrations", "brand", "robots", "legal", "server"] as const;
export type GeneralSettingsTab = (typeof GENERAL_SETTINGS_TABS)[number];

export type SettingsSectionId = "general" | "seo" | "ads" | "ab-testing" | "ai" | "tracking" | "security";

function trimTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function generalSettingsHref(tab: GeneralSettingsTab): string {
  return `/private/settings/${tab}`;
}

/** General Settings tab from `/private/settings/<tab>`; null for the bare path or unknown tabs. */
export function resolveGeneralSettingsTab(pathname: string): GeneralSettingsTab | null {
  const match = /^\/private\/settings\/([^/]+)$/.exec(trimTrailingSlash(pathname));
  if (!match) return null;
  const tab = match[1];
  return (GENERAL_SETTINGS_TABS as readonly string[]).includes(tab) ? (tab as GeneralSettingsTab) : null;
}

export function resolveSettingsSection(pathname: string): SettingsSectionId | null {
  const path = trimTrailingSlash(pathname);
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (under("/private/settings/seo")) return "seo";
  if (under("/private/settings/ads")) return "ads";
  if (under("/private/settings/ab-testing")) return "ab-testing";
  if (under("/private/settings/ai")) return "ai";
  if (under("/private/settings")) return "general";
  if (under("/private/tracking")) return "tracking";
  if (under("/private/security")) return "security";
  return null;
}
