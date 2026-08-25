import { useEffect, useRef, useState } from "react";
import { IconArrowRight } from "@tabler/icons-react";
import { DataSet, Timeline } from "vis-timeline/standalone";
import type { DataGroup, DataItem, TimelineOptions } from "vis-timeline/standalone";
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
const STAFF_LANE_COUNT = 3;
/**
 * Display-only chip occupancy at the default 3h window (~1200px wide).
 * ~156px chip+gap → ~24.6 min so successive chips on one staff never overlap.
 * List filtering and tooltips still use real `created_at`.
 */
const STAFF_SLOT_MS = Math.ceil((INITIAL_WINDOW_MS / 1200) * 164);
const STAFF_HEIGHT_PX = 116;
/** Treat window end within this of Date.now() as “parked at latest”. */
const FOLLOW_NOW_EPS_MS = 2_000;

function formatHoverTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

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
  group: number;
  realStart: number;
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

/**
 * Serial queue → 3-line music staff: order by event id, round-robin lanes,
 * nudge display `start` so chips never sit on top of each other.
 */
export function layoutStaffItems(
  events: EventTimelineEvent[],
  getActivityLabel: (event: EventTimelineEvent) => string,
  theme: AgentTheme,
): TimelineItem[] {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  const lastEnd = Array.from({ length: STAFF_LANE_COUNT }, () => Number.NEGATIVE_INFINITY);

  return sorted.map((event, index) => {
    const lane = index % STAFF_LANE_COUNT;
    const displayStart = Math.max(event.created_at, lastEnd[lane] + STAFF_SLOT_MS);
    lastEnd[lane] = displayStart + STAFF_SLOT_MS;

    const agentId = resolveAgentId(event.attribution);
    const activityLabel = getActivityLabel(event);
    return {
      id: event.id,
      group: lane,
      start: displayStart,
      realStart: event.created_at,
      type: "box",
      title: `#${event.id} · ${activityLabel}`,
      activityLabel,
      agentIconUrl: getAgentIconUrl(agentId, theme),
      content: "",
    };
  });
}

function staffGroups(): DataGroup[] {
  return Array.from({ length: STAFF_LANE_COUNT }, (_, id) => ({
    id,
    content: "",
  }));
}

function pinTimelineToNow(timeline: Timeline) {
  const now = Date.now();
  timeline.setOptions({
    max: now,
    rollingMode: { follow: true, offset: 1 },
  });
}

