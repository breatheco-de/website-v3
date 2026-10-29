import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList, ExternalLink, PanelRightClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortalContainerProvider } from "@/components/ui/portal-container";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { AGENTS_PROPOSALS_BASE, ProposalDetailPanel } from "@/pages/ProposalsPage";
import type { VariantProposalLink } from "@/components/DebugBubble/types";

const EXPANDED_STORAGE_KEY = "proposal-review-drawer-expanded";
const WIDTH_STORAGE_KEY = "proposal-review-drawer-width";
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 320;
const MAX_WIDTH_RATIO = 0.8;

function clampWidth(width: number): number {
  const maxW = typeof window !== "undefined" ? window.innerWidth * MAX_WIDTH_RATIO : width;
  return Math.max(MIN_WIDTH, Math.min(maxW, width));
}

function readStoredWidth(): number {
  try {
    const parsed = parseInt(window.localStorage.getItem(WIDTH_STORAGE_KEY) ?? "", 10);
    if (!isNaN(parsed)) return clampWidth(parsed);
  } catch {
    /* private mode */
  }
  return DEFAULT_WIDTH;
}

function readStoredExpanded(): boolean {
  try {
    return window.localStorage.getItem(EXPANDED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function isOpenLink(link: VariantProposalLink | undefined): link is VariantProposalLink {
  return Boolean(
    link && link.local && (!link.status || link.status === "open" || link.status === "partial"),
  );
}

/**
 * Right-side drawer on a draft preview when that draft belongs to an open proposal: the proposal
 * page in its phone-width layout, collapsible to a rail. Sits above the site header and staff chrome;
 * only section/YAML editors (z-[9999]) and dialogs (z-[10000]+) cover it. Its popovers and menus
 * portal into the drawer, since their default z-50 on document.body would land behind it.
 */
export function ProposalReviewDrawer({
  contentType,
  slug,
  locale,
  variant,
  proposalParam,
  onReloadPreview,
  navigate,
}: {
  contentType: string;
  slug: string;
  locale: string;
  variant: string;
  /** `?proposal=` from "Review proposal": opens the drawer expanded. */
  proposalParam: string | null;
  onReloadPreview: () => void;
  navigate: (path: string) => void;
}) {
  const isNarrow = useIsMobile();
  const { data: versioning } = useQuery<{
    proposalsByVariant?: Record<string, Record<string, VariantProposalLink>>;
  } | null>({
    queryKey: ["/api/versioning", contentType, slug],
    queryFn: async () => {
      const res = await fetch(`/api/versioning/${encodeURIComponent(contentType)}/${encodeURIComponent(slug)}`);
      if (!res.ok) return null;
      return res.json();
    },
  });
  const link = versioning?.proposalsByVariant?.[locale]?.[variant];

  // Latched so the drawer stays after approve/reject (the draft link closes) until the reviewer closes it.
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!proposalId && isOpenLink(link)) setProposalId(link.id);
  }, [link, proposalId]);

  const [expanded, setExpanded] = useState(() => Boolean(proposalParam) || readStoredExpanded());
  useEffect(() => {
    if (isNarrow) setExpanded(false);
  }, [isNarrow]);
  const setExpandedPersisted = (next: boolean) => {
    setExpanded(next);
    if (isNarrow) return;
    try {
      window.localStorage.setItem(EXPANDED_STORAGE_KEY, String(next));
    } catch {
      /* private mode */
    }
  };

  const { data: detail } = useQuery<{ proposal?: { open_blocker_count?: number } }>({
    queryKey: ["/api/admin/proposals", proposalId],
    enabled: Boolean(proposalId),
  });
  const blockers = detail?.proposal?.open_blocker_count ?? 0;

  const [footerEl, setFooterEl] = useState<HTMLDivElement | null>(null);
  const [drawerEl, setDrawerEl] = useState<HTMLElement | null>(null);

  const [width, setWidth] = useState(readStoredWidth);
  const widthRef = useRef(width);
  widthRef.current = width;
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const handleMouseMove = (ev: MouseEvent) => {
      setWidth(clampWidth(startWidth + startX - ev.clientX));
    };
    const handleMouseUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      try {
        window.localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(widthRef.current)));
      } catch {
        /* private mode */
      }
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  if (!proposalId || dismissed) return null;

  const fullHref = `${AGENTS_PROPOSALS_BASE}/${encodeURIComponent(proposalId)}`;

  return (
    <>
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpandedPersisted(true)}
          className="fixed right-0 top-1/3 z-[9998] flex flex-col items-center gap-1.5 rounded-l-md border border-r-0 bg-card px-2 py-3 text-foreground shadow-lg hover-elevate"
          aria-label={`Open proposal review${blockers ? ` (${blockers} open blocker${blockers === 1 ? "" : "s"})` : ""}`}
          title="Proposal review"
          data-testid="button-proposal-drawer-rail"
        >
          <ClipboardList className="h-4 w-4 text-status-away" aria-hidden />
          {blockers > 0 ? (
            <span
              className="min-w-5 rounded-full bg-destructive px-1 text-center text-[10px] font-medium leading-5 text-destructive-foreground tabular-nums"
              data-testid="badge-proposal-drawer-rail-blockers"
            >
              {blockers}
            </span>
          ) : null}
        </button>
      ) : null}

      <aside
        ref={setDrawerEl}
        className={cn(
          "fixed right-0 top-0 bottom-0 z-[9998] flex w-full flex-col border-l bg-background shadow-xl md:w-[420px]",
          !expanded && "hidden",
        )}
        style={isNarrow ? undefined : { width: `${width}px` }}
        aria-label="Proposal review"
        data-testid="proposal-review-drawer"
      >
        {!isNarrow ? (
          <div
            className="absolute left-0 top-0 bottom-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-primary/20 active:bg-primary/30"
            onMouseDown={handleResizeStart}
            aria-hidden
            data-testid="proposal-drawer-resize-handle"
          />
        ) : null}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          {isNarrow ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-2"
              onClick={() => setExpandedPersisted(false)}
              data-testid="button-proposal-drawer-back"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to draft
            </Button>
          ) : (
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <ClipboardList className="h-4 w-4 shrink-0 text-status-away" aria-hidden />
              Proposal review
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button asChild size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-xs">
              <a href={fullHref} data-testid="link-proposal-drawer-full">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                Open full proposal
              </a>
            </Button>
            {!isNarrow ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => setExpandedPersisted(false)}
                aria-label="Collapse proposal review"
                title="Collapse"
                data-testid="button-proposal-drawer-collapse"
              >
                <PanelRightClose className="h-4 w-4" aria-hidden />
              </Button>
            ) : null}
          </div>
        </div>
        <PortalContainerProvider value={drawerEl}>
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-3">
            <ProposalDetailPanel
              key={proposalId}
              id={proposalId}
              layout="drawer"
              previewEntry={{ contentType, slug, locale, variant }}
              actionBarTarget={footerEl}
              onProposalChange={setProposalId}
              onReloadPreview={onReloadPreview}
              onViewLive={() =>
                navigate(`/private/preview/${encodeURIComponent(contentType)}/${encodeURIComponent(slug)}?locale=${encodeURIComponent(locale)}`)
              }
              onClose={() => setDismissed(true)}
            />
          </div>
          <div ref={setFooterEl} className="border-t bg-card empty:hidden" data-testid="proposal-drawer-footer" />
        </PortalContainerProvider>
      </aside>
    </>
  );
}
