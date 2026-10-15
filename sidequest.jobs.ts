/**
 * Sidequest manual job registry (bundled → dist/sidequest.jobs.js).
 * Required in production: esbuild collapses the server into dist/index.js, so
 * stack-based script paths resolve to the base Job module and fail with
 * "Invalid job class". See https://docs.sidequestjs.com/jobs/manual-resolution
 *
 * Every class registered in server/jobs/register.ts must be exported here
 * (enforced by server/jobs/sidequest-jobs-registry.test.ts).
 */
export { IndexRefreshJob } from "./server/jobs/definitions/index-refresh";
export { OnSaveValidationJob } from "./server/jobs/definitions/on-save-validation";
export { SyncStateFlushJob } from "./server/jobs/definitions/sync-state-flush";
export { BindingPropagationJob } from "./server/jobs/definitions/binding-propagation";
export { ClusterHubPathRewriteJob } from "./server/jobs/definitions/cluster-hub-path-rewrite";
export { SeoIndexRefreshJob } from "./server/jobs/definitions/seo-index-refresh";
export { EventWebhookDeliveryJob } from "./server/jobs/definitions/event-webhook-delivery";
export { EntryDeleteCleanupJob } from "./server/jobs/definitions/entry-delete-cleanup";
export { AiImageGcJob } from "./server/jobs/definitions/ai-image-gc";
export { DraftLinkCheckJob, ProposalStaleSweepJob } from "./server/jobs/definitions/proposal-maintenance";
export { MetaAdsSyncJob } from "./server/jobs/definitions/meta-ads-sync";
export { AdsSyncJob } from "./server/jobs/definitions/ads-sync";
export { AdsRecheckJob } from "./server/jobs/definitions/ads-recheck";
export { HtmlPageRebuildJob } from "./server/jobs/definitions/html-page-rebuild";
export { HtmlDbReaderRebuildJob } from "./server/jobs/definitions/html-db-reader-rebuild";
export { HtmlContentTypeListingRebuildJob } from "./server/jobs/definitions/html-content-type-listing-rebuild";
export { LocalDatabaseRefreshJob } from "./server/jobs/definitions/local-database-refresh";
