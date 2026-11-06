import {
  IconCircleCheck,
  IconExternalLink,
  IconMessage,
  IconPencil,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LinkPicker } from "./LinkPicker";
import type { Section } from "@shared/schema";
import { OverrideRulesBadge } from "./OverrideRulesBadge";

export type SuccessMode = "message" | "redirect";

/** Hardcoded locale fallback used by LeadFormDefault when nothing else is set. */
export const LOCALE_DEFAULT_SUCCESS_MESSAGE = {
  en: "Thanks! We'll contact you soon.",
  es: "¡Gracias! Te contactaremos pronto.",
} as const;

export interface SuccessCardProps {
  message: string;
  url: string;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onChange: (field: "message" | "url" | "reload_entry_fields", value: string | boolean) => void;
  /** Event-level defaults shown when the section has no override. */
  inheritedMessage?: string;
  inheritedUrl?: string;
  locale?: string;
  allSections?: Section[];
  /** When true, hide redirect mode (e.g. event defaults can still set both). */
  allowRedirect?: boolean;
  /** Lead-form only: refresh entry page data after success. */
  reloadEntryFields?: boolean;
  showReloadEntryFields?: boolean;
  testIdPrefix?: string;
  /** Rules that override success — shown left of the edit control. */
  overrideRulesCount?: number;
  onOverrideRulesClick?: () => void;
}

