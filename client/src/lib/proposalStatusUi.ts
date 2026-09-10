import type { ComponentType } from "react";
import {
  IconBan,
  IconCircleCheck,
  IconCircleDot,
  IconCircleHalf,
  IconCircleX,
} from "@tabler/icons-react";

export type ProposalStatus = "open" | "partial" | "finished" | "rejected" | "withdrawn";

export type ProposalStatusUi = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Classes for icon + label text */
  className: string;
  /** Left accent border on list cards */
  accentClassName: string;
  /** Tinted background + icon color for the round status chip */
  chipClassName: string;
};

/** Standardized status icon + color for proposal list and detail. */
export const PROPOSAL_STATUS_UI: Record<ProposalStatus, ProposalStatusUi> = {
  open: {
    label: "Open",
    icon: IconCircleDot,
    className: "text-primary",
    accentClassName: "border-l-primary",
    chipClassName: "bg-primary/10 text-primary",
  },
  partial: {
    label: "Partial",
    icon: IconCircleHalf,
    className: "text-status-away",
    accentClassName: "border-l-status-away",
    chipClassName: "bg-status-away/10 text-status-away",
  },
  finished: {
    label: "Finished",
    icon: IconCircleCheck,
    className: "text-status-online",
    accentClassName: "border-l-status-online",
    chipClassName: "bg-status-online/10 text-status-online",
  },
  rejected: {
    label: "Rejected",
    icon: IconCircleX,
    className: "text-destructive",
    accentClassName: "border-l-destructive",
    chipClassName: "bg-destructive/10 text-destructive",
  },
  withdrawn: {
    label: "Withdrawn",
    icon: IconBan,
    className: "text-muted-foreground",
    accentClassName: "border-l-muted-foreground/40",
    chipClassName: "bg-muted text-muted-foreground",
  },
};

export function proposalStatusUi(status: string): ProposalStatusUi {
  if (status in PROPOSAL_STATUS_UI) {
    return PROPOSAL_STATUS_UI[status as ProposalStatus];
  }
  return {
    label: status || "Unknown",
    icon: IconCircleDot,
    className: "text-muted-foreground",
    accentClassName: "border-l-muted-foreground/40",
    chipClassName: "bg-muted text-muted-foreground",
  };
}
