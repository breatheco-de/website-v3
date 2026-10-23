import { bucketUserAgent } from "./runtime-issues";

/** Header the A/B check sends so its requests are served like visitors but never counted. */
export const AB_CHECK_HEADER = "x-ab-check";

const GENERIC_BOT_UA_RE =
  /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|curl\/|wget\/|python-|python\/|node-fetch|axios\/|go-http-client|java\/|okhttp|httpclient|libwww|monitor|uptime|pingdom|statuscake|phantomjs|puppeteer|playwright/i;

/**
 * True when this user agent must never be put in a page test: missing UA, search and AI
 * crawlers, social previews, scrapers, uptime monitors, headless browsers and HTTP libraries.
 * Excluded agents always see the live page and are not counted.
 */
export function isExperimentExcludedUa(ua: string | undefined | null): boolean {
  const agent = ua?.trim() ?? "";
  if (!agent) return true;
  const bucket = bucketUserAgent(agent);
  if (
    bucket === "search_crawler" ||
    bucket === "llm_crawler" ||
    bucket === "social_preview" ||
    bucket === "scraper" ||
    bucket === "likely_bot" ||
    bucket === "bot"
  ) {
    return true;
  }
  return GENERIC_BOT_UA_RE.test(agent);
}
