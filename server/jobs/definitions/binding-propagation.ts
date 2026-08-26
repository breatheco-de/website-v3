import path from "path";
import { Job } from "sidequest";
import { bindingManager } from "../../bindings";
import { verifyLeaseToken, renewLease, releaseLease, bindingLeaseResource } from "../../leases";
import { emitEvent, getEventById } from "../../events/event-store";
import { child } from "../../logger";
import { markJobFinished, markJobStarted } from "../heartbeat";

const log = child({ module: "job:binding-propagation" });

export type BindingPropagationPayload = {
  site: string;
  contentRoot: string;
  groupId: string;
  locale: string;
  sourceContentType: string;
  sourceSlug: string;
  sectionIndex: number;
  holder: string;
  token: number;
  startedEventId: number;
  author?: string;
};

export class BindingPropagationJob extends Job {
  async run(payload: BindingPropagationPayload): Promise<{ ok: boolean; updatedFiles: string[] }> {
    markJobStarted("binding_propagation");
    try {
    const resource = bindingLeaseResource(payload.groupId, payload.locale);

    if (!verifyLeaseToken(payload.site, resource, payload.token)) {
      log.warn({ resource }, "[BindingPropagationJob] fenced out — abandoning");
      return { ok: false, updatedFiles: [] };
    }

    renewLease(payload.site, resource, payload.holder, payload.token);

    const result = bindingManager.propagateUpdate(
      payload.sourceContentType,
      payload.sourceSlug,
      payload.sectionIndex,
      undefined as never,
      payload.author,
      payload.locale,
      // markFileAsModified must run in the web process (applier) — Sidequest loads
      // a separate bundle without auto-commit callbacks / file listeners.
      { reReadSource: true, skipMarkModified: true },
    );

    if (!verifyLeaseToken(payload.site, resource, payload.token)) {
      log.warn({ resource }, "[BindingPropagationJob] fenced out after writes");
      return { ok: false, updatedFiles: result.updatedFiles };
    }

    releaseLease(payload.site, resource, payload.holder, payload.token);

    const started = getEventById(payload.site, payload.startedEventId);

    emitEvent({
      site: payload.site,
      type: "binding_propagation_done",
      resource: { groupId: payload.groupId, locale: payload.locale },
      triggeredByEventId: payload.startedEventId,
      attribution: started?.attribution ?? [],
      payload: {
        updatedFiles: result.updatedFiles,
        updatedPaths: result.updatedPaths,
        errors: result.errors,
        groupId: payload.groupId,
        locale: payload.locale,
        author: payload.author,
      },
    });

    return { ok: true, updatedFiles: result.updatedFiles };
    } finally {
      markJobFinished("binding_propagation");
    }
  }
}
