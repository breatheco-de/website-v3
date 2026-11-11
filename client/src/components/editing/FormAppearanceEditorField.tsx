import { useState } from "react";
import { ClipboardList, Info } from "lucide-react";
import { IconChevronDown } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { getIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { Section } from "@shared/schema";
import {
  FORM_APPEARANCE_ROLES,
  buildFormAppearanceClearUpdates,
  imageSiblingPaths,
  type FormAppearanceEntry,
  type FormAppearanceGroup,
  type FormAppearanceRoleDef,
} from "@shared/form-appearance";
import { RichTextArea } from "./RichTextArea";
import { LinkPicker } from "./LinkPicker";
import { ImageWithStylePicker } from "./ImageWithStylePicker";

const DEFAULT_CHOICE = "__default__";
const TEMPLATE_VAR_RE = /\{\{[\s\S]*?\}\}/;

export interface FormAppearanceEditorFieldProps {
  entries: FormAppearanceEntry[];
  section: Record<string, unknown> | null;
  /** `undefined` or `""` removes the key. */
  onChange: (path: string, value: unknown) => void;
  onChangeMany: (updates: Record<string, unknown>) => void;
  onPickIcon: (path: string, label: string, currentIcon: string) => void;
  /** The form or card this box styles exists on the section. */
  formPresent: boolean;
  /** Bound form path ("" = section root, null = no form binding). */
  formPath: string | null;
  formObjectPresent: boolean;
  /** Signup / login form: step messages in the Forms tab own the button text. */
  isAuthForm: boolean;
  locale?: string;
  allSections?: Section[];
  "data-testid"?: string;
}

function readPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function readString(obj: unknown, path: string): string {
  const v = readPath(obj, path);
  return typeof v === "string" ? v : "";
}

export function FormAppearanceEditorField({
  entries,
  section,
  onChange,
  onChangeMany,
  onPickIcon,
  formPresent,
  formPath,
  formObjectPresent,
  isAuthForm,
  locale = "en",
  allSections,
  "data-testid": testId,
}: FormAppearanceEditorFieldProps) {
  const contentEntries = entries.filter((e) => FORM_APPEARANCE_ROLES[e.role].group === "content");
  const styleEntries = entries.filter((e) => FORM_APPEARANCE_ROLES[e.role].group === "style");
  const [group, setGroup] = useState<FormAppearanceGroup>(
    contentEntries.length > 0 ? "content" : "style",
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const visible = group === "content" ? contentEntries : styleEntries;
  const textColorPath = entries.find((e) => e.role === "text-color")?.path;
  const textColorSet = textColorPath ? readString(section, textColorPath) !== "" : false;

  const lockedByMissingForm = (path: string) =>
    !!formPath && !formObjectPresent && path.startsWith(`${formPath}.`);

  const renderHint = (text: string, rowTestId: string) => (
    <p className="text-xs text-muted-foreground" data-testid={rowTestId}>
      {text}
    </p>
  );

  const renderControl = (entry: FormAppearanceEntry, def: FormAppearanceRoleDef) => {
    const { path, role } = entry;
    const rowId = `form-appearance-${role}`;

    switch (def.control) {
      case "rich-text":
        return (
          <RichTextArea
            value={readString(section, path)}
            onChange={(html) => onChange(path, html)}
            placeholder={`Edit ${def.label.toLowerCase()}…`}
            minHeight="80px"
            locale={locale}
            data-testid={`${rowId}-input`}
          />
        );
      case "text":
        return (
          <Input
            value={readString(section, path)}
            onChange={(e) => onChange(path, e.target.value)}
            className="h-8 text-sm"
            data-testid={`${rowId}-input`}
          />
        );
      case "textarea":
        return (
          <Textarea
            value={readString(section, path)}
            onChange={(e) => onChange(path, e.target.value)}
            className="min-h-[64px] text-sm"
            data-testid={`${rowId}-input`}
          />
        );
      case "link":
        return (
          <LinkPicker
            value={readString(section, path)}
            onChange={(url) => onChange(path, url)}
            locale={locale}
            allSections={allSections}
            testId={`${rowId}-input`}
          />
        );
      case "color":
        return (
          <ColorPicker
            value={readString(section, path)}
            onChange={(value) => onChange(path, value)}
            type={def.colorType ?? "background"}
            label={def.label}
            testIdPrefix={rowId}
          />
        );
      case "choice": {
        const current = readString(section, path);
        return (
          <Select
            value={current || DEFAULT_CHOICE}
            onValueChange={(val) => onChange(path, val === DEFAULT_CHOICE ? undefined : val)}
          >
            <SelectTrigger className="h-8 text-sm" data-testid={`${rowId}-input`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[10002]">
              <SelectItem value={DEFAULT_CHOICE}>Default</SelectItem>
              {(def.choices ?? []).map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      case "icon": {
        const current = readString(section, path);
        const IconComponent = current ? getIcon(current) : null;
        return (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPickIcon(path, def.label, current)}
              className="flex items-center justify-center w-10 h-10 rounded border bg-muted/30 hover:bg-muted transition-colors"
              data-testid={`${rowId}-input`}
              title={`Change ${def.label}`}
            >
              {IconComponent ? (
                <IconComponent className="h-6 w-6 text-foreground" />
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </button>
            {current && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => onChange(path, undefined)}
                data-testid={`${rowId}-clear`}
              >
                Remove
              </button>
            )}
          </div>
        );
      }
      case "image": {
        const raw = readPath(section, path);
        const src =
          typeof raw === "string"
            ? raw
            : raw && typeof raw === "object" && "src" in raw
              ? String((raw as Record<string, unknown>).src ?? "")
              : "";
        const siblings = imageSiblingPaths(path);
        const objectAlt =
          raw && typeof raw === "object" && "alt" in raw
            ? String((raw as Record<string, unknown>).alt ?? "")
            : "";
        return (
          <ImageWithStylePicker
            label={def.label}
            value={src}
            alt={readString(section, siblings.alt) || objectAlt}
            objectFit={readString(section, siblings.objectFit)}
            objectPosition={readString(section, siblings.objectPosition)}
            testId={`${rowId}-input`}
            onChangeSrc={(nextSrc, nextAlt) => {
              const updates: Record<string, unknown> = { [path]: nextSrc };
              if (nextAlt) updates[siblings.alt] = nextAlt;
              onChangeMany(updates);
            }}
            onChangeAlt={(alt) => onChange(siblings.alt, alt)}
            onChangeObjectFit={(fit) => onChange(siblings.objectFit, fit)}
            onChangeObjectPosition={(pos) => onChange(siblings.objectPosition, pos)}
            onRemove={() => onChangeMany(buildFormAppearanceClearUpdates(entry))}
          />
        );
      }
    }
  };

  const renderRow = (entry: FormAppearanceEntry) => {
    const def: FormAppearanceRoleDef = FORM_APPEARANCE_ROLES[entry.role];
    const rowId = `form-appearance-${entry.role}`;
    const isTemplate = TEMPLATE_VAR_RE.test(readString(section, entry.path));
    const locked = lockedByMissingForm(entry.path);

    return (
      <div key={entry.path} className="space-y-1.5" data-testid={`${rowId}-row`}>
        {(locked || (def.control !== "image" && def.control !== "color")) && (
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="text-sm font-medium">{def.label}</Label>
            {isTemplate && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                template
              </Badge>
            )}
          </div>
        )}
        {locked ? (
          renderHint("Add a form to this section first.", `${rowId}-locked`)
        ) : (
          renderControl(entry, def)
        )}
        {entry.role === "submit-label" &&
          isAuthForm &&
          renderHint(
            "This is a signup form; the button text for each step is set in the Forms tab.",
            "form-appearance-signup-hint",
          )}
        {entry.role === "layout" &&
          renderHint(
            "Side by side only applies when the form shows just email and first name.",
            "form-appearance-layout-hint",
          )}
        {entry.role === "terms-color" &&
          textColorSet &&
          renderHint(
            "Inside the card, terms and consent use the text color.",
            "form-appearance-terms-hint",
          )}
      </div>
    );
  };

  return (
    <div
      className="rounded-md border border-input bg-background"
      data-testid={testId || "form-appearance-editor-field"}
    >
      <div className="flex items-center justify-between gap-2 border-b border-input bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">Form</span>
        </div>
        {contentEntries.length > 0 && styleEntries.length > 0 && (
          <ToggleButtonBar
            value={group}
            onValueChange={(v) => setGroup(v as FormAppearanceGroup)}
            listTestId="form-appearance-group-bar"
          >
            <ToggleButtonBarTrigger value="content" data-testid="form-appearance-group-content">
              Content
            </ToggleButtonBarTrigger>
            <ToggleButtonBarTrigger value="style" data-testid="form-appearance-group-style">
              Style
            </ToggleButtonBarTrigger>
          </ToggleButtonBar>
        )}
      </div>

      <div className="p-3 space-y-4">
        <p className="text-xs text-muted-foreground">
          How this section&apos;s form looks and what it says. Conversion and submit behavior
          live in the Forms tab.
        </p>

        {!formPresent && (
          <div
            className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground"
            data-testid="form-appearance-no-form-note"
          >
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>No form on this section yet, so some of these settings may not show on the page.</span>
          </div>
        )}

        {visible.map(renderRow)}

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-form-appearance-advanced"
            >
              Read more (advanced)
              <IconChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-180")}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 rounded-md border border-border bg-muted/20 p-2.5 space-y-1.5 text-[11px] text-muted-foreground font-mono leading-relaxed">
              <p>YAML keys on this variant (cleared values are removed from the section):</p>
              {entries.map((e) => (
                <p key={e.path}>
                  {FORM_APPEARANCE_ROLES[e.role].label}:{" "}
                  <span className="text-foreground">{e.path}</span>
                </p>
              ))}
              <p>
                Tags: <span className="text-foreground">form-appearance:&lt;role&gt;</span> in the
                component&apos;s field-editors.ts. Roles:{" "}
                <span className="text-foreground">shared/form-appearance.ts</span>
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}
