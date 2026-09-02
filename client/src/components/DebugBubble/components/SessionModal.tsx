import { useEffect, useState } from "react";
import { Check, Copy, LogOut, ChevronDown } from "lucide-react";
import { IconRefresh, IconShield } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getConsumerToken, clearConsumerToken } from "@/hooks/useAuthUser";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { useSession } from "@/contexts/SessionContext";
import { useToast } from "@/hooks/use-toast";
import { CAPABILITY_REGISTRY } from "@shared/capabilities";
import { cn } from "@/lib/utils";

const BUILT_IN_ROLE_LABELS: Record<string, string> = {
  webmaster: "Webmaster (deprecated)",
  user_admin: "User Admin",
  platform_steward: "Platform Steward",
  platform_ops: "Platform Ops",
  metrics_viewer: "Metrics Viewer",
  content_viewer: "Content Viewer",
};

function capabilityLabel(name: string): string {
  return CAPABILITY_REGISTRY.find((c) => c.name === name)?.label ?? name;
}

function roleLabel(roleId: string): string {
  return BUILT_IN_ROLE_LABELS[roleId] ?? roleId;
}
interface SessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: any;
  hasToken: boolean;
  getDebugToken: () => string | null;
  getDebugUserName: () => string | null;
  clearToken: () => void;
  handleCheckSession: () => void;
  isCheckingSession: boolean;
}

interface SessionTokenCardProps {
  title: string;
  token: string | null;
  onLogout: () => void;
  testIdPrefix: string;
}

