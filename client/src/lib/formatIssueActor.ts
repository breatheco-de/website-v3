export type IssueActorRef = {
  type: "ui" | "mcp" | "system";
  client?: string;
  model?: string;
  source?: string;
};

export type EventAttributionEntry = {
  author?: string;
  actor?: IssueActorRef;
};

/** Human-readable provenance suffix for claimed/completed lines. */
export function formatIssueActorSuffix(actor?: IssueActorRef | null): string {
  if (!actor) return "";
  if (actor.type === "mcp") {
    const via = actor.client?.trim() || "MCP";
    const model = actor.model?.trim();
    return model ? ` · via ${via} (${model})` : ` · via ${via}`;
  }
  if (actor.type === "system") {
    return ` · via ${actor.source?.trim() || "system"}`;
  }
  return "";
}

export function formatIssueActorLine(by: string, actor?: IssueActorRef | null): string {
  return `${by}${formatIssueActorSuffix(actor)}`;
}

export function formatAttributionEntry(entry: EventAttributionEntry): string {
  const author = entry.author?.trim();
  if (author) return formatIssueActorLine(author, entry.actor);
  if (entry.actor?.type === "system") {
    return entry.actor.source?.trim() || "system";
  }
  if (entry.actor?.type === "mcp") {
    return formatIssueActorLine("MCP", entry.actor);
  }
  return "Unknown";
}

export function formatAttributionSummary(
  attribution: EventAttributionEntry[],
): { primary: string; extraCount: number } {
  if (attribution.length === 0) return { primary: "", extraCount: 0 };
  return {
    primary: formatAttributionEntry(attribution[0]!),
    extraCount: Math.max(0, attribution.length - 1),
  };
}

export function formatCausalityLabel(
  event: Pick<PipelineContentEventLike, "triggeredByEventId" | "triggeredByEventIds">,
  loadedIds: Set<number>,
): string | null {
  const ids =
    event.triggeredByEventIds && event.triggeredByEventIds.length > 0
      ? event.triggeredByEventIds
      : event.triggeredByEventId != null
        ? [event.triggeredByEventId]
        : [];
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    const id = ids[0]!;
    const inLog = loadedIds.has(id);
    return inLog ? `Caused by #${id}` : `Caused by #${id} (no longer in log)`;
  }
  const preview = ids.slice(0, 3).map((id) => `#${id}`).join(", ");
  const rest = ids.length > 3 ? ` (+${ids.length - 3} more)` : "";
  return `Caused by saves ${preview}${rest}`;
}

export type PipelineContentEventLike = {
  triggeredByEventId?: number;
  triggeredByEventIds?: number[];
};
