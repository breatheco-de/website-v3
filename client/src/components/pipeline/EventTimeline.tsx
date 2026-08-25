import { useEffect, useRef, useState } from "react";
import { IconArrowRight } from "@tabler/icons-react";
import { DataSet, Timeline } from "vis-timeline/standalone";
import type { DataItem, TimelineOptions } from "vis-timeline/standalone";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";
import "./EventTimeline.css";
import {
  getAgentIconUrl,
  getDocumentTheme,
  resolveAgentId,
  type AgentTheme,
} from "./agentIcons";
import type { EventAttributionEntry } from "@/lib/formatIssueActor";
import { cn } from "@/lib/utils";

const INITIAL_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 hours

export type EventTimelineEvent = {
  id: number;
  type: string;
  created_at: number;
  attribution: EventAttributionEntry[];
};

export type VisibleTimeRange = {
  start: number;
  end: number;
};

type TimelineItem = DataItem & {
  id: number;
  activityLabel: string;
  agentIconUrl: string | null;
};

/** Return a real Element — string templates go through vis XSS and become literal text. */
function itemContentElement(item: TimelineItem): HTMLElement {
  const root = document.createElement("span");
  root.className = "event-timeline-item";

  if (item.agentIconUrl) {
    const img = document.createElement("img");
    img.className = "event-timeline-item__icon";
    img.src = item.agentIconUrl;
    img.alt = "";
    img.width = 18;
    img.height = 18;
    img.draggable = false;
    root.appendChild(img);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "event-timeline-item__fallback";
    fallback.setAttribute("aria-hidden", "true");
    fallback.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>';
    root.appendChild(fallback);
  }

  const badge = document.createElement("span");
  badge.className = "event-timeline-item__badge";
  badge.textContent = item.activityLabel;
  root.appendChild(badge);

  return root;
}

function toTimelineItems(
  events: EventTimelineEvent[],
  getActivityLabel: (event: EventTimelineEvent) => string,
  theme: AgentTheme,
): TimelineItem[] {
  return events.map((event) => {
    const agentId = resolveAgentId(event.attribution);
    return {
      id: event.id,
      start: event.created_at,
      type: "box",
      title: `#${event.id} · ${getActivityLabel(event)}`,
      activityLabel: getActivityLabel(event),
      agentIconUrl: getAgentIconUrl(agentId, theme),
      content: "",
    };
  });
}