export function SuccessCard({
  message,
  url,
  editing,
  onEditingChange,
  onChange,
  inheritedMessage,
  inheritedUrl,
  locale = "en",
  allSections,
  allowRedirect = true,
  reloadEntryFields = false,
  showReloadEntryFields = false,
  testIdPrefix = "form-success",
  overrideRulesCount = 0,
  onOverrideRulesClick,
}: SuccessCardProps) {
  const localeFallback =
    locale === "es"
      ? LOCALE_DEFAULT_SUCCESS_MESSAGE.es
      : LOCALE_DEFAULT_SUCCESS_MESSAGE.en;

  const hasSectionOverride = Boolean(url.trim() || message.trim());
  const effectiveUrl = url.trim() || (!hasSectionOverride ? (inheritedUrl ?? "") : "");
  const effectiveMessage =
    message.trim() ||
    (!hasSectionOverride ? (inheritedMessage ?? "") : "");
  const isInherited = !hasSectionOverride && Boolean(inheritedUrl || inheritedMessage);

  // Runtime behavior: url wins over message, so derive the current mode from url presence.
  const storedMode: SuccessMode = url.trim()
    ? "redirect"
    : message.trim()
      ? "message"
      : inheritedUrl
        ? "redirect"
        : "message";
  const [mode, setMode] = useState<SuccessMode>(
    allowRedirect ? storedMode : "message",
  );

  useEffect(() => {
    if (editing) setMode(allowRedirect ? storedMode : "message");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function switchMode(next: SuccessMode) {
    if (next === mode) return;
    setMode(next);
    // Clear the other field so redirect and message never conflict in YAML
    if (next === "message" && url) onChange("url", "");
    if (next === "redirect" && message) onChange("message", "");
  }

  const badgeLabel = (() => {
    if (url.trim()) return "Redirect";
    if (message.trim()) return "Custom message";
    if (inheritedUrl) return "Event redirect";
    if (inheritedMessage) return "Event message";
    return "Default message";
  })();

  return (
    <div
      className="rounded-md border bg-muted/20 p-3 space-y-3 overflow-hidden w-full min-w-0"
      data-testid={`card-${testIdPrefix}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <IconCircleCheck className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium">Success</span>
          <Badge
            variant={hasSectionOverride || isInherited ? "default" : "outline"}
            className="text-[11px] px-1.5 py-0 leading-4 font-normal"
            data-testid={`badge-${testIdPrefix}-mode`}
          >
            {badgeLabel}
          </Badge>
          {showReloadEntryFields && reloadEntryFields && (
            <Badge
              variant="secondary"
              className="text-[11px] px-1.5 py-0 leading-4 font-normal"
              data-testid={`badge-${testIdPrefix}-reload-entry`}
            >
              Refresh page data
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onOverrideRulesClick && (
            <OverrideRulesBadge
              count={overrideRulesCount}
              onClick={onOverrideRulesClick}
              testId={`badge-${testIdPrefix}-changed-by-rules`}
            />
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6 flex-shrink-0"
            onClick={() => onEditingChange(!editing)}
            data-testid={`button-edit-${testIdPrefix}`}
          >
            {editing ? (
              <IconX className="h-3.5 w-3.5" />
            ) : (
              <IconPencil className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            What happens after the form is submitted and the conversion is
            registered. A redirect URL takes priority over the message.
            {isInherited || inheritedMessage || inheritedUrl
              ? " Leave blank to inherit the conversion event default."
              : ""}
          </p>

          {allowRedirect && (
            <div
              className="inline-flex rounded-md border p-0.5 gap-0.5"
              role="radiogroup"
              aria-label="Success behavior"
            >
              <button
                type="button"
                role="radio"
                aria-checked={mode === "message"}
                onClick={() => switchMode("message")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
                  mode === "message"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`button-${testIdPrefix}-mode-message`}
              >
                <IconMessage className="h-3 w-3" />
                Show message
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === "redirect"}
                onClick={() => switchMode("redirect")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
                  mode === "redirect"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`button-${testIdPrefix}-mode-redirect`}
              >
                <IconExternalLink className="h-3 w-3" />
                Redirect to URL
              </button>
            </div>
          )}

          {mode === "message" || !allowRedirect ? (
            <div className="space-y-1.5">
              <Label
                htmlFor={`${testIdPrefix}-message`}
                className="text-xs text-muted-foreground"
              >
                Success message
              </Label>
              <Textarea
                id={`${testIdPrefix}-message`}
                placeholder={inheritedMessage || localeFallback}
                value={message}
                onChange={(e) => onChange("message", e.target.value)}
                data-testid={`input-${testIdPrefix}-message`}
                className="text-xs min-h-[64px]"
              />
              <p className="text-[11px] text-muted-foreground">
                Shown inline after submission.
                {inheritedMessage
                  ? " Leave blank to use the conversion event default."
                  : ` Leave blank to use “${localeFallback}”.`}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Redirect URL
              </Label>
              <div>
                <LinkPicker
                  value={url}
                  onChange={(value) => onChange("url", value)}
                  locale={locale}
                  allSections={allSections}
                  allowedTypes={["internal", "external"]}
                  testId={`input-${testIdPrefix}-url`}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Pick a page from the sitemap or enter a custom URL. Visitors
                are sent there after submitting; no inline message is shown.
              </p>
            </div>
          )}

          {showReloadEntryFields && (
            <div className="space-y-1.5 pt-1 border-t">
              <div className="flex items-center justify-between gap-2">
                <Label
                  htmlFor={`${testIdPrefix}-reload-entry`}
                  className="text-xs text-muted-foreground"
                >
                  Refresh page data after success
                </Label>
                <Switch
                  id={`${testIdPrefix}-reload-entry`}
                  checked={reloadEntryFields}
                  onCheckedChange={(v) => onChange("reload_entry_fields", v)}
                  data-testid={`switch-${testIdPrefix}-reload-entry`}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                After a successful submit, reload this page’s data so the form can
                show an updated state (without a full browser refresh).
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="min-w-0">
          {effectiveUrl ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <IconExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              <span
                className="font-mono text-xs text-foreground truncate"
                data-testid={`text-${testIdPrefix}-url-display`}
                title={effectiveUrl}
              >
                {effectiveUrl}
              </span>
              {isInherited && (
                <span className="text-[10px] text-muted-foreground italic shrink-0">
                  (inherited)
                </span>
              )}
            </div>
          ) : effectiveMessage ? (
            <p
              className="text-xs text-foreground line-clamp-2"
              data-testid={`text-${testIdPrefix}-message-display`}
            >
              {effectiveMessage}
              {isInherited && (
                <span className="ml-1 text-[10px] text-muted-foreground italic">
                  (inherited)
                </span>
              )}
            </p>
          ) : (
            <span className="text-xs text-muted-foreground italic">
              “{localeFallback}” is shown after submission.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
