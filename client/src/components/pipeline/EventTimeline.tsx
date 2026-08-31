import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconAlertTriangle, IconArrowRight } from "@tabler/icons-react";
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
const STAFF_LANE_COUNT = 2;
/**
 * Display-only chip occupancy at the default 3h window (~1200px wide).
 * ~156px chip+gap → ~24.6 min so successive chips on one staff never overlap.
 * List filtering and tooltips still use real `created_at`.
 */
const STAFF_SLOT_MS = Math.ceil((INITIAL_WINDOW_MS / 1200) * 164);
const STAFF_HEIGHT_PX = 80;
/** Treat window end within this of Date.now() as “parked at latest”. */
const FOLLOW_NOW_EPS_MS = 2_000;
const CHROME_STYLE_ID = "event-timeline-chrome-overrides";

const HELP_DEFAULT =
  "Your agents are working for you — watch them collaborate and interact on this timeline. Drag to move along their timeline; the list below moves and highlights with you so nothing is ever filtered away.";
const HELP_AT_NOW_EDGE =
  "You've already reached the end of the history — you can drag right to move back in time.";

/**
 * Vis redraws group DOM on data changes; CSS alone occasionally loses to load
 * order / inline leftovers. Force-hide horizontal staff chrome on the live DOM.
 */
function sanitizeTimelineChrome(root: HTMLElement | null) {
  if (!root) return;
  root.querySelectorAll<HTMLElement>(".vis-panel.vis-background.vis-horizontal").forEach((el) => {
    el.style.setProperty("display", "none", "important");
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("height", "0", "important");
    el.style.setProperty("opacity", "0", "important");
    el.style.setProperty("pointer-events", "none", "important");
  });
  root.querySelectorAll<HTMLElement>(".vis-grid.vis-horizontal").forEach((el) => {
    el.style.setProperty("display", "none", "important");
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("height", "0", "important");
    el.style.setProperty("opacity", "0", "important");
    el.style.setProperty("border", "none", "important");
  });
  root.querySelectorAll<HTMLElement>(".vis-group, .vis-label").forEach((el) => {
    el.style.setProperty("border", "none", "important");
    el.style.setProperty("border-bottom", "none", "important");
    el.style.setProperty("border-top", "none", "important");
    el.style.setProperty("box-shadow", "none", "important");
  });
}