export function EventTimeline({
  events,
  getActivityLabel,
  visibleRange,
  onRangeChange,
  onSelect,
  onJumpToLatest,
  className,
}: {
  events: EventTimelineEvent[];
  getActivityLabel: (event: EventTimelineEvent) => string;
  visibleRange: VisibleTimeRange | null;
  onRangeChange: (range: VisibleTimeRange) => void;
  onSelect: (eventId: number) => void;
  onJumpToLatest?: () => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const itemsRef = useRef<DataSet<TimelineItem> | null>(null);
  const skipRangeEmitRef = useRef(false);
  const seededWindowRef = useRef(false);
  const draggingRef = useRef(false);
  const onRangeChangeRef = useRef(onRangeChange);
  const onSelectRef = useRef(onSelect);
  const getActivityLabelRef = useRef(getActivityLabel);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  onRangeChangeRef.current = onRangeChange;
  onSelectRef.current = onSelect;
  getActivityLabelRef.current = getActivityLabel;

  useEffect(() => {
    const endDrag = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  // Mount once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const theme = getDocumentTheme();
    const items = new DataSet<TimelineItem>([]);
    itemsRef.current = items;

    const end = Date.now();
    const start = end - INITIAL_WINDOW_MS;

    const options: TimelineOptions = {
      stack: true,
      stackSubgroups: false,
      moveable: true,
      zoomable: true,
      selectable: true,
      multiselect: false,
      showCurrentTime: true,
      showMajorLabels: false,
      showMinorLabels: false,
      orientation: "top",
      height: 72,
      margin: { item: { horizontal: 8, vertical: 4 }, axis: 0 },
      zoomMin: 5 * 60 * 1000,
      zoomMax: 7 * 24 * 60 * 60 * 1000,
      start,
      end,
      // Prefer Element templates (XSS strips SVG/img from HTML strings).
      template: (item) => itemContentElement(item as TimelineItem),
    };

    const timeline = new Timeline(el, items, options);
    timelineRef.current = timeline;

    skipRangeEmitRef.current = true;
    timeline.setWindow(start, end, { animation: false });
    onRangeChangeRef.current({ start, end });
    skipRangeEmitRef.current = false;

    const onRange = () => {
      if (skipRangeEmitRef.current) return;
      const w = timeline.getWindow();
      onRangeChangeRef.current({ start: +w.start, end: +w.end });
    };
    timeline.on("rangechanged", onRange);
    timeline.on("rangechange", onRange);

    timeline.on("select", (props) => {
      const id = props.items?.[0];
      if (typeof id === "number") onSelectRef.current(id);
      else if (typeof id === "string" && /^\d+$/.test(id)) onSelectRef.current(Number(id));
    });

    // Seed with current theme (items synced in next effect)
    void theme;

    return () => {
      timeline.off("rangechanged", onRange);
      timeline.off("rangechange", onRange);
      timeline.destroy();
      timelineRef.current = null;
      itemsRef.current = null;
      seededWindowRef.current = false;
    };
  }, []);

  // Sync items when events / theme change — do not reset window after first seed
  useEffect(() => {
    const items = itemsRef.current;
    const timeline = timelineRef.current;
    if (!items) return;

    const theme = getDocumentTheme();
    const next = toTimelineItems(events, getActivityLabelRef.current, theme);
    const nextIds = new Set(next.map((i) => i.id));
    const removeIds = items.getIds().filter((id) => !nextIds.has(id as number));
    if (removeIds.length > 0) items.remove(removeIds);
    items.update(next);

    // First non-empty populate: keep the 3h "latest" window (vis may otherwise fit all).
    if (!seededWindowRef.current && next.length > 0 && timeline) {
      seededWindowRef.current = true;
      const end = Date.now();
      const start = end - INITIAL_WINDOW_MS;
      skipRangeEmitRef.current = true;
      timeline.setWindow(start, end, { animation: false });
      onRangeChangeRef.current({ start, end });
      skipRangeEmitRef.current = false;
    }
  }, [events]);

  // Observe theme class changes on <html>
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const items = itemsRef.current;
      if (!items) return;
      const theme = getDocumentTheme();
      const current = items.get();
      items.update(
        current.map((item) => {
          const event = events.find((e) => e.id === item.id);
          const agentId = resolveAgentId(event?.attribution);
          return {
            ...item,
            agentIconUrl: getAgentIconUrl(agentId, theme),
            activityLabel: event
              ? getActivityLabelRef.current(event)
              : item.activityLabel,
          };
        }),
      );
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [events]);

  // External jump-to-latest / programmatic window
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || !visibleRange) return;
    const current = timeline.getWindow();
    const same =
      Math.abs(+current.start - visibleRange.start) < 500 &&
      Math.abs(+current.end - visibleRange.end) < 500;
    if (same) return;
    skipRangeEmitRef.current = true;
    timeline.setWindow(visibleRange.start, visibleRange.end, { animation: false });
    skipRangeEmitRef.current = false;
  }, [visibleRange]);

  return (
    <div
      className={cn(
        "-mx-6 w-[calc(100%+3rem)] bg-white py-3",
        className,
      )}
      data-testid="event-timeline"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-2 bg-foreground text-background">
        <p className="text-xs text-background/80 leading-relaxed">
          Drag the timeline to pan; the list below shows only events in this window. Icons are
          MCP/model agents when known — GitHub sync and staff use a generic bot mark.
        </p>
        {onJumpToLatest ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-background hover:underline shrink-0 font-medium"
            onClick={onJumpToLatest}
            data-testid="button-timeline-jump-latest"
          >
            Jump to latest
            <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      <div
        className="event-timeline-shell relative w-full"
        onPointerDown={() => {
          draggingRef.current = true;
          setIsDragging(true);
          setHoverX(null);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
          setIsDragging(false);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
          setIsDragging(false);
        }}
        onPointerLeave={() => {
          draggingRef.current = false;
          setIsDragging(false);
          setHoverX(null);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current || e.buttons !== 0) {
            setHoverX(null);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverX(e.clientX - rect.left);
        }}
      >
        <div ref={containerRef} className="event-timeline-root w-full" />
        {hoverX != null && !isDragging ? (
          <div
            className="event-timeline-hover-line"
            style={{ left: hoverX }}
            aria-hidden
          />
        ) : null}
      </div>
    </div>
  );
}

export function jumpToLatestRange(windowMs = INITIAL_WINDOW_MS): VisibleTimeRange {
  const end = Date.now();
  return { start: end - windowMs, end };
}
