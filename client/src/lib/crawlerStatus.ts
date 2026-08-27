/**
 * Staff UI crawler badges — re-exports shared mappers.
 * CrawlerId stays "google" until Bing Webmaster cache lands (phase 2).
 */
export {
  googleToCrawlerStatus,
  crawlerProblemCount,
  allApplicableCrawlersIndexed,
  crawlerBadgeState,
  type CrawlerId,
  type CrawlerIndexStatus,
  type CrawlerPageStatus,
  type CrawlerBadgeKind,
  type CrawlerBadgeState,
} from "@shared/search-engine-status";
