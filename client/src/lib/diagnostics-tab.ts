export type DiagnosticsTabId =
  | "global-health"
  | "leads"
  | "runtime-issues"
  | "seo"
  | "geo"
  | "funnel";

export function resolveDiagnosticsTab(pathname: string): DiagnosticsTabId {
  if (pathname.endsWith("/leads")) return "leads";
  if (pathname.endsWith("/runtime-issues")) return "runtime-issues";
  if (pathname.includes("/diagnostics/seo")) return "seo";
  if (pathname.endsWith("/geo")) return "geo";
  if (pathname.endsWith("/funnel")) return "funnel";
  if (pathname.endsWith("/global-health")) return "global-health";
  return "global-health";
}

export function isDiagnosticsSeoOrganic(pathname: string): boolean {
  return pathname.includes("/diagnostics/seo/organic");
}
