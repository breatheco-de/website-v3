import { registerJobClass } from "./queue";
import { IndexRefreshJob } from "./definitions/index-refresh";
import { OnSaveValidationJob } from "./definitions/on-save-validation";
import { EntryDeleteCleanupJob } from "./definitions/entry-delete-cleanup";
import { SyncStateFlushJob } from "./definitions/sync-state-flush";
import { BindingPropagationJob } from "./definitions/binding-propagation";
import { AiImageGcJob } from "./definitions/ai-image-gc";

export function registerAllJobs(): void {
  registerJobClass("index_refresh", IndexRefreshJob);
  registerJobClass("on_save_validation", OnSaveValidationJob);
  registerJobClass("entry_delete_cleanup", EntryDeleteCleanupJob);
  registerJobClass("sync_state_flush", SyncStateFlushJob);
  registerJobClass("binding_propagation", BindingPropagationJob);
  registerJobClass("ai_image_gc", AiImageGcJob);
}
