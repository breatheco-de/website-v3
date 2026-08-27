import { useState, useEffect, useRef, useMemo, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { UniversalImage } from "@/components/UniversalImage";
import { getIcon } from "@/lib/icons";
import { useInternalNav } from "@/hooks/useInternalNav";
import { useSectionContext } from "@/contexts/SectionContext";
import { IconChevronRight, IconCheck, IconBookFilled } from "@tabler/icons-react";
import type { EnrollmentSelectorDefault, EnrollmentSelectorProgram, EnrollmentQueryComponentItem } from "@shared/schema";
import { addDays, addWeeks, addMonths } from "date-fns";
import { resolveColorVar, hslColor } from "@/components/course_selector/shared";
import { trackEcommerce, type EcommercePayload } from "@/lib/tracking";
import { ensureEcommerceProductLookup } from "@/lib/ecommerceProductMap";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { isCtaTrackingValue } from "@shared/component-behaviors";
// ─── Date chip sub-components ─────────────────────────────────────────────────
type DateChip = { text: string; color?: string };

function asChipList(chips: unknown): DateChip[] {
  return Array.isArray(chips) ? chips : [];
}

function selectionCardBadgeText(badge: unknown): string | null {
  if (!badge) return null;
  if (typeof badge === "string") return badge.trim() || null;
  if (typeof badge === "object" && badge !== null && "text" in badge) {
    const text = (badge as { text?: unknown }).text;
    return typeof text === "string" && text.trim() ? text : null;
  }
  return null;
}

function DateBadgeItem({ text, color, compact }: DateChip & { compact?: boolean }) {
  const resolved = resolveColorVar(color);
  return (
    <span
      className={
        compact
          ? "inline-flex items-center justify-center self-center shrink min-w-0 max-w-full text-[8.5px] font-bold leading-tight px-1 py-[2px] rounded-full text-center"
          : "inline-flex items-center justify-center self-center shrink-0 text-[10.5px] font-bold leading-none px-1.5 py-[3px] rounded-full whitespace-nowrap"
      }
      style={{
        background: hslColor(resolved, 0.12),
        color: hslColor(resolved, 1),
      }}
    >
      {text}
    </span>
  );
}

function DateTagItem({ text, color, compact }: DateChip & { compact?: boolean }) {
  return (
    <span
      className={
        compact
          ? "inline-flex items-center justify-center self-center shrink min-w-0 max-w-full text-[9px] font-medium leading-tight py-0 text-center"
          : "inline-flex items-center justify-center self-center shrink-0 text-[11.2px] font-medium leading-none py-0.5 whitespace-nowrap"
      }
      style={{
        color: color ? hslColor(resolveColorVar(color), 1) : "hsl(var(--muted-foreground))",
      }}
    >
      {text}
    </span>
  );
}

// ─── Date utils ───────────────────────────────────────────────────────────────

function advanceByInterval(d: Date, interval: number, unit: "days" | "weeks" | "months"): Date {
  if (unit === "days")  return addDays(d, interval);
  if (unit === "weeks") return addWeeks(d, interval);
  return addMonths(d, interval);
}

type DisplayDate = {
  label: string;
  year: string;
  badges: DateChip[];
  tags: DateChip[];
  url?: string;
  date_iso: string;
};

/** Selection fields for enrollment ecommerce dataLayer pushes (omit inapplicable keys). */
function buildEcommerceSelectionPayload(opts: {
  program: EnrollmentSelectorProgram | undefined;
  selectedPlanIdx: number;
  selectedDateIdx: number;
  displayDates: DisplayDate[];
  addonEnabled: boolean;
}): EcommercePayload {
  const path = typeof window !== "undefined" ? window.location.pathname : undefined;
  const base: EcommercePayload = {
    item_list_name: "enrollment_selector",
    component_type: "enrollment_selector",
    path,
  };
  const { program, selectedPlanIdx, selectedDateIdx, displayDates, addonEnabled } = opts;
  if (!program?.id) return base;

  base.program_id = program.id;

  const isDateMode = !!program.dates;
  const isPlanMode = !isDateMode && !!(program.plans?.length);

  if (isPlanMode && program.plans?.length) {
    const plan = program.plans[selectedPlanIdx] ?? program.plans[0];
    if (plan?.id) base.selected_plan_option = plan.id;
    if (plan?.amount?.trim()) base.amount = plan.amount;
    if (plan?.period?.trim()) base.period_label = plan.period;
  }

  if (isDateMode) {
    const date = displayDates[selectedDateIdx] ?? displayDates[0];
    if (date?.date_iso) base.cohort_date = date.date_iso;
    const priceAmount = program.summary?.price_amount;
    if (typeof priceAmount === "string" && priceAmount.trim()) {
      base.amount = priceAmount;
    }
  }

  if (program.addon?.id && addonEnabled) {
    base.addon_id = program.addon.id;
  }

  return base;
}

/** Current calendar date in UTC (YYYY-MM-DD) — identical on server and client. */
function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Deterministic date label: fixed page locale + UTC timezone, so SSR and client output match. */
function formatDateLabel(iso: string, locale: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString(locale || "en", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function generateIntervalDates(
  startIso: string,
  interval: number,
  unit: "days" | "weeks" | "months",
  locale: string,
  url?: string,
): DisplayDate[] {
  const todayIso = todayUtcIso();
  let current = new Date(startIso + "T00:00:00Z");
  while (current.toISOString().slice(0, 10) <= todayIso) {
    current = advanceByInterval(current, interval, unit);
  }
  const result: DisplayDate[] = [];
  for (let i = 0; i < 3; i++) {
    const iso = current.toISOString().slice(0, 10);
    result.push({
      label: formatDateLabel(iso, locale),
      year: String(current.getUTCFullYear()),
      badges: [],
      tags: [],
      url,
      date_iso: iso,
    });
    current = advanceByInterval(current, interval, unit);
  }
  return result;
}

// ─── Selectable tile styles ───────────────────────────────────────────────────

const TILE_BTN_BASE =
  "relative select-none border-[1.5px] outline-none cursor-pointer transition-[border-color,box-shadow,background] duration-200";

function tileStyle(active: boolean, flashing: boolean): React.CSSProperties {
  return {
    borderColor: (active || flashing) ? "hsl(var(--primary) / 0.55)" : "transparent",
    boxShadow: (active || flashing)
      ? "0 3px 10px hsl(var(--primary) / 0.1), 0 8px 22px hsl(var(--primary) / 0.07)"
      : "none",
    background: active ? "hsl(var(--card))" : "hsl(var(--muted-foreground) / 0.04)",
  };
}

// ─── Shared section blocks ────────────────────────────────────────────────────

function DateSelectorTiles({
  dates,
  selectedIdx,
  flashId,
  label,
  compact,
  onSelect,
}: {
  dates: DisplayDate[];
  selectedIdx: number;
  flashId: string | null;
  label: string;
  compact?: boolean;
  onSelect: (idx: number, url?: string) => void;
}) {
  return (
    <>
      <p
        className={
          compact
            ? "text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground mb-2"
            : "text-[10px] md:text-[12px] font-bold tracking-[1.5px] md:tracking-[1.8px] uppercase text-muted-foreground mb-2 md:mb-3.5"
        }
      >
        {label}
      </p>
      <div
        className={`grid ${
          compact
            ? "grid-cols-3 gap-1.5"
            : "grid-cols-3 md:grid-cols-1 lg:grid-cols-3 gap-1.5 md:gap-2"
        }`}
      >
        {dates.map((d, i) => {
          const active = selectedIdx === i;
          const fid = `date-${i}`;
          const flashing = flashId === fid;
          return (
            <button
              key={i}
              type="button"
              data-testid={`button-date-${i}`}
              className={`${TILE_BTN_BASE} ${
                compact
                  ? "text-center rounded-[8px] px-1.5 py-2 min-w-0"
                  : "text-center rounded-[10px] p-2 md:p-3"
              }`}
              style={tileStyle(active, flashing)}
              onClick={() => onSelect(i, d.url)}
            >
              <span
                className={
                  compact
                    ? "block text-[13px] font-extrabold leading-tight mb-0.5 transition-colors duration-200"
                    : "block text-[14px] md:text-[16px] font-extrabold mb-0.5 md:mb-1 transition-colors duration-200"
                }
                style={{ color: active ? "hsl(var(--primary))" : "hsl(var(--foreground))" }}
              >
                {d.label}
              </span>
              {(d.badges.length > 0 || d.tags.length > 0) && (
                <div className="flex w-full flex-wrap items-center justify-center content-center gap-x-0.5 gap-y-0.5">
                  {d.tags.map((tag, ti) => (
                    <DateTagItem key={`tag-${ti}`} {...tag} compact={compact} />
                  ))}
                  {d.badges.map((badge, bi) => (
                    <DateBadgeItem key={`badge-${bi}`} {...badge} compact={compact} />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

type BenefitItem = { icon?: string; title: string; desc: string };

function BenefitsList({
  benefits,
  label,
  compact,
}: {
  benefits: BenefitItem[];
  label: string;
  compact?: boolean;
}) {
  return (
    <>
      <p
        className={
          compact
            ? "text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground mb-2"
            : "text-[10px] md:text-[12px] font-bold tracking-[1.5px] md:tracking-[1.8px] uppercase text-muted-foreground mb-2.5 md:mb-4"
        }
      >
        {label}
      </p>
      <div className={compact ? "flex flex-col gap-2" : "flex flex-col gap-2.5 md:gap-3.5"}>
        {benefits.map((b, i) => {
          const BenefitIcon = b.icon ? getIcon(b.icon) : null;
          return (
            <div key={i} className="flex items-start gap-2 md:gap-3">
              <span
                className={
                  compact
                    ? "w-[20px] h-[20px] rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    : "w-[20px] h-[20px] md:w-[24px] md:h-[24px] rounded-full flex items-center justify-center shrink-0 mt-0.5"
                }
                style={{ background: "hsl(var(--color-green) / 0.15)" }}
              >
                {BenefitIcon ? (
                  <BenefitIcon size={compact ? 12 : 14} style={{ color: "hsl(var(--color-green))" }} />
                ) : (
                  <IconCheck
                    size={compact ? 12 : 14}
                    stroke={2.5}
                    style={{ color: "hsl(var(--color-green))" }}
                  />
                )}
              </span>
              <div>
                <p className={compact ? "text-[12px] font-semibold text-foreground leading-snug" : "text-[13px] md:text-[14px] font-semibold text-foreground"}>
                  {b.title}
                </p>
                <p className={compact ? "text-[11px] text-muted-foreground leading-snug" : "text-[11px] md:text-[12px] text-muted-foreground leading-relaxed"}>
                  {b.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

type AddonConfig = NonNullable<EnrollmentSelectorProgram["addon"]>;
type EnrollmentPlan = NonNullable<EnrollmentSelectorProgram["plans"]>[number];

/** Priority: ?plan=<id> → plan.default === true → first plan */
function resolvePlanIdx(
  plans: EnrollmentPlan[] | undefined,
  planQs: string | null,
): number {
  if (!plans?.length) return 0;
  if (planQs) {
    const fromQs = plans.findIndex((p) => p.id === planQs);
    if (fromQs !== -1) return fromQs;
  }
  const fromDefault = plans.findIndex((p) => p.default === true);
  if (fromDefault !== -1) return fromDefault;
  return 0;
}

function planQsFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("plan");
}

/** Remove stale callback_label_* from the page QS (labels are only sent on CTA click). */
function clearCallbackLabelsFromUrl() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("callback_label_en") && !params.has("callback_label_es")) return;
  params.delete("callback_label_en");
  params.delete("callback_label_es");
  const qs = params.toString();
  history.replaceState(
    null,
    "",
    window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
  );
}

/** Querystring link navigated when the toggle turns ON (defaults to ?addon=<id>) */
function addonOnUrl(addon: AddonConfig): string {
  return addon.on?.url ?? `?addon=${addon.id}`;
}

/** Querystring link navigated when the toggle turns OFF (defaults to ?addon=) */
function addonOffUrl(addon: AddonConfig): string {
  return addon.off?.url ?? "?addon=";
}

function AddonToggleRow({
  addon,
  enabled,
  compact,
  onToggle,
}: {
  addon: AddonConfig;
  enabled: boolean;
  compact?: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const badgeText = selectionCardBadgeText(addon.badge);
  return (
    <div className={compact ? "mt-3 pt-3 border-t border-border" : "mt-4 pt-4 border-t border-border md:mt-5 md:pt-5"}>
      <div className="flex items-start justify-between gap-3 md:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5 md:mb-1">
            <span className={compact ? "text-[12px] font-bold text-foreground" : "text-[13px] md:text-[15px] font-bold text-foreground"}>
              {addon.label}
            </span>
            {badgeText && (
              <span
                className="inline-flex items-center text-[9px] md:text-[10px] font-bold leading-none px-1.5 py-[3px] rounded-full whitespace-nowrap"
                style={{
                  background: "hsl(var(--primary) / 0.12)",
                  color: "hsl(var(--primary))",
                }}
              >
                {badgeText}
              </span>
            )}
          </div>
          {(addon.description || addon.on?.added_label) && (
            <p className={compact ? "text-[11px] text-muted-foreground leading-snug" : "text-[11px] md:text-[12px] text-muted-foreground leading-relaxed"}>
              {addon.description}
              {addon.on?.added_label && (
                <span
                  className={`inline-flex items-center gap-1 text-[9px] md:text-[10px] font-bold leading-none px-1.5 py-[3px] rounded-full whitespace-nowrap align-middle ml-1.5 transition-opacity duration-200 ${
                    enabled ? "opacity-100" : "opacity-0"
                  }`}
                  aria-hidden={!enabled}
                  style={{
                    background: "hsl(var(--color-green) / 0.15)",
                    color: "hsl(var(--color-green))",
                  }}
                  data-testid="badge-addon-added"
                >
                  <IconCheck size={10} stroke={3} />
                  {addon.on.added_label}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          <span className="text-[11px] md:text-[12px] text-muted-foreground font-medium">
            {enabled ? "On" : "Off"}
          </span>
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            aria-label={addon.label}
            data-testid="switch-addon"
          />
        </div>
      </div>
    </div>
  );
}

function UnlocksList({ unlocks }: { unlocks: { icon?: string; text: string }[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {unlocks.map((item, i) => {
        const UnlockIcon = item.icon ? getIcon(item.icon) : null;
        return (
          <div key={i} className="flex items-start gap-2">
            <span
              className="w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center mt-[3px]"
              style={{ background: "hsl(var(--color-green))" }}
            >
              {UnlockIcon ? (
                <UnlockIcon size={8} className="text-white" />
              ) : (
                <IconCheck size={8} className="text-white" stroke={3} />
              )}
            </span>
            <span className="text-[11px] text-foreground/80 font-medium leading-snug">
              {item.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** PathItem-like card for programs[].query_component (no DnD / tools / skill bars). */
function QueryComponentBadgesMarquee({
  badges,
  resolved,
}: {
  badges: string[];
  resolved: ReturnType<typeof resolveColorVar>;
}) {
  const duration = Math.max(5, badges.length * 1.8);
  const copies = 8;
  const pct = (100 / copies).toFixed(6);
  return (
    <>
      <style>{`
        @keyframes query-badges-loop {
          from { transform: translateX(0); }
          to   { transform: translateX(-${pct}%); }
        }
      `}</style>
      <div
        style={{
          position: "relative",
          height: 26,
          overflow: "hidden",
          WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)",
          maskImage: "linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)",
          marginBottom: 10,
        }}
      >
        <div
          className="mt-0.5"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            display: "flex",
            animation: `query-badges-loop ${duration}s linear infinite`,
          }}
        >
          {Array.from({ length: copies }, (_, ci) =>
            badges.map((badge, bi) => (
              <span
                key={`${ci}-${bi}`}
                style={{
                  fontFamily: "'SF Mono','Fira Code',monospace",
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "3px 8px",
                  borderRadius: "9999px",
                  whiteSpace: "nowrap",
                  color: hslColor(resolved, 1),
                  background: hslColor(resolved, 0.1),
                  marginRight: 5,
                  flexShrink: 0,
                }}
              >
                {badge}
              </span>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function QueryComponentCard({
  item,
  viewDetailsLabel = "View details",
}: {
  item: EnrollmentQueryComponentItem;
  viewDetailsLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);
  const [hovered, setHovered] = useState(false);

  const resolved = resolveColorVar(item.color ?? "hsl(var(--primary))");
  const ItemIcon = item.icon ? getIcon(item.icon) : null;
  const bullets = item.bullets ?? [];
  const badges = item.badges ?? [];
  const showBadgesCollapsed = item.show_badges_collapsed === true && badges.length > 0;
  const showBadgesMarquee = badges.length > 0;

  const pathCardShadow = hovered
    ? `0 3px 10px ${hslColor(resolved, 0.13)}, 0 8px 22px ${hslColor(resolved, 0.08)}`
    : "0 1px 4px rgba(0,0,0,0.09), 0 4px 14px rgba(0,0,0,0.07)";

  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    setExpanded((x) => !x);
  };

  const viewDetailsBtn = (opts?: { className?: string; size?: "sm" | "md" }) => {
    const size = opts?.size ?? "sm";
    return (
      <div
        className={
          opts?.className ??
          (size === "md"
            ? "inline-flex items-center gap-[5px] text-[12px] font-semibold px-[11px] py-[5px] rounded-[8px] cursor-pointer select-none transition-all duration-150 whitespace-nowrap flex-shrink-0"
            : "inline-flex items-center gap-[4px] text-[10px] md:text-[12px] font-semibold px-[9px] md:px-[11px] py-[4px] md:py-[5px] rounded-[8px] cursor-pointer select-none transition-all duration-150 whitespace-nowrap flex-shrink-0")
        }
        style={{
          color: hslColor(resolved, 1),
          background: "transparent",
          border: `1.5px solid ${hslColor(resolved, 0.45)}`,
          borderRadius: 8,
          transform: btnHovered ? "scale(1.04)" : "scale(1)",
        }}
        onClick={toggle}
        onMouseEnter={() => setBtnHovered(true)}
        onMouseLeave={() => setBtnHovered(false)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((x) => !x);
          }
        }}
      >
        {viewDetailsLabel}
        <span
          className={
            size === "md"
              ? "text-[12px] leading-none transition-transform duration-200"
              : "text-[11px] md:text-[12px] leading-none transition-transform duration-200"
          }
          style={{ display: "inline-block", transform: expanded ? "rotate(180deg)" : "none" }}
        >
          ▾
        </span>
      </div>
    );
  };

  const collapsedBadges = (
    <div className="flex flex-wrap items-center gap-[5px] min-w-0">
      {badges.slice(0, 4).map((badge, badgeIdx) => (
        <span
          key={badge}
          className={`text-[9px] md:text-[10px] font-semibold px-[6px] md:px-[7px] py-[2px] rounded-full whitespace-nowrap ${badgeIdx >= 3 ? "hidden md:inline-flex" : "inline-flex"}`}
          style={{
            color: hslColor(resolved, 1),
            background: hslColor(resolved, 0.1),
            transition: "opacity 160ms ease 60ms, transform 200ms cubic-bezier(.4,0,.8,1) 0ms",
            opacity: expanded ? 0 : 1,
            transform: expanded ? "translateY(145px) scale(0.6)" : "translateY(0) scale(1)",
          }}
        >
          {badge}
        </span>
      ))}
    </div>
  );

  const hrsPill = item.hrs ? (
    <div
      className="text-[9px] md:text-[10px] px-[6px] py-[2px] rounded-full font-semibold whitespace-nowrap"
      style={{ color: hslColor(resolved, 1), background: hslColor(resolved, 0.12) }}
    >
      {item.hrs}
    </div>
  ) : null;

  return (
    <div
      className="relative w-full my-[4px] md:my-[6px] rounded-[13px]"
      style={{
        background: "hsl(var(--background))",
        border: "2px solid transparent",
        boxShadow: pathCardShadow,
        transform: hovered ? "translateY(-2px)" : "none",
        transition: "transform 180ms ease, box-shadow 200ms",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid="enrollment-query-component-card"
    >
      {/* Mobile: hrs top-right */}
      {item.hrs && (
        <div className={`${showBadgesCollapsed ? "md:hidden" : "sm:hidden"} absolute top-3 right-3 z-20`}>
          {hrsPill}
        </div>
      )}

      {showBadgesCollapsed ? (
        /* PathItem-like layout when collapsed badges are enabled */
        <div className="flex flex-col gap-2 md:gap-3 px-3 pt-3 pb-2.5 md:px-[15px] md:pt-[14px] md:pb-[12px] md:flex-row md:items-start md:gap-[10px]">
          <div className="flex-1 min-w-0 w-full">
            <div className={`flex items-start gap-[6px] mb-[4px] w-full ${item.hrs ? "pr-16" : ""} md:pr-0`}>
              <div className="shrink-0 scale-90 md:scale-100 origin-top-left">
                {ItemIcon ? (
                  <ItemIcon size={17} style={{ color: hslColor(resolved, 1) }} />
                ) : (
                  <IconBookFilled size={17} style={{ color: hslColor(resolved, 1) }} />
                )}
              </div>
              <div
                className="font-inter text-[15.5px] md:text-[18px] leading-[1.3] pb-[2px] flex-1 min-w-0"
                style={{ color: "hsl(var(--foreground))", fontWeight: 700 }}
              >
                {item.name}
              </div>
            </div>
            {item.tagline && (
              <div
                className={`font-inter text-[13px] md:text-[15px] leading-[1.4] mb-[8px] w-full ${item.hrs ? "pr-16" : ""} md:pr-0 md:pl-[23px]`}
                style={{ color: "hsl(var(--muted-foreground) / 0.75)", fontWeight: 400 }}
              >
                {item.tagline}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 w-[calc(100%+1.5rem)] -mx-3 px-3 md:mx-0 md:w-full md:px-0 md:pl-[23px] md:justify-start">
              {collapsedBadges}
              {viewDetailsBtn({
                className:
                  "md:hidden inline-flex items-center gap-[5px] text-[12px] font-semibold px-[11px] py-[5px] rounded-[8px] cursor-pointer select-none transition-all duration-150 whitespace-nowrap flex-shrink-0",
                size: "md",
              })}
            </div>
          </div>

          <div className="hidden md:flex md:flex-col md:items-end md:justify-between md:w-auto flex-shrink-0 md:self-stretch">
            {hrsPill}
            {viewDetailsBtn({ size: "md" })}
          </div>
        </div>
      ) : (
        /* Default collapsed layout (no badges under tagline) */
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 px-3 pt-3 pb-2.5 md:px-[15px] md:pt-[14px] md:pb-[12px]">
          <div className="flex-1 min-w-0 w-full flex flex-col justify-center">
            <div className={`flex items-center gap-[6px] mb-[4px] w-full ${item.hrs ? "pr-16" : ""} sm:pr-0`}>
              <div className="shrink-0 scale-90 md:scale-100 origin-top-left">
                {ItemIcon ? (
                  <ItemIcon size={17} style={{ color: hslColor(resolved, 1) }} />
                ) : (
                  <IconBookFilled size={17} style={{ color: hslColor(resolved, 1) }} />
                )}
              </div>
              <div
                className="font-inter text-[15.5px] md:text-[18px] leading-[1.3] pb-[2px] flex-1 min-w-0"
                style={{ color: "hsl(var(--foreground))", fontWeight: 700 }}
              >
                {item.name}
              </div>
            </div>
            {item.tagline && (
              <div
                className={`font-inter text-[13px] md:text-[15px] leading-[1.4] w-full ${item.hrs ? "pr-16" : ""} sm:pr-0 md:pl-[23px]`}
                style={{ color: "hsl(var(--muted-foreground) / 0.75)", fontWeight: 400 }}
              >
                {item.tagline}
              </div>
            )}
            <div className="flex sm:hidden items-center justify-end gap-3 mt-2">
              {viewDetailsBtn({
                className:
                  "inline-flex items-center gap-[5px] text-[12px] font-semibold px-[11px] py-[5px] rounded-[8px] cursor-pointer select-none transition-all duration-150 whitespace-nowrap flex-shrink-0",
                size: "md",
              })}
            </div>
          </div>

          <div className="hidden sm:flex flex-col items-end justify-center gap-2 flex-shrink-0">
            {hrsPill}
            {viewDetailsBtn()}
          </div>
        </div>
      )}

      <div
        className="overflow-hidden transition-all duration-300"
        style={{
          maxHeight: expanded ? 400 : 0,
          borderTop: `1px solid ${hslColor(resolved, expanded ? 0.15 : 0)}`,
        }}
      >
        <div className="px-3 md:px-[15px] pb-[10px] pt-[10px] flex flex-col gap-2">
          <div className="flex flex-col gap-2">
            {bullets.map((b, i) => {
              const BulletIcon = b.icon ? getIcon(b.icon) : null;
              return (
                <div key={i} className="flex items-start gap-2">
                  <span
                    className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center mt-[1px]"
                    style={{ background: hslColor(resolved, 0.12) }}
                  >
                    {BulletIcon ? (
                      <BulletIcon size={10} style={{ color: hslColor(resolved, 1) }} />
                    ) : (
                      <IconCheck size={10} style={{ color: hslColor(resolved, 1) }} stroke={3} />
                    )}
                  </span>
                  <span
                    className="text-[12px] md:text-[13px] font-medium leading-snug"
                    style={{ color: "hsl(var(--foreground) / 0.85)" }}
                  >
                    {b.text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {showBadgesMarquee && <QueryComponentBadgesMarquee badges={badges} resolved={resolved} />}
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EnrollmentSelectorDefault({ data }: { data: EnrollmentSelectorDefault }) {
  const callbackLabelsRef = useRef<{ en?: string; es?: string }>({});
  const nav = useInternalNav({
    appendCallback: true,
    getCallbackLabels: () => callbackLabelsRef.current,
  });
  const { locale } = useSectionContext();
  const editMode = useEditModeOptional();
  const isEditMode = editMode?.isEditMode ?? false;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listViewedRef = useRef(false);
  const selectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrateDoneRef = useRef(false);

  const [selectedProgramIdx, setSelectedProgramIdx] = useState(0);
  const [selectedDateIdx, setSelectedDateIdx] = useState(0);
  const [selectedPlanIdx, setSelectedPlanIdx] = useState(0);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [filteredByQs, setFilteredByQs] = useState(false);
  const [addonEnabled, setAddonEnabled] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionPayloadRef = useRef<EcommercePayload>({
    item_list_name: "enrollment_selector",
    component_type: "enrollment_selector",
  });

  useEffect(() => {
    ensureEcommerceProductLookup();
  }, []);

  // Mark hydrate complete after initial URL sync effect has a chance to run
  useEffect(() => {
    const t = setTimeout(() => {
      hydrateDoneRef.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // On mount: read ?program, ?plan, ?cohort and ?addon from URL
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const programQs = params.get("program");
    const planQs = params.get("plan");
    let activeIdx = 0;
    if (programQs) {
      const idx = data.programs.findIndex((p) => p.id === programQs);
      if (idx !== -1) {
        activeIdx = idx;
        setSelectedProgramIdx(idx);
        setFilteredByQs(true);
      }
    }
    const activeProgram = data.programs[activeIdx];
    const planIdx = resolvePlanIdx(activeProgram?.plans, planQs);
    setSelectedPlanIdx(planIdx);
    clearCallbackLabelsFromUrl();
    const addon = activeProgram?.addon;
    if (addon) {
      const onParams = new URLSearchParams(addonOnUrl(addon).replace(/^\?/, ""));
      let matches = false;
      onParams.forEach((v, k) => {
        if (params.get(k) === v && v !== "") matches = true;
      });
      if (matches) setAddonEnabled(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const program = data.programs[selectedProgramIdx] ?? data.programs[0];
  const isDateMode = !!program?.dates;
  const isPlanMode = !isDateMode && !!(program?.plans?.length);

  const queryComponentItem = useMemo((): EnrollmentQueryComponentItem | null => {
    const qc = program?.query_component;
    if (!qc?.param || !qc.items?.length) return null;
    if (typeof window === "undefined") return null;
    const qsValue = new URLSearchParams(window.location.search).get(qc.param);
    if (!qsValue) return null;
    return qc.items.find((i) => (Array.isArray(i.value) ? i.value : [i.value]).includes(qsValue)) ?? null;
  }, [program]);

  const queryComponentBlock =
    queryComponentItem && program?.query_component ? (
      <div className="mb-4">
        {program.query_component.label && (
          <p className="text-[10px] md:text-[12px] font-bold tracking-[1.5px] md:tracking-[1.8px] uppercase text-muted-foreground mb-2 md:mb-3.5">
            {program.query_component.label}
          </p>
        )}
        <QueryComponentCard
          item={queryComponentItem}
          viewDetailsLabel={program.query_component.view_details_label ?? "View details"}
        />
      </div>
    ) : null;

  // Build list of upcoming dates for date-mode
  const displayDates = useMemo<DisplayDate[]>(() => {
    if (!program?.dates) return [];
    if (program.dates.mode === "static") {
      const todayIso = todayUtcIso();
      return program.dates.items
        .filter((item) => item.date_iso >= todayIso)
        .sort((a, b) => a.date_iso.localeCompare(b.date_iso))
        .slice(0, 3)
        .map((item) => ({
          label: item.label ?? formatDateLabel(item.date_iso, locale),
          year: item.year ?? item.date_iso.slice(0, 4),
          badges: asChipList(item.badges),
          tags: asChipList(item.tags),
          url: item.url,
          date_iso: item.date_iso,
        }));
    }
    return generateIntervalDates(
      program.dates.start_date_iso,
      program.dates.interval,
      program.dates.interval_unit,
      locale,
      program.dates.url,
    );
  }, [program, locale]);

  // Preselect date from ?cohort querystring once dates are resolved
  useEffect(() => {
    if (!isDateMode || !program?.dates || program.dates.mode !== "static") return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const cohortQs = params.get("cohort");
    if (!cohortQs) return;
    const matchIdx = program.dates.items.findIndex((item) => item.url?.includes(cohortQs));
    if (matchIdx !== -1) {
      const iso = program.dates.items[matchIdx].date_iso;
      const displayIdx = displayDates.findIndex((d) => d.date_iso === iso);
      if (displayIdx !== -1) setSelectedDateIdx(displayIdx);
    }
  }, [program, isDateMode, displayDates]);

  const plan = isPlanMode && program?.plans ? program.plans[selectedPlanIdx] : null;
  const activeSummary = plan?.summary ?? program?.summary;
  const activeBenefits = plan?.benefits?.length ? plan.benefits : (program?.benefits ?? []);
  const activeUnlocks = plan?.unlocks?.length ? plan.unlocks : (program?.unlocks ?? []);

  selectionPayloadRef.current = buildEcommerceSelectionPayload({
    program,
    selectedPlanIdx,
    selectedDateIdx,
    displayDates,
    addonEnabled,
  });

  // view_item_list once when visible
  useEffect(() => {
    if (isEditMode || listViewedRef.current || !rootRef.current) return;
    const el = rootRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || listViewedRef.current) return;
        listViewedRef.current = true;
        trackEcommerce("view_item_list", selectionPayloadRef.current);
        obs.disconnect();
      },
      { threshold: 0.2 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [isEditMode, data.programs]);

  const trackSelectItem = (
    nextProgram: EnrollmentSelectorProgram,
    nextPlanIdx: number,
  ) => {
    if (!hydrateDoneRef.current || isEditMode || !nextProgram.id) return;
    if (selectDebounceRef.current) clearTimeout(selectDebounceRef.current);
    selectDebounceRef.current = setTimeout(() => {
      let nextDates: DisplayDate[] = [];
      if (nextProgram.dates?.mode === "static") {
        const todayIso = todayUtcIso();
        nextDates = nextProgram.dates.items
          .filter((item) => item.date_iso >= todayIso)
          .sort((a, b) => a.date_iso.localeCompare(b.date_iso))
          .slice(0, 3)
          .map((item) => ({
            label: item.label ?? formatDateLabel(item.date_iso, locale),
            year: item.year ?? item.date_iso.slice(0, 4),
            badges: asChipList(item.badges),
            tags: asChipList(item.tags),
            url: item.url,
            date_iso: item.date_iso,
          }));
      } else if (nextProgram.dates) {
        nextDates = generateIntervalDates(
          nextProgram.dates.start_date_iso,
          nextProgram.dates.interval,
          nextProgram.dates.interval_unit,
          locale,
          nextProgram.dates.url,
        );
      }
      trackEcommerce(
        "select_item",
        buildEcommerceSelectionPayload({
          program: nextProgram,
          selectedPlanIdx: nextPlanIdx,
          selectedDateIdx: 0,
          displayDates: nextDates,
          addonEnabled: false,
        }),
      );
    }, 300);
  };

  // Source of truth for CTA callback labels (not the page URL).
  callbackLabelsRef.current = {
    en: plan?.callback_label_en ?? program?.callback_label_en,
    es: plan?.callback_label_es ?? program?.callback_label_es,
  };

  function triggerFlash(id: string) {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashId(id);
    flashTimer.current = setTimeout(() => setFlashId(null), 220);
  }

  function handleDateSelect(idx: number, url?: string) {
    const fid = `date-${idx}`;
    triggerFlash(fid);
    setSelectedDateIdx(idx);
    if (url) nav.navigate(url);
  }

  function handleAddonToggle(checked: boolean) {
    setAddonEnabled(checked);
    const addon = program?.addon;
    if (!addon) return;
    nav.navigate(checked ? addonOnUrl(addon) : addonOffUrl(addon));
  }

  /** Ensure the current (default) selection's query params are in the URL
   *  before the CTA link resolves its {qs:} tokens / appends callback.
   *  Uses history.replaceState under the hood for `?` URLs, so it causes no re-render.
   *  Callback labels are not written to the page URL — only attached on CTA click. */
  function applySelectionParams() {
    const d = displayDates[selectedDateIdx];
    if (d?.url) nav.navigate(d.url);
    const addon = program?.addon;
    if (addon) nav.navigate(addonEnabled ? addonOnUrl(addon) : addonOffUrl(addon));
  }

  const sectionCls =
    "bg-card border border-border rounded-[0.8rem] p-3 mb-3 md:p-5 md:mb-4 shadow-[0_1px_4px_rgba(0,0,0,0.06),0_4px_16px_rgba(0,0,0,0.05)]";
  const sectionClsLast =
    "bg-card border border-border rounded-[0.8rem] p-3 md:p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06),0_4px_16px_rgba(0,0,0,0.05)]";
  const summaryInsetCls = "rounded-[0.8rem] p-2.5 mb-3 md:p-3.5 md:mb-4";
  const chooseDateLabel = data.choose_date_label ?? "Choose your start date";
  const includedLabel = data.included_label ?? "What's included";

  if (!program || !activeSummary) return null;

  const programCardRendered = !filteredByQs && data.programs.length > 1;

  const plansAttachToProgramCard =
    programCardRendered && isPlanMode && !!program?.plans?.length;

  const ctaVariantMap: Record<string, "default" | "secondary" | "outline"> = {
    primary: "default",
    secondary: "secondary",
    outline: "outline",
  };

  return (
    <div ref={rootRef} data-testid="section-enrollment-selector">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_370px] gap-4 md:gap-8 lg:gap-12 items-start">

        {/* ── LEFT COLUMN ── */}
        <div>
          {data.eyebrow && (
            <p className="text-[9px] md:text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground mb-1.5 md:mb-2.5">
              {data.eyebrow}
            </p>
          )}

          <h1 className="font-inter font-black tracking-tight text-foreground leading-[1.1] mb-2 md:mb-3">
            <div
              className="block md:hidden text-[34px] leading-[1.1]"
              dangerouslySetInnerHTML={{
                __html: (data.title || "")
                  .replace(/font-size\s*:[^;"]*(;)?/g, "")
                  .replace(/<br\s*\/?>/gi, " "),
              }}
            />
            <div
              className="hidden md:block leading-[1.1]"
              dangerouslySetInnerHTML={{ __html: data.title || "" }}
            />
          </h1>

          {program.description && (
            <p className="text-[13px] md:text-[14px] text-muted-foreground leading-relaxed mb-5 md:mb-9">
              {program.description}
            </p>
          )}

          {/* PROGRAM SELECTOR */}
          {!filteredByQs && data.programs.length > 1 ? (
            <div className={sectionCls}>
              <p className="text-[10px] md:text-[12px] font-bold tracking-[1.5px] md:tracking-[1.8px] uppercase text-muted-foreground mb-2 md:mb-3.5">
                {data.choose_program_label ?? "Choose your program"}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3 gap-1.5 md:gap-2">
                {data.programs.map((prog, i) => {
                  const active = selectedProgramIdx === i;
                  const fid = `prog-${i}`;
                  const flashing = flashId === fid;
                  const programBadge = selectionCardBadgeText(prog.selection_card.badge);
                  const ProgramIcon = prog.selection_card.icon
                    ? getIcon(prog.selection_card.icon)
                    : null;
                  return (
                    <button
                      key={prog.id}
                      type="button"
                      data-testid={`button-program-${prog.id}`}
                      className={`${TILE_BTN_BASE} text-left rounded-[10px] px-3 py-3.5 md:p-3.5`}
                      style={tileStyle(active, flashing)}
                      onClick={() => {
                        triggerFlash(fid);
                        setSelectedProgramIdx(i);
                        setSelectedDateIdx(0);
                        const nextPlanIdx = resolvePlanIdx(prog.plans, planQsFromUrl());
                        setSelectedPlanIdx(nextPlanIdx);
                        if (addonEnabled && program?.addon) {
                          nav.navigate(addonOffUrl(program.addon));
                        }
                        setAddonEnabled(false);
                        trackSelectItem(prog, nextPlanIdx);
                      }}
                    >
                      {active && (
                        <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-primary" />
                      )}
                      <div className="flex items-center justify-between gap-2 pr-5 sm:block sm:pr-4">
                        <span
                          className="flex items-center gap-1.5 min-w-0 text-[14px] sm:text-[15px] font-extrabold sm:mb-1 md:justify-center lg:justify-start transition-colors duration-200"
                          style={{ color: active ? "hsl(var(--primary))" : "hsl(var(--foreground))" }}
                        >
                          {ProgramIcon && <ProgramIcon size={16} className="shrink-0" />}
                          <span className="truncate">{prog.selection_card.name}</span>
                        </span>
                        <span className="flex items-center gap-1 shrink-0 text-[12px] sm:text-[13px] text-muted-foreground sm:mt-0 md:justify-center lg:justify-start">
                          {prog.selection_card.duration}
                          {programBadge && (
                            <DateBadgeItem text={programBadge} color="primary" />
                          )}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {plansAttachToProgramCard && program.plans && (
                <div className="md:hidden mt-4 pt-4 border-t border-border">
                  <PlanSelectorBlock
                    plans={program.plans}
                    label={data.choose_plan_label ?? "Choose your plan"}
                    selectedPlanIdx={selectedPlanIdx}
                    flashId={flashId}
                    onSelect={(i) => {
                      triggerFlash(`plan-${i}`);
                      setSelectedPlanIdx(i);
                    }}
                  />
                </div>
              )}

              {/* MOBILE: addon toggle at the bottom of the program card (below plans if present) */}
              {program.addon && (
                <div className="md:hidden">
                  <AddonToggleRow
                    addon={program.addon}
                    enabled={addonEnabled}
                    onToggle={handleAddonToggle}
                  />
                </div>
              )}
            </div>
          ) : null}

          {/* DATE SELECTOR — desktop only */}
          {isDateMode && displayDates.length > 0 && (
            <div className={`${sectionCls} hidden md:block`}>
              {filteredByQs && (
                <div className="mb-4 pb-4 border-b border-border">
                  <ProgramFilteredHeader program={program} />
                </div>
              )}
              <DateSelectorTiles
                dates={displayDates}
                selectedIdx={selectedDateIdx}
                flashId={flashId}
                label={chooseDateLabel}
                onSelect={handleDateSelect}
              />
            </div>
          )}

          {/* Query card sits above the plan/program section cards, not inside them */}
          {isPlanMode && queryComponentBlock}

          {/* PLAN SELECTOR */}
          {isPlanMode && program.plans && (
            <div className={plansAttachToProgramCard ? `${sectionCls} hidden md:block` : sectionCls}>
              {filteredByQs && (
                <>
                  <div className="mb-3 md:hidden">
                    <ProgramFilteredHeader program={program} metaFirst />
                  </div>
                  <div className="mb-4 pb-4 border-b border-border hidden md:block">
                    <ProgramFilteredHeader program={program} />
                  </div>
                </>
              )}
              <PlanSelectorBlock
                plans={program.plans}
                label={data.choose_plan_label ?? "Choose your plan"}
                selectedPlanIdx={selectedPlanIdx}
                flashId={flashId}
                onSelect={(i) => {
                  triggerFlash(`plan-${i}`);
                  setSelectedPlanIdx(i);
                }}
              />
            </div>
          )}

          {/* BENEFITS — desktop only */}
          {(activeBenefits.length > 0 || program.addon) && (
            <div className={`${sectionClsLast} hidden md:block`}>
              {activeBenefits.length > 0 && (
                <BenefitsList benefits={activeBenefits} label={includedLabel} />
              )}
              {program.addon && (
                <AddonToggleRow
                  addon={program.addon}
                  enabled={addonEnabled}
                  onToggle={handleAddonToggle}
                />
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN (sticky) ── */}
        <div className="relative md:sticky md:top-[72px]">
          {filteredByQs && isDateMode && (
            <div className="md:hidden mb-3">
              <ProgramFilteredHeader program={program} metaFirst />
            </div>
          )}
          <div className="bg-card border border-border rounded-[0.8rem] overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06),0_4px_16px_rgba(0,0,0,0.05)]">

            {/* SUMMARY HEADER */}
            <div className="bg-primary px-3 py-3.5 md:px-5 md:py-5">
              <p
                className="text-[10px] md:text-[10px] font-bold tracking-[2px] uppercase mb-1 md:mb-1.5"
                style={{ color: "hsl(var(--primary-foreground) / 0.6)" }}
              >
                {activeSummary.price_label}
              </p>
              <p className="font-inter text-[33px] md:text-[42px] font-extrabold leading-none tracking-tight mb-0.5 md:mb-1 text-primary-foreground">
                {activeSummary.price_amount}
                {activeSummary.price_period && (
                  <span
                    className="text-[16px] md:text-[18px] font-bold ml-1"
                    style={{ color: "hsl(var(--primary-foreground) / 0.7)" }}
                  >
                    {activeSummary.price_period}
                  </span>
                )}
              </p>
              {activeSummary.price_sub && (
                <p
                  className="text-[12px] md:text-[12px]"
                  style={{ color: "hsl(var(--primary-foreground) / 0.6)" }}
                >
                  {activeSummary.price_sub}
                </p>
              )}
            </div>

            <div className="px-3 pt-4 pb-3 md:p-5">
              {/* MOBILE: date selector above summary rows */}
              {isDateMode && displayDates.length > 0 && (
                <div
                  className="md:hidden rounded-[0.8rem] p-2.5 mb-4 md:p-3.5 md:mb-4"
                  style={{ background: "hsl(var(--muted-foreground) / 0.03)" }}
                >
                  <DateSelectorTiles
                    dates={displayDates}
                    selectedIdx={selectedDateIdx}
                    flashId={flashId}
                    label={chooseDateLabel}
                    compact
                    onSelect={handleDateSelect}
                  />
                </div>
              )}

              {/* SUMMARY ROWS */}
              <div className="flex flex-col divide-y divide-border mb-3 md:mb-4">
                {activeSummary.rows.map((row, i) => {
                  let dynamicValue: string | null = null;
                  let accent = false;

                  if (row.show_dynamic_program && program) {
                    dynamicValue = program.selection_card.name;
                    accent = true;
                  } else if (row.show_dynamic_addon && program?.addon) {
                    dynamicValue = addonEnabled
                      ? (program.addon.on?.summary_value ?? "")
                      : (program.addon.off?.summary_value ?? "");
                    accent = addonEnabled;
                  } else if (row.show_dynamic_date) {
                    if (isDateMode && displayDates.length > 0) {
                      const d = displayDates[selectedDateIdx];
                      dynamicValue = d ? `${d.label}, ${d.year}` : "TBD";
                    } else if (isPlanMode && plan) {
                      dynamicValue = plan.name;
                    }
                  }

                  const isDynamic = dynamicValue !== null;
                  const baseValue =
                    addonEnabled && row.value_with_addon ? row.value_with_addon : row.value;
                  const value = dynamicValue ?? baseValue ?? "";

                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between py-1.5 md:py-2.5 text-[12px] md:text-[12px]"
                    >
                      <span className="text-muted-foreground">{row.label}</span>
                      {isDynamic ? (
                        <span
                          className="font-semibold text-right text-[13px] md:text-[13px]"
                          style={{
                            color: accent
                              ? "hsl(var(--primary))"
                              : "hsl(var(--foreground))",
                          }}
                        >
                          {value}
                        </span>
                      ) : (
                        <RichTextContent
                          html={value}
                          className="font-semibold text-right text-[13px] md:text-[13px] text-foreground [&_p]:m-0 [&_p]:text-[13px] md:[&_p]:text-[13px] [&_p]:font-semibold [&_p]:leading-none max-w-none"
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* MOBILE: benefits (replaces unlocks). Addon lives in the program card when it renders */}
              <div className="md:hidden">
                {(activeBenefits.length > 0 || (program.addon && !programCardRendered)) && (
                  <div
                    className={summaryInsetCls}
                    style={{ background: "hsl(var(--muted-foreground) / 0.03)" }}
                  >
                    {activeBenefits.length > 0 && (
                      <BenefitsList benefits={activeBenefits} label={includedLabel} compact />
                    )}
                    {program.addon && !programCardRendered && (
                      <AddonToggleRow
                        addon={program.addon}
                        enabled={addonEnabled}
                        compact
                        onToggle={handleAddonToggle}
                      />
                    )}
                  </div>
                )}
              </div>

              {/* DESKTOP: unlocks */}
              {activeUnlocks.length > 0 && (
                <div
                  className={`hidden md:block ${summaryInsetCls}`}
                  style={{ background: "hsl(var(--muted-foreground) / 0.03)" }}
                >
                  <p className="text-[10px] font-bold tracking-[1.8px] uppercase text-muted-foreground mb-3">
                    You unlock right now
                  </p>
                  <UnlocksList unlocks={activeUnlocks} />
                </div>
              )}

              {/* CTA */}
              <Button
                className="w-full text-[13px] md:text-[14px] font-extrabold mb-2 md:mb-2.5"
                variant={ctaVariantMap[activeSummary.cta.variant] ?? "default"}
                size="lg"
                data-testid="button-enrollment-cta"
                asChild
              >
                <a
                  href={activeSummary.cta.url}
                  onClick={(e) => {
                    // Apply selection (cohort/addon) before resolve — including ctrl/cmd+click.
                    if (e.button === 0 && !e.altKey) applySelectionParams();
                    const tracking = (activeSummary.cta as { tracking?: string }).tracking;
                    if (isCtaTrackingValue(tracking) && tracking !== "none") {
                      trackEcommerce(tracking, selectionPayloadRef.current);
                    }
                    nav(e);
                  }}
                  onMouseDown={(e) => {
                    if (e.button === 1) applySelectionParams();
                    nav.onMouseDown(e);
                  }}
                >
                  {activeSummary.cta.text}
                  <IconChevronRight size={16} stroke={2.5} />
                </a>
              </Button>

              {/* TRUST NOTE */}
              {activeSummary.trust_note && (
                <div className="border border-border rounded-[0.8rem] p-2.5 md:p-3 flex items-start gap-2 md:gap-2.5 mt-1.5 md:mt-2">
                  {activeSummary.trust_note.image_id ? (
                    <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
                      <UniversalImage
                        id={activeSummary.trust_note.image_id}
                        alt={activeSummary.trust_note.initials}
                        className="w-full h-full"
                        sizes="32px"
                      />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px] font-extrabold shrink-0">
                      {activeSummary.trust_note.initials}
                    </div>
                  )}
                  <p
                    className="text-[11px] text-muted-foreground leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: activeSummary.trust_note.message }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-component: plan selector ─────────────────────────────────────────────

function PlanSelectorBlock({
  plans,
  label,
  selectedPlanIdx,
  flashId,
  className,
  onSelect,
}: {
  plans: NonNullable<EnrollmentSelectorProgram["plans"]>;
  label: string;
  selectedPlanIdx: number;
  flashId: string | null;
  className?: string;
  onSelect: (idx: number) => void;
}) {
  return (
    <div className={className}>
      <p className="text-[10px] md:text-[12px] font-bold tracking-[1.5px] md:tracking-[1.8px] uppercase text-muted-foreground mb-2 md:mb-3.5">
        {label}
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 md:gap-3">
        {plans.map((p: EnrollmentPlan, i) => {
          const active = selectedPlanIdx === i;
          const fid = `plan-${i}`;
          const flashing = flashId === fid;
          return (
            <button
              key={p.id}
              type="button"
              data-testid={`button-plan-${p.id}`}
              className={`${TILE_BTN_BASE} w-full text-left rounded-[10px] py-2 px-2.5 md:rounded-[12px] md:py-2.5 md:px-3.5`}
              style={tileStyle(active, flashing)}
              onClick={() => onSelect(i)}
            >
              {active && (
                <span className="absolute top-2.5 right-2.5 hidden md:block w-2 h-2 rounded-full bg-primary" />
              )}
              <div className="flex items-start justify-between gap-2 mb-0.5 md:mb-1">
                <div className="flex min-w-0 items-start gap-1">
                  <span
                    className="text-[14px] md:text-[15px] font-extrabold leading-tight transition-colors duration-200"
                    style={{
                      color: active ? "hsl(var(--primary))" : "hsl(var(--foreground))",
                    }}
                  >
                    {p.name}
                  </span>
                  {p.tag && (
                    <span
                      className="text-[8px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full shrink-0"
                      style={{
                        background: p.featured
                          ? "hsl(var(--primary) / 0.12)"
                          : "hsl(var(--muted))",
                        color: p.featured
                          ? "hsl(var(--primary))"
                          : "hsl(var(--muted-foreground))",
                      }}
                    >
                      {p.tag}
                    </span>
                  )}
                </div>
                {p.tagline && (
                  <p className="md:hidden shrink-0 max-w-[55%] text-[10px] text-muted-foreground text-right leading-tight">
                    {p.tagline}
                  </p>
                )}
              </div>
              {p.tagline && (
                <p className="hidden md:block text-[11px] text-muted-foreground mb-2 leading-tight">
                  {p.tagline}
                </p>
              )}
              <div className="flex items-end justify-between gap-2">
                <div className="flex items-end gap-px min-w-0">
                  <span
                    className="text-[11px] md:text-[12px] font-extrabold mb-0.5 transition-colors duration-200"
                    style={{
                      color: active ? "hsl(var(--primary))" : "hsl(var(--foreground))",
                    }}
                  >
                    {p.currency}
                  </span>
                  <span
                    className="text-[19px] md:text-[26px] font-extrabold leading-none tracking-tight transition-colors duration-200"
                    style={{
                      color: active ? "hsl(var(--primary))" : "hsl(var(--foreground))",
                    }}
                  >
                    {p.amount}
                  </span>
                  <span className="text-[10px] md:text-[11px] ml-0.5 mb-0.5 font-medium text-muted-foreground">
                    {p.period}
                  </span>
                </div>
                {p.billing_note && (
                  <p className="text-[10px] md:text-[11px] text-muted-foreground shrink-0 text-right leading-tight">
                    {p.billing_note}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sub-component: filtered program header ───────────────────────────────────

function ProgramFilteredHeader({
  program,
  metaFirst,
}: {
  program: EnrollmentSelectorProgram;
  metaFirst?: boolean;
}) {
  const ProgramIcon = program.selection_card.icon
    ? getIcon(program.selection_card.icon)
    : null;
  const programBadge = selectionCardBadgeText(program.selection_card.badge);
  return (
    <div
      className={
        metaFirst
          ? "flex flex-col-reverse items-start gap-1.5"
          : "flex flex-col items-start gap-1.5 lg:flex-row lg:items-center lg:justify-between lg:gap-3"
      }
    >
      <h2 className="font-inter flex min-w-0 items-center gap-2 text-[28px] md:text-[30px] font-bold tracking-tight text-foreground leading-[1.1]">
        {ProgramIcon && (
          <ProgramIcon size={26} className="shrink-0 text-primary" />
        )}
        <span className="min-w-0">{program.selection_card.name}</span>
      </h2>
      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground lg:shrink-0 lg:justify-end lg:gap-2 lg:text-[14px]">
        <span className="lg:whitespace-nowrap">{program.selection_card.duration}</span>
        {programBadge && (
          <DateBadgeItem text={programBadge} color="primary" />
        )}
      </div>
    </div>
  );
}