/** Head style beats vis stylesheet order regardless of Vite chunk sequence. */
function ensureChromeStyleTag() {
  if (typeof document === "undefined") return;
  if (document.getElementById(CHROME_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = CHROME_STYLE_ID;
  style.textContent = `
.event-timeline-root .vis-panel.vis-background.vis-horizontal,
.event-timeline-root .vis-grid.vis-horizontal {
  display: none !important;
  visibility: hidden !important;
  height: 0 !important;
  opacity: 0 !important;
  border: none !important;
  pointer-events: none !important;
}
.event-timeline-root .vis-group,
.event-timeline-root .vis-foreground .vis-group,
.event-timeline-root .vis-labelset .vis-label,
.event-timeline-root .vis-label {
  border: none !important;
  border-bottom: none !important;
  border-top: none !important;
  box-shadow: none !important;
}
.event-timeline-shell,
.event-timeline-root,
.event-timeline-root .vis-timeline,
.event-timeline-root .vis-panel,
.event-timeline-root .vis-content,
.event-timeline-root .vis-foreground,
.event-timeline-root .vis-itemset,
.event-timeline-root .vis-group,
.event-timeline-root .vis-item,
.event-timeline-item {
  cursor: grab !important;
}
.event-timeline-shell:active,
.event-timeline-shell:active .event-timeline-root,
.event-timeline-shell:active .vis-timeline,
.event-timeline-shell:active .vis-panel,
.event-timeline-shell:active .vis-item {
  cursor: grabbing !important;
}
`.trim();
  document.head.appendChild(style);
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
 * Serial queue → 2-line music staff: order by event id, round-robin lanes,
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
      title: activityLabel,
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
  onUserInteract,
  onJumpToLatest,
  toolbar,
  className,
}: {
  events: EventTimelineEvent[];
  getActivityLabel: (event: EventTimelineEvent) => string;
  visibleRange: VisibleTimeRange | null;
  onRangeChange: (range: VisibleTimeRange) => void;
  onSelect: (eventId: number) => void;
  /** User started scrubbing/zooming the timeline (not live rolling updates). */
  onUserInteract?: () => void;
  onJumpToLatest?: () => void;
  /** Optional controls on the right of the help bar (e.g. filters). */
  toolbar?: ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hoverLineRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const itemsRef = useRef<DataSet<TimelineItem> | null>(null);
  const groupsRef = useRef<DataSet<DataGroup> | null>(null);
  const skipRangeEmitRef = useRef(false);
  const seededWindowRef = useRef(false);
  const draggingRef = useRef(false);
  const hoverAttachedRef = useRef(false);
  const atNowRef = useRef(true);
  const lastPointerXRef = useRef<number | null>(null);
  const onRangeChangeRef = useRef(onRangeChange);
  const onSelectRef = useRef(onSelect);
  const onUserInteractRef = useRef(onUserInteract);
  const getActivityLabelRef = useRef(getActivityLabel);
  const [atHistoryEndHint, setAtHistoryEndHint] = useState(false);
  /** True when the visible window end is parked at “now” (latest). */
  const [isAtLatest, setIsAtLatest] = useState(true);

  onRangeChangeRef.current = onRangeChange;
  onSelectRef.current = onSelect;
  onUserInteractRef.current = onUserInteract;
  getActivityLabelRef.current = getActivityLabel;

  // Imperative scrubber via document capture + hit-test.
  // Attach in layout effect AND retry once via rAF so refs are never missed.
  useEffect(() => {
    ensureChromeStyleTag();
    let removed = false;
    let detach: (() => void) | null = null;

    const attach = () => {
      if (removed || hoverAttachedRef.current) return;
      const shell = shellRef.current;
      const line = hoverLineRef.current;
      if (!shell || !line) return;

      hoverAttachedRef.current = true;

      const hide = () => {
        line.style.opacity = "0";
        line.style.visibility = "hidden";
        line.classList.remove("is-visible");
      };

      const showAt = (clientX: number) => {
        const rect = shell.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const x = Math.min(Math.max(0, clientX - rect.left), rect.width);
        line.style.left = `${x}px`;
        line.style.opacity = "1";
        line.style.visibility = "visible";
        line.classList.add("is-visible");
      };

      const pointerInShell = (clientX: number, clientY: number) => {
        const rect = shell.getBoundingClientRect();
        return (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        );
      };

      const onMove = (e: PointerEvent | MouseEvent) => {
        const buttons = "buttons" in e ? e.buttons : (e as MouseEvent).buttons;
        if (!pointerInShell(e.clientX, e.clientY)) {
          if (!draggingRef.current) hide();
          return;
        }
        if (buttons !== 0) {
          draggingRef.current = true;
          hide();
          return;
        }
        if (draggingRef.current) draggingRef.current = false;
        showAt(e.clientX);
      };

      const endDrag = () => {
        draggingRef.current = false;
      };

      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("mousemove", onMove, true);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
      shell.addEventListener("mouseenter", onMove as EventListener, true);

      detach = () => {
        document.removeEventListener("pointermove", onMove, true);
        document.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("pointerup", endDrag);
        window.removeEventListener("pointercancel", endDrag);
        shell.removeEventListener("mouseenter", onMove as EventListener, true);
        hoverAttachedRef.current = false;
        hide();
      };
    };

    attach();
    const raf = requestAnimationFrame(attach);

    return () => {
      removed = true;
      cancelAnimationFrame(raf);
      detach?.();
    };
  }, []);

  // Mount once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    ensureChromeStyleTag();

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
    sanitizeTimelineChrome(el);

    skipRangeEmitRef.current = true;
    timeline.setWindow(start, end, { animation: false });
    pinTimelineToNow(timeline);
    onRangeChangeRef.current({ start, end });
    skipRangeEmitRef.current = false;

    const emitRange = () => {
      if (skipRangeEmitRef.current) return;
      const w = timeline.getWindow();
      const start = +w.start;
      const end = +w.end;
      const atNow = windowEndIsAtNow(end);
      atNowRef.current = atNow;
      setIsAtLatest(atNow);
      if (!atNow) setAtHistoryEndHint(false);
      onRangeChangeRef.current({ start, end });
      sanitizeTimelineChrome(el);
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
      sanitizeTimelineChrome(el);
    }, 1000);

    // Detect drag-left while already at “now” (window is clamped by max).
    const onPointerDown = (e: PointerEvent) => {
      lastPointerXRef.current = e.clientX;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.buttons === 0) {
        lastPointerXRef.current = e.clientX;
        return;
      }
      const prevX = lastPointerXRef.current;
      lastPointerXRef.current = e.clientX;
      if (prevX == null) return;
      const dx = e.clientX - prevX;
      // Dragging content left tries to reveal the future past “now”.
      if (atNowRef.current && dx < -2) {
        setAtHistoryEndHint(true);
      }
    };
    const onPointerUp = () => {
      lastPointerXRef.current = null;
    };

    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.clearInterval(maxTick);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
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
    sanitizeTimelineChrome(containerRef.current);

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
      sanitizeTimelineChrome(containerRef.current);
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
      sanitizeTimelineChrome(containerRef.current);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [events]);

  // Pan / zoom on the staff is a deliberate scrub — notify parent (e.g. release list scroll lock).
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const notify = () => onUserInteractRef.current?.();
    shell.addEventListener("pointerdown", notify);
    shell.addEventListener("wheel", notify, { passive: true });
    return () => {
      shell.removeEventListener("pointerdown", notify);
      shell.removeEventListener("wheel", notify);
    };
  }, []);

  // External jump-to-latest / programmatic window
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || !visibleRange) return;
    if (windowEndIsAtNow(visibleRange.end)) {
      pinTimelineToNow(timeline);
      atNowRef.current = true;
      setIsAtLatest(true);
      sanitizeTimelineChrome(containerRef.current);
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
    atNowRef.current = false;
    setIsAtLatest(false);
    setAtHistoryEndHint(false);
    sanitizeTimelineChrome(containerRef.current);
  }, [visibleRange]);

  const handleJumpToLatest = () => {
    onUserInteractRef.current?.();
    const timeline = timelineRef.current;
    if (timeline) pinTimelineToNow(timeline);
    atNowRef.current = true;
    setIsAtLatest(true);
    setAtHistoryEndHint(false);
    onJumpToLatest?.();
  };

  return (
    <div
      className={cn(
        "sticky top-0 z-30 w-full bg-background shadow-[0_1px_0_0_hsl(var(--border))]",
        className,
      )}
      data-testid="event-timeline"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-2 bg-foreground text-background">
        <p
          key={atHistoryEndHint ? "at-end" : "default"}
          className={cn(
            "text-xs leading-relaxed max-w-3xl event-timeline-help min-w-0 flex-1",
            atHistoryEndHint
              ? "event-timeline-help--warn text-amber-300 dark:text-amber-800 inline-flex items-start gap-2"
              : "text-background/80",
          )}
          data-testid="text-timeline-help"
          role={atHistoryEndHint ? "status" : undefined}
        >
          {atHistoryEndHint ? (
            <>
              <IconAlertTriangle
                className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-300 dark:text-amber-800"
                aria-hidden
              />
              <span>{HELP_AT_NOW_EDGE}</span>
            </>
          ) : (
            HELP_DEFAULT
          )}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          {toolbar}
          {onJumpToLatest && !isAtLatest ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-background hover:underline shrink-0 font-medium"
              onClick={handleJumpToLatest}
              aria-label="Jump to latest"
              data-testid="button-timeline-jump-latest"
            >
              <span className="hidden sm:inline">Jump to latest</span>
              <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
      <div ref={shellRef} className="event-timeline-shell relative w-full">
        <div ref={containerRef} className="event-timeline-root w-full" />
        <div
          ref={hoverLineRef}
          className="event-timeline-hover-line"
          style={{ opacity: 0, visibility: "hidden" }}
          aria-hidden
        />
      </div>
    </div>
  );
}

export function jumpToLatestRange(windowMs = INITIAL_WINDOW_MS): VisibleTimeRange {
  const end = Date.now();
  return { start: end - windowMs, end };
}
