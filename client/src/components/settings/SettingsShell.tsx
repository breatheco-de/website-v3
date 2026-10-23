import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useLocation } from "wouter";
import {
  IconArrowLeft,
  IconChartBar,
  IconInfoCircle,
  IconSearch,
  IconSettings,
  IconShield,
  IconSparkles,
  IconSpeakerphone,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DEFAULT_PRIVATE_HISTORY_FALLBACK,
  navigatePrivateHistoryBack,
} from "@/components/private/PrivateHistoryBackButton";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import type { SettingsSectionId } from "@/lib/settings-tab";

type IconComponent = ComponentType<{ className?: string }>;

const SETTINGS_SECTIONS: {
  id: SettingsSectionId;
  label: string;
  href: string;
  Icon: IconComponent;
  capability?: string;
  deniedHint?: string;
}[] = [
  { id: "general", label: "General", href: "/private/settings/locales", Icon: IconSettings },
  { id: "seo", label: "SEO/GEO", href: "/private/settings/seo", Icon: IconSearch },
  { id: "ads", label: "Ads", href: "/private/settings/ads", Icon: IconSpeakerphone },
  { id: "ai", label: "AI", href: "/private/settings/ai", Icon: IconSparkles },
  {
    id: "tracking",
    label: "Tracking",
    href: "/private/tracking",
    Icon: IconChartBar,
    capability: "metrics_view",
    deniedHint: "Needs metrics access",
  },
  { id: "security", label: "Security", href: "/private/security", Icon: IconShield },
];

// ── Unsaved-changes guard ───────────────────────────────────────────────────

const PAGE_DIRTY_ID = "page";

type SettingsGuard = {
  setDirty: (id: string, dirty: boolean) => void;
  /** Page-level unsaved state survives tab switches inside the page, so it only blocks leaving the page. */
  guard: (action: () => void, opts?: { leavingPage?: boolean }) => void;
};

const SettingsGuardContext = createContext<SettingsGuard | null>(null);

/** Register a panel's unsaved state so leaving the section or tab asks first. */
export function useSettingsDirty(dirty: boolean): void {
  const ctx = useContext(SettingsGuardContext);
  const id = useId();
  useEffect(() => {
    if (!ctx) return;
    ctx.setDirty(id, dirty);
    return () => ctx.setDirty(id, false);
  }, [ctx, id, dirty]);
}

/** Navigate within Settings: asks when a panel has unsaved edits and replaces history. */
export function useSettingsNavigate(): (href: string) => void {
  const ctx = useContext(SettingsGuardContext);
  const [, setLocation] = useLocation();
  return useCallback(
    (href: string) => {
      const go = () => setLocation(href, { replace: true });
      if (ctx) ctx.guard(go);
      else go();
    },
    [ctx, setLocation],
  );
}

// ── Shell ───────────────────────────────────────────────────────────────────

export type SettingsSecondaryTab<T extends string> = {
  id: T;
  label: string;
  href: string;
  Icon: IconComponent;
  disabled?: boolean;
};

export type SettingsSecondaryNav<T extends string> = {
  value: T;
  tabs: SettingsSecondaryTab<T>[];
  listTestId: string;
  triggerTestId: (id: T) => string;
};

