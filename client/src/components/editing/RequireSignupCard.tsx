import { useQuery } from "@tanstack/react-query";
import {
  IconUserPlus,
  IconAlertTriangle,
  IconExternalLink,
  IconPencil,
  IconTargetArrow,
} from "@tabler/icons-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { isSignupFieldMapReady, type AuthSignupFieldMapEntry } from "@shared/authSignupFieldMap";
import {
  DEFAULT_LOGIN_EVENT_NAME,
  DEFAULT_SIGNUP_EVENT_NAME,
} from "@shared/authConversionEvents";
import type { TrackingSettingsResponse } from "@/lib/tracking";

interface AuthSettingsResponse {
  host?: string;
  login?: { url?: string; path?: string };
  signup?: { path?: string; field_map?: AuthSignupFieldMapEntry[] };
  profile?: { path?: string };
  signup_configured: boolean;
  signup_field_map_ready?: boolean;
}

export interface RequireSignupCardProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** When false, guests may only log in (no account create). Default true. */
  allowSignup?: boolean;
  onAllowSignupChange?: (allow: boolean) => void;
  /** Hide the entire card (e.g. conversion goal is signup). */
  hidden?: boolean;
  /** Force gate on — staff cannot turn it off. */
  forceEnabled?: boolean;
  /**
   * full — Require account + allow signups.
   * loginSimplified — gate always on; only Allow new signups (login conversion goal).
   */
  mode?: "full" | "loginSimplified";
  testIdPrefix?: string;
}

function ConversionEventBadge({
  name,
  muted,
  testId,
}: {
  name: string;
  muted?: boolean;
  testId?: string;
}) {
  return (
    <Badge
      variant="secondary"
      className={`font-mono text-[10px] font-normal gap-1 px-1.5 py-0 h-5 bg-muted text-muted-foreground border-0 ${
        muted ? "opacity-50 line-through" : ""
      }`}
      data-testid={testId}
    >
      <IconTargetArrow className="h-2.5 w-2.5 shrink-0" aria-hidden />
      {name}
    </Badge>
  );
}

/**
 * Account gate for forms: Require account + optional allow new signups.
 * When site auth / field_map is not ready and allowSignup is true, the switch is disabled.
 */
