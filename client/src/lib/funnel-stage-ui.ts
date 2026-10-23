import type { ComponentType } from "react";
import {
  IconSchool,
  IconShoppingCart,
  IconSpeakerphone,
  IconTarget,
} from "@tabler/icons-react";
import type { FunnelStage } from "@shared/funnel";

export type FunnelStageTaper = "full" | "mid" | "narrow" | "tight";

export const FUNNEL_STAGE_TAPER: Record<FunnelStage, FunnelStageTaper> = {
  awareness: "full",
  consideration: "mid",
  decision: "narrow",
  "post-enrollment": "tight",
};

export const FUNNEL_STAGE_LABEL: Record<FunnelStage, string> = {
  awareness: "Awareness",
  consideration: "Consideration",
  decision: "Decision",
  "post-enrollment": "Post-enrollment",
};

/** Who the page is for and what page stats measure it on. */
export const FUNNEL_STAGE_DESCRIPTION: Record<FunnelStage, string> = {
  awareness: "New, broad audience. Judged on how many visitors move on to another step.",
  consideration: "People comparing options. Judged on how many later reach a decision page.",
  decision: "Ready to apply or buy. Judged on leads submitted on this page.",
  "post-enrollment": "Current students. Judged on clicks to the learning platform and other tasks.",
};

export const FUNNEL_STAGE_ICON: Record<FunnelStage, ComponentType<{ className?: string }>> = {
  awareness: IconSpeakerphone,
  consideration: IconTarget,
  decision: IconShoppingCart,
  "post-enrollment": IconSchool,
};

/** Background + border tones for funnel stage blocks (product journey + Funnel tab). */
export const FUNNEL_STAGE_TONE: Record<FunnelStageTaper, string> = {
  full: "bg-primary/15 border-primary/25",
  mid: "bg-chart-3/15 border-chart-3/25",
  narrow: "bg-chart-2/15 border-chart-2/25",
  tight: "bg-muted/40 border-border",
};

export const FUNNEL_STAGE_ICON_TONE: Record<FunnelStageTaper, string> = {
  full: "text-primary",
  mid: "text-chart-3",
  narrow: "text-chart-2",
  tight: "text-muted-foreground",
};

export const FUNNEL_STAGE_SELECTED_RING: Record<FunnelStageTaper, string> = {
  full: "ring-primary/45",
  mid: "ring-chart-3/45",
  narrow: "ring-chart-2/45",
  tight: "ring-foreground/20",
};

/** Visual width taper on the product journey page (top → bottom of funnel). */
export const FUNNEL_TAPER_WIDTH: Record<FunnelStageTaper, string> = {
  full: "w-full",
  mid: "w-[88%] max-w-full",
  narrow: "w-[76%] max-w-full",
  tight: "w-[64%] max-w-full",
};