export function SettingsShell<T extends string>({
  section,
  icon: TitleIcon,
  title,
  titleTestId,
  description,
  advanced,
  backTestId,
  dirty = false,
  secondary,
  children,
}: {
  section: SettingsSectionId;
  icon: IconComponent;
  title: ReactNode;
  titleTestId: string;
  description?: ReactNode;
  advanced?: ReactNode;
  backTestId: string;
  /** Unsaved state owned by the page component itself (panels below use `useSettingsDirty`). */
  dirty?: boolean;
  secondary?: SettingsSecondaryNav<T>;
  children: ReactNode;
}) {
  const [, setLocation] = useLocation();
  const { hasCapability } = useDebugAuth();
  const dirtyRef = useRef(new Map<string, boolean>());
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const guardValue = useMemo<SettingsGuard>(
    () => ({
      setDirty: (id, dirty) => {
        if (dirty) dirtyRef.current.set(id, true);
        else dirtyRef.current.delete(id);
      },
      guard: (action, opts) => {
        const leavingPage = opts?.leavingPage ?? true;
        const blocked = Array.from(dirtyRef.current.keys()).some((id) => leavingPage || id !== PAGE_DIRTY_ID);
        if (blocked) setPendingAction(() => action);
        else action();
      },
    }),
    [],
  );

  useEffect(() => {
    guardValue.setDirty(PAGE_DIRTY_ID, dirty);
    return () => guardValue.setDirty(PAGE_DIRTY_ID, false);
  }, [guardValue, dirty]);

  const navigate = useCallback(
    (href: string, leavingPage: boolean) =>
      guardValue.guard(() => setLocation(href, { replace: true }), { leavingPage }),
    [guardValue, setLocation],
  );

  const goBack = () =>
    guardValue.guard(() =>
      navigatePrivateHistoryBack({
        historyLength: window.history.length,
        historyBack: () => window.history.back(),
        navigate: setLocation,
        fallbackHref: DEFAULT_PRIVATE_HISTORY_FALLBACK,
      }),
    );

  return (
    <SettingsGuardContext.Provider value={guardValue}>
      <div className="min-h-screen bg-background text-foreground">
        <div className="max-w-7xl mx-auto px-4 pt-8 pb-24 space-y-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-4 min-w-0 flex-1">
                <Button type="button" variant="ghost" size="icon" aria-label="Go back" onClick={goBack} data-testid={backTestId}>
                  <IconArrowLeft className="h-5 w-5" />
                </Button>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <TitleIcon className="h-5 w-5 text-muted-foreground" />
                    <h1 className="text-2xl font-semibold tracking-tight" data-testid={titleTestId}>
                      {title}
                    </h1>
                    {advanced && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            aria-label="Read more (advanced)"
                            data-testid={`${titleTestId}-advanced-info`}
                          >
                            <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-80 space-y-2 text-xs text-muted-foreground leading-relaxed">
                          <p className="font-medium text-foreground text-sm">Read more (advanced)</p>
                          {advanced}
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  {description && <p className="text-sm text-muted-foreground">{description}</p>}
                </div>
              </div>

              <TooltipProvider delayDuration={200}>
                <ToggleButtonBar
                  className="shrink-0"
                  value={section}
                  onValueChange={(id) => {
                    const target = SETTINGS_SECTIONS.find((s) => s.id === id);
                    if (!target || target.id === section) return;
                    if (target.capability && !hasCapability(target.capability)) return;
                    navigate(target.href, true);
                  }}
                  listTestId="settings-primary-tablist"
                  listClassName="flex"
                >
                  {SETTINGS_SECTIONS.map(({ id, label, Icon, capability, deniedHint }) => {
                    const denied = !!capability && !hasCapability(capability);
                    const trigger = (
                      <ToggleButtonBarTrigger
                        key={id}
                        value={id}
                        disabled={denied}
                        data-testid={`tab-settings-${id}`}
                        className="gap-1.5"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </ToggleButtonBarTrigger>
                    );
                    if (!denied) return trigger;
                    return (
                      <Tooltip key={id}>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="inline-flex" data-testid={`tab-settings-${id}-denied`}>
                            {trigger}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{deniedHint}</TooltipContent>
                      </Tooltip>
                    );
                  })}
                </ToggleButtonBar>
              </TooltipProvider>
            </div>

            {secondary && (
              <div className="pb-3">
                <ToggleButtonBar
                  value={secondary.value}
                  onValueChange={(id) => {
                    const tab = secondary.tabs.find((t) => t.id === id);
                    if (!tab || tab.disabled || tab.id === secondary.value) return;
                    navigate(tab.href, false);
                  }}
                  listTestId={secondary.listTestId}
                  listClassName="inline-flex w-fit max-w-full"
                >
                  {secondary.tabs.map(({ id, label, Icon, disabled }) => (
                    <ToggleButtonBarTrigger
                      key={id}
                      value={id}
                      disabled={disabled}
                      data-testid={secondary.triggerTestId(id)}
                      className="gap-1.5"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </ToggleButtonBarTrigger>
                  ))}
                </ToggleButtonBar>
              </div>
            )}
          </div>

          {children}
        </div>
      </div>

      <AlertDialog open={pendingAction != null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent data-testid="dialog-settings-unsaved">
          <AlertDialogHeader>
            <AlertDialogTitle>You have unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              If you leave now, the edits on this page are discarded. Nothing that is already saved changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-settings-unsaved-stay">Stay</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-settings-unsaved-leave"
              onClick={() => {
                const action = pendingAction;
                setPendingAction(null);
                action?.();
              }}
            >
              Leave anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsGuardContext.Provider>
  );
}
