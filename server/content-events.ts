/**
 * Content event emitters (re-exports + binding propagation).
 */

export {
  emitEntryEventsFromFileChange,
  emitEntrySeoChanged,
  emitEntryDeleted,
  emitSiteBulkSynced,
  emitEntryLocalePromoted,
  emitEntryLocaleUnpublished,
} from "./events/emit-entry-events";

import { emitEvent } from "./events/event-store";
import type { EventActor } from "./events/types";
import { singleAttribution } from "./events/types";

export function emitBindingPropagationStarted(opts: {
  site: string;
  groupId: string;
  locale: string;
  sourceContentType: string;
  sourceSlug: string;
  sectionIndex: number;
  holder: string;
  token: number;
  author?: string;
  actor?: EventActor;
  agent_session_id?: string;
}): import("./events/event-store").EmitResult {
  return emitEvent({
    site: opts.site,
    type: "binding_propagation_started",
    resource: { groupId: opts.groupId, locale: opts.locale },
    attribution: singleAttribution(opts.author, opts.actor),
    agent_session_id: opts.agent_session_id,
    payload: {
      groupId: opts.groupId,
      locale: opts.locale,
      sourceContentType: opts.sourceContentType,
      sourceSlug: opts.sourceSlug,
      sectionIndex: opts.sectionIndex,
      holder: opts.holder,
      token: opts.token,
    },
  });
}
