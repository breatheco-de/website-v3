import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconAlertCircle, IconInfoCircle, IconPencil, IconShieldCheck, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  collectExtraConsentYamlFields,
  consentCardChannels,
  consentKeyFromYamlField,
  consentLabelFromKey,
  parseConsentSettingsResponse,
  resolveConsentRequirement,
  type ConsentCardValues,
  type ConsentChannelDef,
} from "@shared/consent-settings";

export type ConsentValues = ConsentCardValues;

interface ConsentCardProps {
  values: ConsentValues;
  onChange: (field: string, value: boolean | string) => void;
  inheritedValues?: Partial<ConsentValues>;
  specificFields?: Partial<Record<string, boolean>>;
  isOverridden?: boolean;
  onOverrideChange?: (v: boolean) => void;
}

function ConsentVariableInfo({ variable }: { variable: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-5 w-5"
        onClick={() => setOpen((v) => !v)}
        data-testid={`button-consent-info-${variable}`}
      >
        <IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
      {open && (
        <span className="absolute left-6 top-0 z-10 flex flex-col gap-2 w-56 rounded-md border bg-popover p-3 shadow-md text-popover-foreground">
          <span className="text-xs text-muted-foreground">
            Default text comes from{" "}
            <code className="font-mono text-foreground bg-muted px-1 rounded text-[11px]">
              {variable}
            </code>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full text-xs"
            onClick={() => {
              setOpen(false);
              window.location.href = "/private/settings/legal";
            }}
            data-testid="button-consent-edit-settings"
          >
            Edit in Settings
          </Button>
        </span>
      )}
    </span>
  );
}

function channelOn(values: Partial<ConsentValues> | undefined, yamlField: string): boolean {
  if (!values) return false;
  return !!(values as Record<string, unknown>)[yamlField];
}

function FallbackBadge({ settingsKey }: { settingsKey: string }) {
  return (
    <Badge
      variant="outline"
      className="text-[10px] px-1.5 py-0 leading-4 font-normal"
      data-testid={`badge-consent-fallback-${settingsKey}`}
    >
      Fallback
    </Badge>
  );
}