function SessionTokenCard({ title, token, onLogout, testIdPrefix }: SessionTokenCardProps) {
  const [copied, setCopied] = useState(false);
  const active = !!token;

  return (
    <div className="rounded-md border p-3 space-y-2" data-testid={`card-${testIdPrefix}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h4 className="text-sm font-semibold text-foreground truncate">{title}</h4>
          {active ? (
            <Badge
              className="border-transparent bg-status-online/15 text-status-online"
              data-testid={`badge-${testIdPrefix}-status`}
            >
              Active
            </Badge>
          ) : (
            <Badge variant="secondary" data-testid={`badge-${testIdPrefix}-status`}>
              Inactive
            </Badge>
          )}
        </div>
        {active && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onLogout}
            title={`Log out (destroy ${title.toLowerCase()} token)`}
            data-testid={`button-${testIdPrefix}-logout`}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      </div>
      {active ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground flex-shrink-0">Token</span>
          <code
            className="flex-1 bg-muted px-2 py-1.5 rounded text-xs font-mono truncate"
            data-testid={`text-${testIdPrefix}-token`}
          >
            {token}
          </code>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 flex-shrink-0"
            onClick={() => {
              navigator.clipboard.writeText(token!);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            data-testid={`button-${testIdPrefix}-copy`}
          >
            {copied ? (
              <Check className="h-4 w-4 text-status-online" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No active session.</p>
      )}
    </div>
  );
}

export function SessionModal(props: SessionModalProps) {
  const {
    open,
    onOpenChange,
    session,
    hasToken,
    getDebugToken,
    getDebugUserName,
    clearToken,
    handleCheckSession,
    isCheckingSession,
  } = props;

  // Consumer token kept in state so logout re-renders the card immediately.
  const [consumerToken, setConsumerTokenState] = useState<string | null>(() => getConsumerToken());
  const debugToken = hasToken ? getDebugToken() : null;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rolesCapsOpen, setRolesCapsOpen] = useState(false);
  const [isClearingGeo, setIsClearingGeo] = useState(false);
  const { roles, capabilities, isValidated } = useDebugAuth();
  const { refreshGeo } = useSession();
  const { toast } = useToast();

  // Re-read on open in case the user logged in/out since the modal mounted.
  useEffect(() => {
    if (open) setConsumerTokenState(getConsumerToken());
  }, [open]);

  async function handleClearGeoCache() {
    setIsClearingGeo(true);
    try {
      await refreshGeo();
      toast({
        title: "Geo cache cleared",
        description: "Session and overlay geo were re-fetched from /api/geo.",
      });
    } catch {
      toast({
        title: "Could not refresh geo",
        description: "Clear failed. Try again or reload the page.",
        variant: "destructive",
      });
    } finally {
      setIsClearingGeo(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Session Data{getDebugUserName() ? ` - ${getDebugUserName()}` : ''}</DialogTitle>
          <DialogDescription>
            Current session values captured from browser, geolocation, and URL parameters.
          </DialogDescription>
        </DialogHeader>

        <div
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1"
          data-testid="session-cookie-education"
        >
          <p>
            Consumer marketing context is stored in cookie <code className="text-foreground">4g_ctx</code>,
            and the consumer login token in <code className="text-foreground">4g_tok</code>.
            Both use a parent Domain (e.g. <code className="text-foreground">.4geeks.com</code>) so sibling
            subdomains such as learn can read them. Staff debug tokens stay in{" "}
            <code className="text-foreground">localStorage</code> only and are not shared that way.
          </p>
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-0 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                data-testid="button-session-cookie-advanced"
              >
                {advancedOpen ? "Hide advanced" : "Read more (advanced)"}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1 space-y-1">
              <p>
                Source of truth: cookies only (not dual localStorage). One-time migration clears legacy{" "}
                <code className="text-foreground">4geeks_session</code> and{" "}
                <code className="text-foreground">4g_auth_token</code> keys.
              </p>
              <p>
                Paths: <code className="text-foreground">shared/session.ts</code>,{" "}
                <code className="text-foreground">client/src/lib/sessionCookie.ts</code>,{" "}
                <code className="text-foreground">client/src/lib/sessionBootstrap.ts</code>,{" "}
                <code className="text-foreground">client/src/hooks/useAuthUser.ts</code>,{" "}
                <code className="text-foreground">client/src/workers/session.worker.ts</code>.
                Size guard slims <code className="text-foreground">4g_ctx</code> if encoded value exceeds ~3500 bytes.
                This site still sends <code className="text-foreground">Authorization: Token …</code> from{" "}
                <code className="text-foreground">4g_tok</code>; APIs do not auto-trust the cookie alone.
              </p>
            </CollapsibleContent>
          </Collapsible>
        </div>
        
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <SessionTokenCard
              title="Staff Session"
              token={debugToken}
              onLogout={clearToken}
              testIdPrefix="staff-session"
            />

            <SessionTokenCard
              title="Consumer Session"
              token={consumerToken}
              onLogout={() => {
                clearConsumerToken();
                setConsumerTokenState(null);
              }}
              testIdPrefix="consumer-session"
            />
          </div>

          <Collapsible
            open={rolesCapsOpen}
            onOpenChange={setRolesCapsOpen}
            className="rounded-md border border-border p-3 space-y-2"
            data-testid="session-staff-roles-capabilities"
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left hover-elevate rounded-sm -m-1 p-1"
                data-testid="button-session-roles-capabilities-toggle"
              >
                <IconShield className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold text-foreground shrink-0">
                    Staff roles &amp; capabilities
                  </h4>
                  {!rolesCapsOpen && hasToken && isValidated !== false && (
                    <div className="flex flex-wrap gap-1" data-testid="session-staff-roles-collapsed">
                      {roles.length > 0 ? (
                        roles.map((roleId) => (
                          <Badge
                            key={roleId}
                            variant="secondary"
                            className="text-xs font-mono"
                            title={roleId}
                            data-testid={`badge-session-role-${roleId}`}
                          >
                            {roleLabel(roleId)}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">No roles assigned</span>
                      )}
                    </div>
                  )}
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
                    rolesCapsOpen && "rotate-180",
                  )}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2.5 pt-1">
              {!hasToken || isValidated === false ? (
                <p className="text-xs text-muted-foreground">
                  Sign in with a staff token to see your assigned roles and capabilities.
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Roles</p>
                    <div className="flex flex-wrap gap-1.5" data-testid="session-staff-roles">
                      {roles.length > 0 ? (
                        roles.map((roleId) => (
                          <Badge
                            key={roleId}
                            variant="secondary"
                            className="text-xs font-mono"
                            title={roleId}
                            data-testid={`badge-session-role-expanded-${roleId}`}
                          >
                            {roleLabel(roleId)}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">No roles assigned</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Capabilities</p>
                    <div
                      className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto"
                      data-testid="session-staff-capabilities"
                    >
                      {capabilities.length > 0 ? (
                        capabilities.map((cap) => (
                          <Badge
                            key={cap.name}
                            variant="outline"
                            className="text-xs font-mono"
                            title={
                              Array.isArray(cap.contentTypes)
                                ? `${cap.name} (${cap.contentTypes.join(", ")})`
                                : cap.contentTypes === "*"
                                  ? `${cap.name} (all content types)`
                                  : cap.name
                            }
                            data-testid={`badge-session-cap-${cap.name}`}
                          >
                            {capabilityLabel(cap.name)}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">No capabilities</span>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Roles are assigned in Security → Staff Users. Capability list is effective grants from
                    those roles (see{" "}
                    <code className="font-mono text-foreground">shared/capabilities.ts</code>).
                  </p>
                </>
              )}
            </CollapsibleContent>
          </Collapsible>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-foreground">Geolocation</h4>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px] text-muted-foreground"
                onClick={handleClearGeoCache}
                disabled={isClearingGeo}
                title="Clear session + overlay geo caches and re-fetch /api/geo"
                data-testid="button-clear-geo-cache"
              >
                <IconRefresh className={`h-3 w-3 mr-1 ${isClearingGeo ? "animate-spin" : ""}`} />
                {isClearingGeo ? "Clearing…" : "Clear geo cache"}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Country:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.geo?.country || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">City:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.geo?.city || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Region:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.geo?.region || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Timezone:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.geo?.timezone || 'N/A'}</code>
              </div>
            </div>
          </div>
          
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">Device</h4>
            <div className="grid grid-cols-2 gap-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Category:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.device?.deviceCategory || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">OS:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.device?.osFamily || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Browser:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.device?.browserFamily || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Viewport:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.device?.viewportWidth}x{session.device?.viewportHeight}</code>
              </div>
              <div className="flex justify-between col-span-2">
                <span className="text-muted-foreground">Pixel Ratio:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.device?.devicePixelRatio || 'N/A'}</code>
              </div>
            </div>
          </div>
          
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">UTM Parameters</h4>
            <div className="space-y-1 text-sm">
              {(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_placement', 'utm_plan'] as const).map(key => (
                <div key={key} className="flex justify-between">
                  <span className="text-muted-foreground">{key}:</span>
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.utm?.[key] || '—'}</code>
                </div>
              ))}
            </div>
          </div>
          
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">Tracking</h4>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">PPC Tracking ID:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs max-w-[150px] truncate">{session.utm?.ppc_tracking_id || '—'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Referral:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.utm?.referral || session.utm?.ref || '—'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Coupon:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.utm?.coupon || '—'}</code>
              </div>
            </div>
          </div>
          
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">Session Info</h4>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">User ID:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs max-w-[180px] truncate" title={session.userId} data-testid="text-user-id">{session.userId || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Language:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.language}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Browser Lang:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.browserLang || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Location Campus:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.location?.slug || 'N/A'}</code>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Landing page:</span>
                <code
                  className="bg-muted px-1.5 py-0.5 rounded text-xs max-w-[220px] truncate"
                  title={session.landing_page}
                  data-testid="text-landing-page"
                >
                  {session.landing_page || '—'}
                </code>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Conversion page:</span>
                <code
                  className="bg-muted px-1.5 py-0.5 rounded text-xs max-w-[220px] truncate"
                  title={session.conversion_page}
                  data-testid="text-conversion-page"
                >
                  {session.conversion_page || '—'}
                </code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Initialized:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.initialized ? 'Yes' : 'No'}</code>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleCheckSession}
            disabled={isCheckingSession}
            data-testid="button-session-refresh"
            title="Check session validity"
          >
            <IconRefresh className={`h-4 w-4 ${isCheckingSession ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-close-session-modal"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