function windowEndIsAtNow(end: number, now = Date.now()): boolean {
  return end >= now - FOLLOW_NOW_EPS_MS;
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
  const shellRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const itemsRef = useRef<DataSet<TimelineItem> | null>(null);
  const groupsRef = useRef<DataSet<DataGroup> | null>(null);
  const skipRangeEmitRef = useRef(false);
  const seededWindowRef = useRef(false);
  const draggingRef = useRef(false);
  const onRangeChangeRef = useRef(onRangeChange);
  const onSelectRef = useRef(onSelect);
  const getActivityLabelRef = useRef(getActivityLabel);
  const [hover, setHover] = useState<{ x: number; at: number } | null>(null);
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

  // Capture-phase listeners: vis/Hammer stopPropagation on pan, which can
  // swallow React bubble handlers for the scrubber line.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const timeAtX = (x: number, width: number): number => {
      const timeline = timelineRef.current;
      if (!timeline || width <= 0) return Date.now();
      const w = timeline.getWindow();
      const start = +w.start;
      const end = +w.end;
      const ratio = Math.min(1, Math.max(0, x / width));
      return start + ratio * (end - start);
    };

    const onMove = (e: PointerEvent) => {
      if (draggingRef.current || e.buttons !== 0) {
        setHover(null);
        return;
      }
      const rect = shell.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setHover({ x, at: timeAtX(x, rect.width) });
    };
    const onLeave = () => {
      setHover(null);
    };
    const onDown = () => {
      draggingRef.current = true;
      setIsDragging(true);
      setHover(null);
    };
    const onUp = () => {
      draggingRef.current = false;
      setIsDragging(false);
    };

    shell.addEventListener("pointermove", onMove, true);
    shell.addEventListener("pointerleave", onLeave, true);
    shell.addEventListener("pointerdown", onDown, true);
    shell.addEventListener("pointerup", onUp, true);
    shell.addEventListener("pointercancel", onUp, true);
    return () => {
      shell.removeEventListener("pointermove", onMove, true);
      shell.removeEventListener("pointerleave", onLeave, true);
      shell.removeEventListener("pointerdown", onDown, true);
      shell.removeEventListener("pointerup", onUp, true);
      shell.removeEventListener("pointercancel", onUp, true);
    };
  }, []);

  // Mount once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const items = new DataSet<TimelineItem>([]);
    const groups = new DataSet<DataGroup>(staffGroups());
    itemsRef.current = items;
    groupsRef.current = groups;

    const end = Date.now();
    const start = end - INITIAL_WINDOW_MS;

    const options: TimelineOptions = {
      stack: false,
      stackSubgroups: false,
      moveable: true,
      zoomable: true,
      selectable: true,
      multiselect: false,
      showCurrentTime: true,
      showMajorLabels: false,
      showMinorLabels: false,
      orientation: "top",
      height: STAFF_HEIGHT_PX,
      margin: { item: { horizontal: 8, vertical: 6 }, axis: 0 },
      zoomMin: 5 * 60 * 1000,
      zoomMax: 7 * 24 * 60 * 60 * 1000,
      // No future: right edge cannot pass “now”; rolling keeps it advancing.
      max: end,
      rollingMode: { follow: true, offset: 1 },
      start,
      end,
      // Prefer Element templates (XSS strips SVG/img from HTML strings).
      template: (item) => itemContentElement(item as TimelineItem),
    };

    const timeline = new Timeline(el, items, groups, options);
    timelineRef.current = timeline;

    skipRangeEmitRef.current = true;
    timeline.setWindow(start, end, { animation: false });
    pinTimelineToNow(timeline);
    onRangeChangeRef.current({ start, end });
    skipRangeEmitRef.current = false;

    const emitRange = () => {
      if (skipRangeEmitRef.current) return;
      const w = timeline.getWindow();
      onRangeChangeRef.current({ start: +w.start, end: +w.end });
    };

    const onRangeChangeEvt = () => {
      emitRange();
    };

    const onRangeChangedEvt = () => {
      emitRange();
      // User parked at the right edge → resume live follow of “now”.
      const w = timeline.getWindow();
      if (windowEndIsAtNow(+w.end)) {
        pinTimelineToNow(timeline);
      }
    };

    timeline.on("rangechanged", onRangeChangedEvt);
    timeline.on("rangechange", onRangeChangeEvt);

    timeline.on("select", (props) => {
      const id = props.items?.[0];
      if (typeof id === "number") onSelectRef.current(id);
      else if (typeof id === "string" && /^\d+$/.test(id)) onSelectRef.current(Number(id));
    });

    const maxTick = window.setInterval(() => {
      const t = timelineRef.current;
      if (!t) return;
      t.setOptions({ max: Date.now() });
    }, 1000);

    return () => {
      window.clearInterval(maxTick);
      timeline.off("rangechanged", onRangeChangedEvt);
      timeline.off("rangechange", onRangeChangeEvt);
      timeline.destroy();
      timelineRef.current = null;
      itemsRef.current = null;
      groupsRef.current = null;
      seededWindowRef.current = false;
    };
  }, []);

  // Sync items when events / theme change — do not reset window after first seed
  useEffect(() => {
    const items = itemsRef.current;
    const timeline = timelineRef.current;
    if (!items) return;

    const theme = getDocumentTheme();
    const next = layoutStaffItems(events, getActivityLabelRef.current, theme);
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
      pinTimelineToNow(timeline);
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
      const next = layoutStaffItems(events, getActivityLabelRef.current, theme);
      items.update(next);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [events]);

  // External jump-to-latest / programmatic window
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || !visibleRange) return;
    if (windowEndIsAtNow(visibleRange.end)) {
      pinTimelineToNow(timeline);
      return;
    }
    const current = timeline.getWindow();
    const same =
      Math.abs(+current.start - visibleRange.start) < 500 &&
      Math.abs(+current.end - visibleRange.end) < 500;
    if (same) return;
    skipRangeEmitRef.current = true;
    timeline.setWindow(visibleRange.start, visibleRange.end, { animation: false });
    skipRangeEmitRef.current = false;
  }, [visibleRange]);

  const handleJumpToLatest = () => {
    const timeline = timelineRef.current;
    if (timeline) pinTimelineToNow(timeline);
    onJumpToLatest?.();
  };

  return (
    <div
      className={cn("w-full bg-white py-3", className)}
      data-testid="event-timeline"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-2 bg-foreground text-background">
        <p className="text-xs text-background/80 leading-relaxed max-w-3xl">
          Your agents are working for you — watch them collaborate and interact on this timeline.
          Drag to move along their timeline.
        </p>
        {onJumpToLatest ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-background hover:underline shrink-0 font-medium"
            onClick={handleJumpToLatest}
            data-testid="button-timeline-jump-latest"
          >
            Jump to latest
            <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      <div ref={shellRef} className="event-timeline-shell relative w-full">
        <div ref={containerRef} className="event-timeline-root w-full" />
        {hover != null && !isDragging ? (
          <div
            className="event-timeline-hover-line"
            style={{ left: hover.x }}
            aria-hidden
          >
            <span className="event-timeline-hover-label">
              {formatHoverTime(hover.at)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function jumpToLatestRange(windowMs = INITIAL_WINDOW_MS): VisibleTimeRange {
  const end = Date.now();
  return { start: end - windowMs, end };
}
