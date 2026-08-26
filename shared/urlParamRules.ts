/** URL pattern params that must be stored on locale YAML only (never _common.yml). */
export const LOCALE_ONLY_URL_PARAMS = new Set(["category"]);

export function isLocaleOnlyUrlParam(param: string): boolean {
  return LOCALE_ONLY_URL_PARAMS.has(param);
}
