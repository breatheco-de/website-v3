import { useState } from "react";
import { IconAlertCircle, IconPencil, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { TagInput } from "./TagInput";
import { OverrideRulesBadge } from "./OverrideRulesBadge";

interface AutomationsTagsCardProps {
  automation: string;
  tags: string[];
  onAutomationChange: (value: string) => void;
  onTagsChange: (tags: string[]) => void;
  automationSuggestions?: string[];
  tagSuggestions?: string[];
  inheritedAutomation?: string;
  inheritedTags?: string[];
  automationOverridden?: boolean;
  tagsOverridden?: boolean;
  onAutomationOverrideChange?: (v: boolean) => void;
  onTagsOverrideChange?: (v: boolean) => void;
  /** When set with onEditingChange, editing is controlled (e.g. form rules). */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** Rules that override tags and/or automations — left of the edit control. */
  overrideRulesCount?: number;
  onOverrideRulesClick?: () => void;
}

export function AutomationsTagsCard({
  automation,
  tags,
  onAutomationChange,
  onTagsChange,
  automationSuggestions = [],
  tagSuggestions = [],
  inheritedAutomation,
  inheritedTags,
  automationOverridden = false,
  tagsOverridden = false,
  onAutomationOverrideChange,
  onTagsOverrideChange,
  editing: editingProp,
  onEditingChange,
  overrideRulesCount = 0,
  onOverrideRulesClick,
}: AutomationsTagsCardProps) {
  const [uncontrolledEditing, setUncontrolledEditing] = useState(false);
  const controlled = typeof editingProp === "boolean";
  const editing = controlled ? editingProp : uncontrolledEditing;
  const setEditing = (next: boolean) => {
    if (controlled) onEditingChange?.(next);
    else setUncontrolledEditing(next);
  };
  const automationArr = automation ? [automation] : [];

  const effectiveAutomation = automationOverridden
    ? (automation || null)
    : (automation || inheritedAutomation || null);
  const automationIsInherited = !automationOverridden && !automation && !!inheritedAutomation;

  const effectiveTags = tagsOverridden
    ? (tags.length > 0 ? tags : null)
    : (tags.length > 0 ? tags : (inheritedTags && inheritedTags.length > 0 ? inheritedTags : null));
  const tagsAreInherited = !tagsOverridden && tags.length === 0 && !!inheritedTags && inheritedTags.length > 0;

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-3" data-testid="card-automations-tags">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Automations &amp; Tags</span>
        <div className="flex items-center gap-1 shrink-0">
          {onOverrideRulesClick && (
            <OverrideRulesBadge
              count={overrideRulesCount}
              onClick={onOverrideRulesClick}
              testId="badge-automations-tags-changed-by-rules"
            />
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setEditing(!editing)}
            data-testid="button-edit-automations-tags"
          >
            {editing ? <IconX className="h-3.5 w-3.5" /> : <IconPencil className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground" data-testid="label-conversion-automations">
                Automation
              </Label>
              {inheritedAutomation !== undefined && onAutomationOverrideChange && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">Override</span>
                  <Switch
                    checked={automationOverridden}
                    onCheckedChange={onAutomationOverrideChange}
                    data-testid="switch-override-automation"
                  />
                </div>
              )}
            </div>
            {automationOverridden || inheritedAutomation === undefined ? (
              <TagInput
                values={automationArr}
                suggestions={automationSuggestions}
                onChange={(vals) => onAutomationChange(vals[0] ?? "")}
                placeholder="e.g. hubspot-lead-nurture"
                max={1}
                testId="input-conversion-automations"
                emptyMessage="No previous automations found"
              />
            ) : (
              <p className="text-xs text-muted-foreground italic py-1">
                Inheriting:{" "}
                <span className="font-mono not-italic text-foreground">{inheritedAutomation}</span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground" data-testid="label-conversion-tags">
                Tags
              </Label>
              {inheritedTags !== undefined && onTagsOverrideChange && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">Override</span>
                  <Switch
                    checked={tagsOverridden}
                    onCheckedChange={onTagsOverrideChange}
                    data-testid="switch-override-tags"
                  />
                </div>
              )}
            </div>
            {tagsOverridden || inheritedTags === undefined ? (
              <TagInput
                values={tags}
                suggestions={tagSuggestions}
                onChange={onTagsChange}
                placeholder="e.g. lead, bootcamp, latam"
                testId="input-conversion-tags"
              />
            ) : (
              <div className="flex flex-wrap gap-1 py-1">
                {inheritedTags.map((t) => (
                  <Badge
                    key={t}
                    variant="secondary"
                    className="text-[11px] px-1.5 py-0 leading-4 font-normal font-mono"
                  >
                    {t}
                  </Badge>
                ))}
                {inheritedTags.length === 0 && (
                  <span className="text-xs text-muted-foreground italic">none</span>
                )}
                <span className="text-[10px] text-muted-foreground italic self-center">(inherited)</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 text-sm">
          <div className="flex items-start gap-2">
            <span className="text-xs text-muted-foreground w-20 flex-shrink-0 pt-0.5">Automation</span>
            {effectiveAutomation ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono text-xs">{effectiveAutomation}</span>
                {automationIsInherited && (
                  <span className="text-[10px] text-muted-foreground italic">(inherited)</span>
                )}
              </div>
            ) : automationOverridden ? (
              <span className="text-xs text-muted-foreground italic" data-testid="text-automation-overridden-empty">
                none (overriding inherited)
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400" data-testid="error-no-automation">
                <IconAlertCircle className="h-3 w-3 shrink-0" />
                No inherited or specific value found
              </span>
            )}
          </div>
          <div className="flex items-start gap-2">
            <span className="text-xs text-muted-foreground w-20 flex-shrink-0 pt-0.5">Tags</span>
            {effectiveTags ? (
              <div className="flex flex-wrap gap-1 items-center">
                {effectiveTags.map((t) => (
                  <Badge
                    key={t}
                    variant="secondary"
                    className="text-[11px] px-1.5 py-0 leading-4 font-normal font-mono"
                  >
                    {t}
                  </Badge>
                ))}
                {tagsAreInherited && (
                  <span className="text-[10px] text-muted-foreground italic">(inherited)</span>
                )}
              </div>
            ) : tagsOverridden ? (
              <span className="text-xs text-muted-foreground italic" data-testid="text-tags-overridden-empty">
                none (overriding inherited)
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400" data-testid="error-no-tags">
                <IconAlertCircle className="h-3 w-3 shrink-0" />
                No inherited or specific value found
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
