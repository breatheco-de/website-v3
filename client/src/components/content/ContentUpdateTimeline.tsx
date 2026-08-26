import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconChevronRight, IconExternalLink } from "@tabler/icons-react";
import { FileText } from "lucide-react";
import { DataSet, Timeline } from "vis-timeline/standalone";
import type { DataItem, TimelineOptions } from "vis-timeline/standalone";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";
import "@/components/pipeline/EventTimeline.css";
import {
  CONTENT_UPDATE_WINDOW_MS,
  type ContentUpdateTimelineItem,
} from "@/components/content/buildContentUpdateTimelineItems";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const TIMELINE_HEIGHT_PX = 140;
const CHROME_STYLE_ID = "content-update-timeline-chrome-overrides-v2";

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

function ensureChromeStyleTag() {
  if (typeof document === "undefined") return;
  if (document.getElementById(CHROME_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = CHROME_STYLE_ID;
  style.textContent = `
.content-update-timeline-root.event-timeline-root .vis-panel.vis-background.vis-horizontal,
.content-update-timeline-root.event-timeline-root .vis-grid.vis-horizontal {
  display: none !important;
  visibility: hidden !important;
  height: 0 !important;
  opacity: 0 !important;
  border: none !important;
  pointer-events: none !important;
}
.content-update-timeline-root.event-timeline-root .vis-group,
.content-update-timeline-root.event-timeline-root .vis-foreground .vis-group,
.content-update-timeline-root.event-timeline-root .vis-labelset .vis-label,
.content-update-timeline-root.event-timeline-root .vis-label {
  border: none !important;
  border-bottom: none !important;
  border-top: none !important;
  box-shadow: none !important;
}
/* Show day axis (EventTimeline.css hides .vis-panel.vis-top / .vis-text). */
.content-update-timeline-root.event-timeline-root .vis-panel.vis-top {
  display: block !important;
  height: auto !important;
  visibility: visible !important;
  background: #ffffff !important;
  border: none !important;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08) !important;
}
.content-update-timeline-root.event-timeline-root .vis-panel.vis-bottom {
  display: none !important;
  height: 0 !important;
}
.content-update-timeline-root.event-timeline-root .vis-time-axis .vis-text {
  display: block !important;
  color: rgba(0, 0, 0, 0.55) !important;
  font-size: 10px !important;
  font-weight: 600 !important;
  letter-spacing: 0.01em !important;
}
.content-update-timeline-root.event-timeline-root .vis-time-axis .vis-text.vis-major {
  color: rgba(0, 0, 0, 0.75) !important;
  font-weight: 700 !important;
}
`.trim();
  document.head.appendChild(style);
}

function dayOrdinal(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (k >= 11 && k <= 13) return `${n}th`;
  if (j === 1) return `${n}st`;
  if (j === 2) return `${n}nd`;
  if (j === 3) return `${n}rd`;
  return `${n}th`;
}

/** e.g. "May 1st" */
function formatDayLabel(date: Date): string {
  const month = date.toLocaleString("en-US", { month: "short" });
  return `${month} ${dayOrdinal(date.getDate())}`;
}

function toJsDate(value: Date | { toDate?: () => Date; valueOf?: () => number }): Date {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === "function") {
    const d = value.toDate();
    if (d instanceof Date) return d;
  }
  return new Date(typeof value?.valueOf === "function" ? value.valueOf() : (value as Date));
}

function formatAxisLabel(
  dateInput: Date | { toDate?: () => Date; valueOf?: () => number },
  scale: string,
): string {
  const date = toJsDate(dateInput);
  if (Number.isNaN(date.getTime())) return "";
  switch (scale) {
    case "year":
      return String(date.getFullYear());
    case "month":
      return date.toLocaleString("en-US", { month: "short", year: "numeric" });
    case "week":
    case "day":
    case "weekday":
      return formatDayLabel(date);
    case "hour":
      // 12h grid: label the day at midnight; leave noon unlabeled (half-day tick).
      if (date.getHours() === 0) return formatDayLabel(date);
      return "";
    case "minute":
      return date.toLocaleString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    default:
      return formatDayLabel(date);
  }
}

function formatHoverTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function truncateLabel(title: string, max = 28): string {
  const t = title.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

type TimelineChipItem = DataItem & {
  id: string;
  activityLabel: string;
};

function itemContentElement(item: TimelineChipItem): HTMLElement {
  const root = document.createElement("span");
  root.className = "event-timeline-item";

  const fallback = document.createElement("span");
  fallback.className = "event-timeline-item__fallback";
  fallback.setAttribute("aria-hidden", "true");
  fallback.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';
  root.appendChild(fallback);

  const badge = document.createElement("span");
  badge.className = "event-timeline-item__badge";
  badge.textContent = item.activityLabel;
  root.appendChild(badge);

  return root;
}

/** Place chips at real updated_at — no lane nudge / fake spacing. */
export function layoutContentUpdateItems(
  items: ContentUpdateTimelineItem[],
): TimelineChipItem[] {
  return [...items]
    .sort((a, b) => a.updatedAtMs - b.updatedAtMs)
    .map((item) => {
      const activityLabel = truncateLabel(item.title);
      return {
        id: item.id,
        start: item.updatedAtMs,
        type: "box" as const,
        title: `${item.title} · ${formatHoverTime(item.updatedAtMs)}`,
        activityLabel,
        content: "",
      };
    });
}

type VisitMenuState = {
  item: ContentUpdateTimelineItem;
  x: number;
  y: number;
};

export function ContentUpdateTimeline({
  items,
  className,
}: {
  items: ContentUpdateTimelineItem[];
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const itemsRef = useRef<DataSet<TimelineChipItem> | null>(null);
  const itemsByIdRef = useRef<Map<string, ContentUpdateTimelineItem>>(new Map());
  const seededWindowRef = useRef(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [visitMenu, setVisitMenu] = useState<VisitMenuState | null>(null);

  const byId = new Map<string, ContentUpdateTimelineItem>();
  for (const item of items) byId.set(item.id, item);
  itemsByIdRef.current = byId;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    ensureChromeStyleTag();

    const dataItems = new DataSet<TimelineChipItem>([]);
    itemsRef.current = dataItems;

    const end = Date.now();
    const start = end - CONTENT_UPDATE_WINDOW_MS;

    const options: TimelineOptions = {
      stack: true,
      stackSubgroups: false,
      moveable: true,
      zoomable: false,
      selectable: true,
      multiselect: false,
      showCurrentTime: true,
      showMajorLabels: false,
      showMinorLabels: true,
      orientation: "top",
      height: TIMELINE_HEIGHT_PX,
      margin: { item: { horizontal: 8, vertical: 6 }, axis: 4 },
      // Two vertical lines per day (noon + midnight); day labels stay on the axis.
      timeAxis: { scale: "hour", step: 12 },
      zoomMin: 12 * 60 * 60 * 1000,
      zoomMax: 30 * 24 * 60 * 60 * 1000,
      max: end,
      start,
      end,
      format: {
        // Day names only on the minor axis — major would duplicate "Aug 21st".
        minorLabels: (date, scale) => formatAxisLabel(date, scale),
        majorLabels: () => "",
      },
      template: (item) => itemContentElement(item as TimelineChipItem),
    };

    const timeline = new Timeline(el, dataItems, options);
    timelineRef.current = timeline;
    sanitizeTimelineChrome(el);

    timeline.on("click", (props) => {
      const rawId = props.item;
      if (rawId == null) {
        setVisitMenu(null);
        return;
      }
      const id = String(rawId);
      const item = itemsByIdRef.current.get(id);
      if (!item) return;
      const evt = props.event as MouseEvent | PointerEvent | undefined;
      const x = evt?.clientX ?? 0;
      const y = evt?.clientY ?? 0;
      setVisitMenu({ item, x, y });
    });

    const maxTick = window.setInterval(() => {
      const t = timelineRef.current;
      if (!t) return;
      t.setOptions({ max: Date.now() });
      sanitizeTimelineChrome(el);
    }, 30_000);

    return () => {
      window.clearInterval(maxTick);
      timeline.destroy();
      timelineRef.current = null;
      itemsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const dataItems = itemsRef.current;
    const timeline = timelineRef.current;
    if (!dataItems) return;

    const next = layoutContentUpdateItems(items);
    const nextIds = new Set(next.map((i) => i.id));
    const removeIds = dataItems.getIds().filter((id) => !nextIds.has(String(id)));
    if (removeIds.length > 0) dataItems.remove(removeIds);
    dataItems.update(next);
    sanitizeTimelineChrome(containerRef.current);

    if (!seededWindowRef.current && next.length > 0 && timeline) {
      seededWindowRef.current = true;
      const end = Date.now();
      const start = end - CONTENT_UPDATE_WINDOW_MS;
      timeline.setWindow(start, end, { animation: false });
      sanitizeTimelineChrome(containerRef.current);
    }
  }, [items]);

  const visitEntries = visitMenu
    ? Object.entries(visitMenu.item.urls).filter(([, url]) => Boolean(url?.trim()))
    : [];

  return (
    <div
      className={cn("w-full bg-white dark:bg-card", className)}
      data-testid="content-update-timeline"
    >
      <div className="flex flex-col gap-1 px-6 py-2.5 bg-foreground text-background">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-xs leading-relaxed max-w-3xl text-background/90" data-testid="text-content-update-timeline-help">
            <span className="font-medium text-background">
              {items.length} {items.length === 1 ? "entry has" : "entries have"} been updated or
              published in the past 2 weeks
            </span>
            {" — "}
            based on editorial <code className="font-mono text-[10px]">updated_at</code>{" "}
            (content change), not first publish and not Git.
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-[11px] text-background/80 hover:text-background shrink-0"
            onClick={() => setAdvancedOpen((v) => !v)}
            data-testid="button-content-update-timeline-advanced"
          >
            {advancedOpen ? (
              <IconChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <IconChevronRight className="h-3.5 w-3.5" aria-hidden />
            )}
            Read more (advanced)
          </button>
        </div>
        {advancedOpen ? (
          <div
            className="text-[11px] leading-relaxed text-background/75 space-y-1 pt-1 border-t border-background/20"
            data-testid="text-content-update-timeline-advanced"
          >
            <p>
              Static entries resolve via <code className="font-mono">resolveStaticEntryUpdatedAt</code> in{" "}
              <code className="font-mono">server/content-types.ts</code> (YAML /{" "}
              <code className="font-mono">_updated_at</code> mapping, else{" "}
              <code className="font-mono">published_at</code> fallback on that resolver only).
            </p>
            <p>
              Field mapping docs: Content Type manage → Fields →{" "}
              <code className="font-mono">_updated_at</code>. DB rows use the mapped{" "}
              <code className="font-mono">updated_at</code> column when present.
            </p>
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div
          className="px-6 py-2 text-xs text-muted-foreground flex items-center gap-2 border-b border-border"
          data-testid="text-content-update-timeline-empty"
        >
          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
          No content updates in the last 2 weeks
        </div>
      ) : null}

      {/* Always mount the scrubber so vis-timeline can init on first paint (items often load later). */}
      <div className="event-timeline-shell relative w-full">
        <div
          ref={containerRef}
          className="event-timeline-root content-update-timeline-root w-full"
        />
      </div>

      <DropdownMenu
        open={visitMenu != null}
        onOpenChange={(open) => {
          if (!open) setVisitMenu(null);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed w-px h-px p-0 m-0 overflow-hidden opacity-0 pointer-events-none"
            style={
              visitMenu
                ? { left: visitMenu.x, top: visitMenu.y }
                : { left: 0, top: 0 }
            }
            data-testid="button-content-update-timeline-visit-anchor"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[10rem]">
          {visitEntries.length === 0 ? (
            <DropdownMenuItem disabled data-testid="menuitem-no-public-url">
              No public URL
            </DropdownMenuItem>
          ) : (
            visitEntries.map(([locale, url]) => (
              <DropdownMenuItem key={locale} asChild>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`menuitem-visit-${locale}`}
                >
                  <IconExternalLink className="h-3.5 w-3.5 mr-2" aria-hidden />
                  Visit {locale.toUpperCase()}
                </a>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
