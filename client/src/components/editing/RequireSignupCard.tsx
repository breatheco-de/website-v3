import { useQuery } from "@tanstack/react-query";
import { IconUserPlus, IconAlertTriangle, IconExternalLink } from "@tabler/icons-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { isSignupFieldMapReady, type AuthSignupFieldMapEntry } from "@shared/authSignupFieldMap";

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
  testIdPrefix?: string;
}

/**
 * Toggle for the form-level `is_signup` flag. When site auth (settings.yml `auth`)
 * is not configured, or the signup field_map is empty, the switch is disabled.
 */
export function RequireSignupCard({
  enabled,
  onChange,
  testIdPrefix = "form-require-signup",
}: RequireSignupCardProps) {
  const { data: authSettings, isLoading } = useQuery<AuthSettingsResponse>({
    queryKey: ["/api/settings/auth"],
  });

  const configured = authSettings?.signup_configured === true;
  const mapReady =
    authSettings?.signup_field_map_ready === true ||
    isSignupFieldMapReady(authSettings?.signup?.field_map);
  const canEnable = configured && mapReady;
  const disabled = isLoading || !canEnable;

  return (
    <div
      className="rounded-md border bg-muted/20 p-3 space-y-3 overflow-hidden w-full min-w-0"
      data-testid={`card-${testIdPrefix}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <IconUserPlus className="h-4 w-4 text-muted-foreground shrink-0" />
          <Label
            htmlFor={`switch-${testIdPrefix}`}
            className="text-sm font-medium truncate"
          >
            Require Signup
          </Label>
        </div>
        <Switch
          id={`switch-${testIdPrefix}`}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onChange}
          data-testid={`switch-${testIdPrefix}`}
        />
      </div>

      {!isLoading && !configured ? (
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
            {enabled ? " — this form has the flag set, but signup will not run until auth is configured." : ""}
          </p>
        </div>
      ) : !isLoading && configured && !mapReady ? (
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
              ? " — Require Signup stays blocked until the map has at least one row."
              : " before enabling Require Signup."}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid={`text-${testIdPrefix}-help`}>
          {enabled
            ? "Guests will be signed up on submit (via the site auth endpoint). Logged-in users skip fields we already know (email, first and last name) and only see the remaining ones."
            : "When enabled, submitting this form creates a 4Geeks account for the visitor using the site's auth settings."}
        </p>
      )}
    </div>
  );
}