export function RequireSignupCard({
  enabled,
  onChange,
  allowSignup = true,
  onAllowSignupChange,
  hidden = false,
  forceEnabled = false,
  mode = "full",
  testIdPrefix = "form-require-signup",
}: RequireSignupCardProps) {
  const { data: authSettings, isLoading } = useQuery<AuthSettingsResponse>({
    queryKey: ["/api/settings/auth"],
  });
  const { data: trackingSettings } = useQuery<TrackingSettingsResponse>({
    queryKey: ["/api/settings/tracking"],
  });

  const signupEventName =
    trackingSettings?.signup_event_name?.trim() || DEFAULT_SIGNUP_EVENT_NAME;
  const loginEventName =
    trackingSettings?.login_event_name?.trim() || DEFAULT_LOGIN_EVENT_NAME;

  const configured = authSettings?.signup_configured === true;
  const mapReady =
    authSettings?.signup_field_map_ready === true ||
    isSignupFieldMapReady(authSettings?.signup?.field_map);
  const needsFieldMap = allowSignup !== false;
  const canEnable = forceEnabled || (configured && (!needsFieldMap || mapReady));
  const disabled = isLoading || forceEnabled || (!canEnable && !enabled);
  const loginSimplified = mode === "loginSimplified";
  const gateOn = loginSimplified || enabled || forceEnabled;

  if (hidden) return null;

  const eventNamesRow = gateOn ? (
    <p
      className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1"
      data-testid={`text-${testIdPrefix}-event-names`}
    >
      <span>Fires</span>
      <ConversionEventBadge
        name={signupEventName}
        muted={allowSignup === false}
        testId={`badge-${testIdPrefix}-signup-event`}
      />
      <span>on signup{allowSignup === false ? " (login only)" : ""},</span>
      <ConversionEventBadge
        name={loginEventName}
        testId={`badge-${testIdPrefix}-login-event`}
      />
      <span>on login.</span>
      <a
        href="/private/store/conversions#signup-login-events"
        className="underline hover:no-underline inline-flex items-center gap-0.5 shrink-0"
        data-testid={`link-${testIdPrefix}-edit-events`}
      >
        Edit
        <IconPencil className="h-3 w-3" />
      </a>
    </p>
  ) : null;

  return (
    <div
      className="rounded-md border bg-muted/20 p-3 space-y-3 overflow-hidden w-full min-w-0"
      data-testid={`card-${testIdPrefix}`}
    >
      {!loginSimplified && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <IconUserPlus className="h-4 w-4 text-muted-foreground shrink-0" />
            <Label
              htmlFor={`switch-${testIdPrefix}`}
              className="text-sm font-medium truncate"
            >
              Require account
            </Label>
          </div>
          <Switch
            id={`switch-${testIdPrefix}`}
            checked={gateOn}
            disabled={disabled}
            onCheckedChange={onChange}
            data-testid={`switch-${testIdPrefix}`}
          />
        </div>
      )}

      {loginSimplified && (
        <div className="flex items-center gap-2 min-w-0">
          <IconUserPlus className="h-4 w-4 text-muted-foreground shrink-0" />
          <p className="text-sm font-medium" data-testid={`text-${testIdPrefix}-login-title`}>
            Login goal
          </p>
        </div>
      )}

      {eventNamesRow}

      {gateOn && onAllowSignupChange && (
        <div className="flex items-center justify-between gap-3 pl-1">
          <div className="min-w-0 space-y-0.5">
            <Label
              htmlFor={`switch-${testIdPrefix}-allow-signup`}
              className="text-sm font-medium"
            >
              Allow new signups
            </Label>
            <p className="text-xs text-muted-foreground">
              {allowSignup !== false
                ? "Guests can create an account or log in."
                : "Existing accounts only — new visitors cannot sign up on this form."}
            </p>
          </div>
          <Switch
            id={`switch-${testIdPrefix}-allow-signup`}
            checked={allowSignup !== false}
            disabled={false}
            onCheckedChange={onAllowSignupChange}
            data-testid={`switch-${testIdPrefix}-allow-signup`}
          />
        </div>
      )}

      {!isLoading && needsFieldMap && !configured ? (
        <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
          <IconAlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p data-testid={`text-${testIdPrefix}-unconfigured`}>
            Signup is not configured for this site yet.{" "}
            <a
              href="/private/security/auth"
              className="underline hover:no-underline inline-flex items-center gap-0.5"
              data-testid={`link-${testIdPrefix}-settings`}
            >
              Set it up in Security first
              <IconExternalLink className="h-3 w-3" />
            </a>
            {enabled
              ? " — this form has the flag set, but signup will not run until auth is configured."
              : ""}
          </p>
        </div>
      ) : !isLoading && needsFieldMap && configured && !mapReady ? (
        <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
          <IconAlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p data-testid={`text-${testIdPrefix}-empty-map`}>
            Signup field map is empty.{" "}
            <a
              href="/private/security/auth"
              className="underline hover:no-underline inline-flex items-center gap-0.5"
              data-testid={`link-${testIdPrefix}-field-map`}
            >
              Add field mappings in Consumer Auth
              <IconExternalLink className="h-3 w-3" />
            </a>
            {enabled
              ? " — Require account stays blocked until the map has at least one row."
              : " before enabling Require account."}
          </p>
        </div>
      ) : loginSimplified ? (
        <p className="text-xs text-muted-foreground" data-testid={`text-${testIdPrefix}-help`}>
          Account gate stays on for a login goal. Turn on Allow new signups if visitors without an
          account should be able to register here.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid={`text-${testIdPrefix}-help`}>
          {forceEnabled
            ? "This conversion goal is account signup or login — the account gate stays on."
            : enabled
              ? "Visitors must sign up or log in before this conversion."
              : "Optionally require an account before the conversion goal above."}
        </p>
      )}
    </div>
  );
}
