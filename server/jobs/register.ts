import { registerJobClass } from "./queue";
import { IndexRefreshJob } from "./definitions/index-refresh";
import { OnSaveValidationJob } from "./definitions/on-save-validation";
import { SyncStateFlushJob } from "./definitions/sync-state-flush";
import { BindingPropagationJob } from "./definitions/binding-propagation";

export function registerAllJobs(): void {
  registerJobClass("index_refresh", IndexRefreshJob);
  registerJobClass("on_save_validation", OnSaveValidationJob);
  registerJobClass("sync_state_flush", SyncStateFlushJob);
  registerJobClass("binding_propagation", BindingPropagationJob);
}