export function ConsentCard({
  values,
  onChange,
  inheritedValues,
  specificFields,
  isOverridden = false,
  onOverrideChange,
}: ConsentCardProps) {
  const [editing, setEditing] = useState(false);
  const { data: consentSettingsRaw } = useQuery({
    queryKey: ["/api/settings/consent"],
  });
  const { fallback: consentFallback, messages: consentSettings } = parseConsentSettingsResponse(consentSettingsRaw);

  const channelDefs: ConsentChannelDef[] = useMemo(() => {
    const fromSettings = consentCardChannels(Object.keys(consentSettings ?? {}), consentFallback);
    const extras = collectExtraConsentYamlFields(
      Object.keys(consentSettings ?? {}),
      values,
      inheritedValues,
    );
    const known = new Set(fromSettings.map((c) => c.yamlField));
    const extraOnly = extras
      .filter((field) => !known.has(field))
      .map((yamlField) => {
        const settingsKey = consentKeyFromYamlField(yamlField);
        return {
          yamlField,
          settingsKey,
          label: consentLabelFromKey(settingsKey),
        };
      });
    return [...fromSettings, ...extraOnly];
  }, [consentSettings, consentFallback, values, inheritedValues]);

  // Conversions (no inheritance): treat enabled channels as authored so badges show.
  const eventAuthored = specificFields === undefined;
  const isSpecific = (field: string) => eventAuthored || specificFields?.[field] === true;
  const isInherited = (field: string) => !isSpecific(field) && inheritedValues !== undefined;
  const hasInheritanceSource = inheritedValues !== undefined;

  const specificChannels = channelDefs.filter(
    ({ yamlField }) => isSpecific(yamlField) && channelOn(values, yamlField),
  );
  const inheritedChannels = channelDefs.filter(
    ({ yamlField }) => isInherited(yamlField) && channelOn(values, yamlField),
  );
  const hasAnyChannel = specificChannels.length > 0 || inheritedChannels.length > 0;
  const requirement = resolveConsentRequirement(values as Record<string, unknown>, consentFallback, {
    messages: consentSettings,
  });
  const requiredLabels = requirement.required.map((field) => consentLabelFromKey(consentKeyFromYamlField(field)));

  const showTermsSpecific = isSpecific("showTerms");
  const showTermsInherited = isInherited("showTerms");
  const termsMissing = !hasInheritanceSource && !showTermsSpecific;

  const hasInheritedSource = inheritedValues !== undefined;

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-3" data-testid="card-consents">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <IconShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">Consents</span>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => setEditing((v) => !v)}
          data-testid="button-edit-consents"
        >
          {editing ? <IconX className="h-3.5 w-3.5" /> : <IconPencil className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground leading-snug" data-testid="text-consent-how-it-works">
        Switches choose which checkboxes appear on the form. Visitors must tick General and Marketing; SMS, Email and
        WhatsApp are optional. If neither General nor Marketing is on, the form adds the{" "}
        <span className="font-medium text-foreground">Default</span> consent from Settings
        {consentFallback ? <> ({consentLabelFromKey(consentFallback)})</> : <> — none is set on this site</>}.
      </p>
      <p
        className={
          requirement.required.length === 0
            ? "flex items-start gap-1 text-[11px] leading-snug text-destructive"
            : "text-[11px] leading-snug text-foreground"
        }
        data-testid="text-consent-required"
      >
        {requirement.required.length === 0 ? (
          <>
            <IconAlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            No mandatory checkbox. Publishing is blocked until you turn on General or Marketing, or set a Default
            consent in Settings.
          </>
        ) : requirement.twoRequired ? (
          <>Visitors must tick two boxes: General and Marketing. Turn one off if one is enough.</>
        ) : (
          <>
            Visitors must tick: {requiredLabels.join(", ")}
            {requirement.showFallback ? " (site Default)" : ""}.
          </>
        )}
      </p>
      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer select-none">Read more (advanced)</summary>
        <p className="mt-1 leading-snug">
          Rule (<code className="font-mono text-[10px] bg-muted px-1 rounded">resolveConsentRequirement</code> in{" "}
          <code className="font-mono text-[10px] bg-muted px-1 rounded">shared/consent-settings.ts</code>): General and
          Marketing are mandatory whenever on; a custom consent is mandatory only when neither is on; otherwise the
          Default (<code className="font-mono text-[10px] bg-muted px-1 rounded">settings.yml</code> →{" "}
          <code className="font-mono text-[10px]">consent.fallback</code>) appears as the mandatory one. SMS, Email and
          WhatsApp never count. The validator and the publish gate use the same rule. Form YAML uses{" "}
          <code className="font-mono text-[10px] bg-muted px-1 rounded">consent.marketing</code>,{" "}
          <code className="font-mono text-[10px] bg-muted px-1 rounded">consent.general</code>, etc. (
          <code className="font-mono text-[10px] bg-muted px-1 rounded">shared/consent-settings.ts</code>
          {" "}<code className="font-mono text-[10px]">consentCardChannels</code>). Checkboxes:{" "}
          <code className="font-mono text-[10px] bg-muted px-1 rounded">client/src/components/lead_form/variants/LeadFormDefault.tsx</code>.
          The fallback checkbox does not set CRM <code className="font-mono text-[10px]">has_marketing_consent</code> unless Marketing is on.
        </p>
      </details>

      {!editing ? (
        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            <span className="text-xs text-muted-foreground w-20 flex-shrink-0 pt-0.5">Channels</span>
            {hasAnyChannel ? (
              <div className="flex flex-wrap gap-1 items-center">
                {specificChannels.map(({ yamlField, label }) => (
                  <Badge key={yamlField} variant="secondary" className="text-[11px] px-1.5 py-0 leading-4 font-normal">
                    {label}
                  </Badge>
                ))}
                {inheritedChannels.map(({ yamlField, label }) => (
                  <Badge key={yamlField} variant="secondary" className="text-[11px] px-1.5 py-0 leading-4 font-normal">
                    {label}
                  </Badge>
                ))}
                {inheritedChannels.length > 0 && specificChannels.length === 0 && (
                  <span className="text-[10px] text-muted-foreground italic">(inherited)</span>
                )}
                {inheritedChannels.length > 0 && specificChannels.length > 0 && (
                  <span className="text-[10px] text-muted-foreground italic">
                    ({inheritedChannels.map((c) => c.label).join(", ")} inherited)
                  </span>
                )}
              </div>
            ) : (
              <span className="flex flex-wrap items-center gap-1" data-testid="text-channels-general-fallback">
                <Badge variant="secondary" className="text-[11px] px-1.5 py-0 leading-4 font-normal">
                  {consentFallback ? consentLabelFromKey(consentFallback) : "No default"}
                </Badge>
                {consentFallback ? <FallbackBadge settingsKey={consentFallback} /> : null}
                <span className="text-[10px] text-muted-foreground italic">
                  {isOverridden && hasInheritedSource
                    ? "(no channels on — overriding inherited)"
                    : inheritedChannels.length === 0 && hasInheritanceSource
                      ? "(no channels on — inherited)"
                      : "(no channels on)"}
                </span>
              </span>
            )}
          </div>

          <div className="flex items-start gap-2">
            <span className="text-xs text-muted-foreground w-20 flex-shrink-0 pt-0.5">Terms</span>
            {termsMissing ? (
              <span className="flex items-center gap-1 text-xs text-destructive" data-testid="error-no-terms">
                <IconAlertCircle className="h-3 w-3 shrink-0" />
                No inherited or specific value found
              </span>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground italic">
                  {values.showTerms ? "shown" : "hidden"}
                </span>
                {showTermsInherited && (
                  <span className="text-[10px] text-muted-foreground italic">(inherited)</span>
                )}
                {isOverridden && showTermsSpecific && hasInheritedSource && (
                  <span className="text-[10px] text-muted-foreground italic">(overriding inherited)</span>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {hasInheritanceSource && onOverrideChange && (
            <div className="flex items-center justify-between gap-2 pb-2 border-b">
              <span className="text-xs text-muted-foreground">Customize for this form</span>
              <Switch
                checked={isOverridden}
                onCheckedChange={onOverrideChange}
                data-testid="switch-override-consents"
              />
            </div>
          )}

          {!isOverridden && hasInheritanceSource ? (
            <div className="space-y-3 opacity-60 pointer-events-none select-none">
              {channelDefs.map(({ yamlField, label }) => (
                <div key={yamlField} className="flex items-center justify-between gap-2">
                  <Label className="text-xs">{label}</Label>
                  <Switch checked={channelOn(inheritedValues, yamlField)} disabled />
                </div>
              ))}
              <div className="space-y-2 pt-1 border-t">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Show terms &amp; privacy</Label>
                  <Switch checked={inheritedValues?.showTerms ?? false} disabled />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground italic">
                Enable "Customize for this form" to override these values.
              </p>
            </div>
          ) : (
            <>
              {channelDefs.map(({ yamlField, label, settingsKey }) => (
                <div key={yamlField} className={yamlField === "sms" ? "space-y-2" : undefined}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Label className="text-xs">{label}</Label>
                      {channelOn(values, yamlField) && (
                        <ConsentVariableInfo variable={`reserved.${settingsKey}`} />
                      )}
                    </div>
                    <Switch
                      checked={channelOn(values, yamlField)}
                      onCheckedChange={(v) => onChange(yamlField, !!v)}
                      data-testid={`switch-consent-${yamlField}`}
                    />
                  </div>
                  {yamlField === "sms" && values.sms && (
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs text-muted-foreground">US-only</Label>
                      <Checkbox
                        checked={values.smsUsaOnly}
                        onCheckedChange={(v) => onChange("smsUsaOnly", !!v)}
                        data-testid="checkbox-consent-sms-usa-only"
                      />
                    </div>
                  )}
                </div>
              ))}

              <div className="space-y-2 pt-1 border-t">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Show terms &amp; privacy</Label>
                  <Switch
                    checked={values.showTerms}
                    onCheckedChange={(v) => onChange("showTerms", !!v)}
                    data-testid="switch-consent-show-terms"
                  />
                </div>
                {values.showTerms && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Terms URL</Label>
                      <Input
                        value={values.termsUrl}
                        onChange={(e) => onChange("termsUrl", e.target.value)}
                        placeholder="/terms-and-conditions"
                        className="text-xs h-8"
                        data-testid="input-consent-terms-url"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Privacy URL</Label>
                      <Input
                        value={values.privacyUrl}
                        onChange={(e) => onChange("privacyUrl", e.target.value)}
                        placeholder="/privacy-policy"
                        className="text-xs h-8"
                        data-testid="input-consent-privacy-url"
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
