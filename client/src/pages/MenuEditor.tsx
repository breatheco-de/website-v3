import { useParams, useLocation } from "wouter";
import { ArrowLeft, Braces, Check, ChevronDown, ChevronRight, Code, ExternalLink, FileCode, GripVertical, Info, Link as LinkIcon, Megaphone, Menu, Pencil, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { getDebugUserName } from "@/hooks/useDebugAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useRef, useMemo } from "react";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import yaml from "js-yaml";
import { escapeTemplateVars, escapeObjectVars, unescapeObjectVars, unescapeYamlDump } from "@shared/templateVars";
import CodeMirror from "@uiw/react-codemirror";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { filterSitemapEntries, sitemapPathname } from "@/lib/sitemapSearch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { VariableDetailModal } from "@/components/editing/VariableDetailModal";
import { ImageWithStylePicker } from "@/components/editing/ImageWithStylePicker";
import { IconPickerModal } from "@/components/editing/IconPickerModal";
import { LinkPicker } from "@/components/editing/LinkPicker";
import { ColorPicker } from "@/components/ui/color-picker";
import { getIcon } from "@/lib/icons";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { EditableDropdownPreview, EditableLinkItem, EditableText } from "@/components/menus";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function safeYamlDump(obj: unknown, opts?: yaml.DumpOptions): string {
  const { escaped, map } = escapeObjectVars(obj);
  const dumped = yaml.dump(escaped, opts);
  return unescapeYamlDump(dumped, map);
}

interface MenuItemData {
  label: string;
  href: string;
  component: string;
  imageId?: string;
  imageAlt?: string;
  imageObjectFit?: string;
  imageObjectPosition?: string;
  messages?: MarqueeMessageSetting[];
  icon?: string;
  char_delay?: number;
  start_delay?: number;
  display_time?: number;
  dropdown?: {
    type: string;
    title?: string;
    description?: string;
    icon?: string;
    items?: Array<{
      label?: string;
      title?: string;
      description?: string;
      cta?: string;
      href: string;
      icon?: string;
    }>;
    columns?: Array<{
      title: string;
      items: Array<{ label: string; href: string }>;
    }>;
    groups?: Array<{
      title: string;
      items: Array<{ label: string; href: string }>;
    }>;
    footer?: {
      text: string;
      linkText: string;
      href: string;
      disclaimer?: string;
    };
  };
}

interface FooterColumnItem {
  label: string;
  href: string;
}

interface FooterColumn {
  title: string;
  items: FooterColumnItem[];
  items_per_column?: number;
}

interface FooterSocial {
  name: string;
  icon: string;
  link: string;
}

interface FooterLegalLink {
  label: string;
  href: string;
}

interface FooterData {
  columns: FooterColumn[];
  socials: FooterSocial[];
  legal_links: FooterLegalLink[];
  copyright_text: string;
}

interface MarqueeMessageSetting {
  text: string;
  cta_label?: string;
  cta_url?: string;
  cta_url_overrides?: Record<string, string>;
  icon?: string;
}

interface MarqueeConfigSetting {
  enabled?: boolean;
  texts?: MarqueeMessageSetting[];
  position?: "above" | "below";
  sticky?: boolean;
  background?: string;
  start_delay?: number;
  char_delay?: number;
  display_time?: number;
  show_on?: "desktop" | "mobile" | "";
}

interface NavbarSettings {
  constrained_margin?: boolean;
  size?: number;
  sticky?: boolean;
  subtle_at_top?: boolean;
  floating?: boolean;
  marquee?: MarqueeConfigSetting;
}

interface MenuData {
  navbar?: NavbarSettings & {
    items: MenuItemData[];
  };
  footer?: FooterData;
  [key: string]: unknown;
}

interface MenuResponse {
  name: string;
  data: MenuData;
  rawYaml?: string;
}

const componentOptions = [
  { value: "SimpleLink", label: "Simple Link" },
  { value: "Button", label: "Button (CTA)" },
  { value: "Dropdown", label: "Dropdown Menu" },
  { value: "Logo", label: "Logo (Universal Image)" },
  { value: "LanguageSwitcher", label: "Language Switcher" },
  { value: "TypewriterAnnouncement", label: "Typewriter Announcement" },
];

const dropdownTypes = [
  { value: "cards", label: "Cards" },
  { value: "columns", label: "Columns" },
  { value: "simple-list", label: "Simple List" },
  { value: "grouped-list", label: "Grouped List" },
];


function SortableMenuItemEditor({
  id,
  item,
  index,
  onUpdate,
  onDelete,
  isExpanded,
  onToggleExpand,
  isReadOnlyStructure = false,
  locale = "en",
}: {
  id: string;
  item: MenuItemData;
  index: number;
  onUpdate: (index: number, item: MenuItemData) => void;
  onDelete?: (index: number) => void;
  isExpanded: boolean;
  onToggleExpand: (index: number) => void;
  isReadOnlyStructure?: boolean;
  locale?: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const twSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <Card ref={setNodeRef} style={style} className="mb-2 min-w-0">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center gap-2">
          {!isReadOnlyStructure ? (
            <button
              className="touch-none cursor-grab active:cursor-grabbing"
              {...attributes}
              {...listeners}
              data-testid={`button-drag-item-${index}`}
            >
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </button>
          ) : (
            <GripVertical className="h-4 w-4 text-muted-foreground/30" />
          )}
          <button
            onClick={() => onToggleExpand(index)}
            className="flex items-center gap-2 flex-1 text-left"
            data-testid={`button-expand-item-${index}`}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Menu className="h-4 w-4 text-primary" />
            <span className="font-medium">{item.label || "Untitled"}</span>
          </button>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
            {item.component}
          </span>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(index)}
              className="h-8 w-8 text-destructive hover:text-destructive"
              data-testid={`button-delete-item-${index}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      {isExpanded && (
        <CardContent className="pt-0 pb-4 px-4 space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`label-${index}`}>Label</Label>
              <Input
                id={`label-${index}`}
                value={item.label}
                onChange={(e) => onUpdate(index, { ...item, label: e.target.value })}
                placeholder="Menu label"
                data-testid={`input-label-${index}`}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`href-${index}`}>URL</Label>
              <div className="relative">
                <LinkIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id={`href-${index}`}
                  value={item.href}
                  onChange={(e) => onUpdate(index, { ...item, href: e.target.value })}
                  placeholder="/page-url"
                  className="pl-8"
                  data-testid={`input-href-${index}`}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`component-${index}`}>Component</Label>
              <Select
                value={item.component}
                onValueChange={(value) => {
                  const updatedItem = { ...item, component: value };
                  if (value === "Dropdown" && !item.dropdown) {
                    updatedItem.dropdown = {
                      type: "simple-list",
                      title: item.label,
                      description: "",
                      items: [],
                      columns: [],
                      groups: [],
                    };
                  }
                  onUpdate(index, updatedItem);
                }}
                disabled={isReadOnlyStructure}
              >
                <SelectTrigger data-testid={`select-component-${index}`}>
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  {componentOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <Code className="h-4 w-4" />
                        {opt.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Dropdown Type</Label>
              <Select
                value={item.dropdown?.type || "simple-list"}
                onValueChange={(value) => {
                  const currentDropdown = item.dropdown || {
                    type: "simple-list",
                    title: item.label,
                    description: "",
                    items: [],
                    columns: [],
                    groups: [],
                  };
                  onUpdate(index, {
                    ...item,
                    dropdown: { ...currentDropdown, type: value },
                  });
                }}
                disabled={item.component !== "Dropdown" || isReadOnlyStructure}
              >
                <SelectTrigger data-testid={`select-dropdown-type-${index}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dropdownTypes.map((dt) => (
                    <SelectItem key={dt.value} value={dt.value}>
                      {dt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {item.component === "Dropdown" && item.dropdown && (
            <div className="border-t pt-4 mt-4 min-w-0">
              <div className="flex items-center gap-2 mb-4">
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">Dropdown Preview</span>
                <span className="text-xs text-muted-foreground">(Click elements to edit)</span>
              </div>
              <EditableDropdownPreview
                dropdown={item.dropdown as any}
                onChange={(updatedDropdown) =>
                  onUpdate(index, {
                    ...item,
                    dropdown: updatedDropdown as any,
                  })
                }
                isReadOnlyStructure={isReadOnlyStructure}
                locale={locale}
              />
            </div>
          )}
          {item.component === "Logo" && (
            <div className="border-t pt-4 mt-4">
              <ImageWithStylePicker
                label="Logo Image"
                value={item.imageId || ""}
                alt={item.imageAlt || ""}
                objectFit={item.imageObjectFit || ""}
                objectPosition={item.imageObjectPosition || ""}
                tagFilter="logo"
                testId="logo-image"
                disabled={locale !== "en"}
                onChangeSrc={(_src, _alt, registryId) => {
                  onUpdate(index, { ...item, imageId: registryId || _src, imageAlt: _alt || item.imageAlt });
                }}
                onChangeAlt={(newAlt) =>
                  onUpdate(index, { ...item, imageAlt: newAlt })
                }
                onChangeObjectFit={(fit) =>
                  onUpdate(index, { ...item, imageObjectFit: fit })
                }
                onChangeObjectPosition={(pos) =>
                  onUpdate(index, { ...item, imageObjectPosition: pos })
                }
                onRemove={() => onUpdate(index, { ...item, imageId: "", imageAlt: "", imageObjectFit: "", imageObjectPosition: "" })}
              />
            </div>
          )}
          {item.component === "TypewriterAnnouncement" && (
            <div className="border-t pt-4 mt-4 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-medium">Messages</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onUpdate(index, { ...item, messages: [...(item.messages ?? []), { text: "" }] })}
                    data-testid={`button-add-tw-message-${index}`}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add message
                  </Button>
                </div>
                <DndContext
                  sensors={twSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => {
                    const { active, over } = event;
                    if (!over || active.id === over.id) return;
                    const msgs = item.messages ?? [];
                    const oldIdx = msgs.findIndex((_, i) => `tw-msg-${index}-${i}` === String(active.id));
                    const newIdx = msgs.findIndex((_, i) => `tw-msg-${index}-${i}` === String(over.id));
                    if (oldIdx >= 0 && newIdx >= 0) {
                      onUpdate(index, { ...item, messages: arrayMove(msgs, oldIdx, newIdx) });
                    }
                  }}
                >
                  <SortableContext
                    items={(item.messages ?? []).map((_, i) => `tw-msg-${index}-${i}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {(item.messages ?? []).map((msg, msgIdx) => (
                        <SortableMarqueeMessageRow
                          key={`tw-msg-${index}-${msgIdx}`}
                          id={`tw-msg-${index}-${msgIdx}`}
                          msg={msg}
                          index={msgIdx}
                          locale={locale}
                          onUpdate={(updates) => {
                            const msgs = [...(item.messages ?? [])];
                            msgs[msgIdx] = { ...msgs[msgIdx], ...updates };
                            onUpdate(index, { ...item, messages: msgs });
                          }}
                          onDelete={() => {
                            const msgs = [...(item.messages ?? [])];
                            msgs.splice(msgIdx, 1);
                            onUpdate(index, { ...item, messages: msgs });
                          }}
                        />
                      ))}
                      {(!item.messages || item.messages.length === 0) && (
                        <p className="text-xs text-muted-foreground text-center py-2">No messages yet — add one above</p>
                      )}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Timing</Label>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Start delay (ms)</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="600"
                      value={item.start_delay ?? ""}
                      onChange={(e) => onUpdate(index, { ...item, start_delay: parseInt(e.target.value, 10) || undefined })}
                      data-testid={`input-tw-start-delay-${index}`}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Char delay (ms)</Label>
                    <Input
                      type="number"
                      min={1}
                      placeholder="40"
                      value={item.char_delay ?? ""}
                      onChange={(e) => onUpdate(index, { ...item, char_delay: parseInt(e.target.value, 10) || undefined })}
                      data-testid={`input-tw-char-delay-${index}`}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Display time (ms)</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="3000"
                      value={item.display_time ?? ""}
                      onChange={(e) => onUpdate(index, { ...item, display_time: parseInt(e.target.value, 10) || undefined })}
                      data-testid={`input-tw-display-time-${index}`}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function SortableFooterItem({
  id,
  item,
  colIndex,
  itemIndex,
  isEnglish,
  locale,
  onUpdateColumnItem,
  onDeleteColumnItem,
}: {
  id: string;
  item: FooterColumnItem;
  colIndex: number;
  itemIndex: number;
  isEnglish: boolean;
  locale: string;
  onUpdateColumnItem: (colIndex: number, itemIndex: number, updates: Partial<FooterColumnItem>) => void;
  onDeleteColumnItem: (colIndex: number, itemIndex: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-0.5">
      <button
        className="touch-none cursor-grab active:cursor-grabbing shrink-0"
        {...attributes}
        {...listeners}
        data-testid={`button-drag-footer-column-${colIndex}-item-${itemIndex}`}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </button>
      <div className="flex-1 min-w-0">
        <EditableLinkItem
          label={item.label || ""}
          href={item.href || ""}
          onLabelChange={(label) => onUpdateColumnItem(colIndex, itemIndex, { label })}
          onHrefChange={(href) => onUpdateColumnItem(colIndex, itemIndex, { href })}
          onSave={(label, href) => onUpdateColumnItem(colIndex, itemIndex, { label, href })}
          onDelete={() => onDeleteColumnItem(colIndex, itemIndex)}
          testIdPrefix={`footer-column-${colIndex}-item-${itemIndex}`}
          isReadOnlyStructure={false}
          locale={locale}
        />
      </div>
    </li>
  );
}

function EditableFooterColumnTitle({
  title,
  itemsPerColumn,
  onSave,
  testId,
}: {
  title: string;
  itemsPerColumn?: number;
  onSave: (title: string, itemsPerColumn: number | undefined) => void;
  testId: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempTitle, setTempTitle] = useState(title);
  const [tempItemsPerColumn, setTempItemsPerColumn] = useState(
    itemsPerColumn != null ? String(itemsPerColumn) : "",
  );

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setTempTitle(title);
      setTempItemsPerColumn(itemsPerColumn != null ? String(itemsPerColumn) : "");
    }
    setIsEditing(open);
  };

  const handleSave = () => {
    const parsed = tempItemsPerColumn.trim() === "" ? NaN : Number(tempItemsPerColumn);
    const nextItemsPerColumn =
      Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : undefined;
    onSave(tempTitle, nextItemsPerColumn);
    setIsEditing(false);
  };

  return (
    <Popover open={isEditing} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <h4
          className="group relative cursor-pointer inline-flex items-center gap-1 font-semibold text-foreground flex-1"
          onClick={() => handleOpenChange(true)}
          data-testid={testId}
        >
          {title || <span className="text-muted-foreground italic">Column title</span>}
          <Pencil className="h-3 w-3 text-primary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        </h4>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={tempTitle}
              onChange={(e) => setTempTitle(e.target.value)}
              placeholder="Column title"
              className="h-8 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") setIsEditing(false);
              }}
              data-testid={`${testId}-input`}
            />
            <Button size="sm" className="h-8" onClick={handleSave} data-testid={`${testId}-save`}>
              Save
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`${testId}-items-per-column`} className="text-xs text-muted-foreground whitespace-nowrap">
              Items per column
            </Label>
            <Input
              id={`${testId}-items-per-column`}
              type="number"
              min={1}
              step={1}
              value={tempItemsPerColumn}
              onChange={(e) => setTempItemsPerColumn(e.target.value)}
              placeholder="Default"
              className="h-8 text-sm w-20"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") setIsEditing(false);
              }}
              data-testid={`${testId}-items-per-column`}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SortableFooterColumn({
  id,
  column,
  colIndex,
  isEnglish,
  locale,
  onDeleteColumn,
  onUpdateColumn,
  onUpdateColumnItem,
  onDeleteColumnItem,
  onAddColumnItem,
}: {
  id: string;
  column: FooterColumn;
  colIndex: number;
  isEnglish: boolean;
  locale: string;
  onDeleteColumn: (index: number) => void;
  onUpdateColumn: (index: number, updates: Partial<FooterColumn>) => void;
  onUpdateColumnItem: (colIndex: number, itemIndex: number, updates: Partial<FooterColumnItem>) => void;
  onDeleteColumnItem: (colIndex: number, itemIndex: number) => void;
  onAddColumnItem: (colIndex: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group/col relative border rounded-lg p-2" data-testid={`footer-column-${colIndex}`}>
      <div className="flex items-center gap-1 mb-2">
        <button
          className="touch-none cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
          data-testid={`button-drag-footer-column-${colIndex}`}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
        <EditableFooterColumnTitle
          title={column.title}
          itemsPerColumn={column.items_per_column}
          onSave={(nextTitle, nextItemsPerColumn) =>
            onUpdateColumn(colIndex, {
              title: nextTitle,
              items_per_column: nextItemsPerColumn,
            })
          }
          testId={`footer-column-${colIndex}-title`}
        />
        <button
          onClick={() => onDeleteColumn(colIndex)}
          className="p-1 rounded-md bg-destructive/10 text-destructive opacity-0 group-hover/col:opacity-100 transition-opacity"
          data-testid={`footer-column-${colIndex}-delete`}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <SortableContext
        items={(column.items || []).map((_, i) => `footer-col-${colIndex}-item-${i}`)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="space-y-1">
          {(column.items || []).map((item, itemIndex) => (
            <SortableFooterItem
              key={`footer-col-${colIndex}-item-${itemIndex}`}
              id={`footer-col-${colIndex}-item-${itemIndex}`}
              item={item}
              colIndex={colIndex}
              itemIndex={itemIndex}
              isEnglish={isEnglish}
              locale={locale}
              onUpdateColumnItem={onUpdateColumnItem}
              onDeleteColumnItem={onDeleteColumnItem}
            />
          ))}
          <li>
            <button
              onClick={() => onAddColumnItem(colIndex)}
              className="flex items-center gap-1 text-sm text-muted-foreground/50 hover:text-primary py-1"
              data-testid={`footer-column-${colIndex}-add-item`}
            >
              <Plus className="h-3 w-3" />
              Add item
            </button>
          </li>
        </ul>
      </SortableContext>
    </div>
  );
}

interface MenuUsageResponse {
  defaultContentTypes: Array<{ name: string; position: "top" | "bottom" }>;
  overrides: Array<{ contentType: string; slug: string; source: string; position: "top" | "bottom" }>;
}

function PagePickerPopover({
  value,
  locale,
  testId,
  onChange,
}: {
  value: string;
  locale: string;
  testId?: string;
  onChange: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: sitemapUrls = [], isLoading } = useQuery<{ loc: string; label: string }[]>({
    queryKey: ["/api/sitemap-urls", locale],
    queryFn: async () => {
      const r = await fetch(`/api/sitemap-urls?locale=${locale}`);
      if (!r.ok) throw new Error("Failed to load sitemap");
      return r.json();
    },
  });

  const filtered = useMemo(
    () => filterSitemapEntries(sitemapUrls, search),
    [sitemapUrls, search],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-input bg-background hover-elevate truncate max-w-[140px]"
          data-testid={testId}
        >
          <LinkIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{value || "Select page…"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0 z-[10001]" align="start">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pages…"
              className="h-8 pl-8 text-sm"
              autoFocus
              data-testid={testId ? `${testId}-search` : undefined}
            />
          </div>
        </div>
        <ScrollArea className="h-48">
          {isLoading ? (
            <div className="p-3 text-xs text-muted-foreground text-center">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">No pages found</div>
          ) : (
            <div className="p-1">
              {filtered.map((entry) => {
                const path = sitemapPathname(entry.loc);
                return (
                  <button
                    key={path}
                    onClick={() => { onChange(path); setOpen(false); setSearch(""); }}
                    className={cn(
                      "w-full text-left px-2 py-1.5 rounded-md hover-elevate flex items-start gap-2",
                      value === path && "bg-primary/10"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{entry.label}</div>
                      <div className="text-xs text-muted-foreground truncate">{path}</div>
                    </div>
                    {value === path && <Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function SortableMarqueeMessageRow({
  id,
  msg,
  index,
  locale,
  onUpdate,
  onDelete,
}: {
  id: string;
  msg: MarqueeMessageSetting;
  index: number;
  locale: string;
  onUpdate: (updates: Partial<MarqueeMessageSetting>) => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const hasDetails = !!(msg.icon || msg.cta_label || msg.cta_url || (msg.cta_url_overrides && Object.keys(msg.cta_url_overrides).length > 0));
  const [expanded, setExpanded] = useState(hasDetails);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  const overrideEntries = Object.entries(msg.cta_url_overrides ?? {});

  const MsgIcon = (() => {
    if (msg.icon) {
      const Ic = getIcon(msg.icon);
      return Ic ?? Megaphone;
    }
    return Megaphone;
  })();

  return (
    <div ref={setNodeRef} style={style} className="group/marquee-msg border rounded-md p-2 space-y-2 bg-background" data-testid={`marquee-message-${index}`}>
      <div className="flex items-start gap-1">
        <button
          className="touch-none cursor-grab active:cursor-grabbing mt-1.5"
          {...attributes}
          {...listeners}
          data-testid={`button-drag-marquee-msg-${index}`}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
        <Input
          className="flex-1 text-sm"
          placeholder="Type your announcement…"
          value={msg.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          data-testid={`input-marquee-msg-text-${index}`}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setExpanded(v => !v)}
          title={expanded ? "Collapse" : "Expand options"}
          className="text-muted-foreground"
          data-testid={`button-marquee-msg-expand-${index}`}
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          className="text-destructive"
          data-testid={`button-delete-marquee-msg-${index}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {expanded && (
        <div className="pl-6 space-y-1">
          <Label className="text-xs text-muted-foreground">Icon</Label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIconPickerOpen(true)}
              className="flex items-center gap-2"
              data-testid={`button-marquee-msg-icon-picker-${index}`}
            >
              <MsgIcon className="h-4 w-4" />
              <span className="text-xs">{msg.icon || "Speakerphone (default)"}</span>
            </Button>
            {msg.icon && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onUpdate({ icon: undefined })}
                data-testid={`button-marquee-msg-icon-clear-${index}`}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            )}
          </div>
          <IconPickerModal
            open={iconPickerOpen}
            onOpenChange={setIconPickerOpen}
            currentValue={msg.icon}
            onSelect={(iconName) => onUpdate({ icon: iconName || undefined })}
            itemLabel="message"
          />
        </div>
      )}

      {expanded && (
        <div className="pl-6 space-y-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">CTA label (typed after message)</Label>
            <Input
              className="text-sm"
              placeholder="Learn more"
              value={msg.cta_label ?? ""}
              onChange={(e) => onUpdate({ cta_label: e.target.value || undefined })}
              data-testid={`input-marquee-msg-cta-label-${index}`}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">CTA URL</Label>
            <LinkPicker
              value={msg.cta_url ?? ""}
              onChange={(url) => onUpdate({ cta_url: url || undefined })}
              locale={locale}
              testId={`marquee-msg-${index}-cta-link-picker`}
            />
          </div>
          <div className="space-y-2 border border-muted-foreground p-2 rounded-md">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Override CTA link per page</Label>
                <p className="text-xs text-muted-foreground/70 leading-snug">
                  On specific pages, replace the CTA link above with a different destination.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs shrink-0 mt-0.5"
                onClick={() => onUpdate({ cta_url_overrides: { ...(msg.cta_url_overrides ?? {}), "": "" } })}
                data-testid={`button-marquee-msg-add-override-${index}`}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
            {overrideEntries.length > 0 && (
              <div className="space-y-1.5">
                {overrideEntries.map(([path, url], i) => (
                  <div key={i} className="space-y-1">
                    {i === 0 && (
                      <div className="flex items-center gap-1 px-0.5">
                        <span className="text-xs text-muted-foreground/60 w-[140px] shrink-0">When on page</span>
                        <span className="text-xs text-muted-foreground/60">Send to</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <PagePickerPopover
                        value={path}
                        locale={locale}
                        testId={`override-page-${index}-${i}`}
                        onChange={(newPath) => {
                          const newOverrides: Record<string, string> = {};
                          overrideEntries.forEach(([p, u], idx) => {
                            newOverrides[idx === i ? newPath : p] = u;
                          });
                          onUpdate({ cta_url_overrides: newOverrides });
                        }}
                      />
                      <span className="text-muted-foreground/40 text-xs shrink-0">→</span>
                      <LinkPicker
                        value={url}
                        onChange={(newUrl) => {
                          const newOverrides = { ...(msg.cta_url_overrides ?? {}), [path]: newUrl };
                          onUpdate({ cta_url_overrides: newOverrides });
                        }}
                        locale={locale}
                        contextPath={path || undefined}
                        testId={`override-url-${index}-${i}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          const newOverrides = { ...(msg.cta_url_overrides ?? {}) };
                          delete newOverrides[path];
                          onUpdate({ cta_url_overrides: Object.keys(newOverrides).length > 0 ? newOverrides : undefined });
                        }}
                        data-testid={`button-override-delete-${index}-${i}`}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuUsageInfo({ menuName }: { menuName: string }) {
  const { data, isLoading } = useQuery<MenuUsageResponse>({
    queryKey: ["/api/menus", menuName, "usage"],
    queryFn: async () => {
      const response = await fetch(`/api/menus/${menuName}/usage`);
      if (!response.ok) throw new Error("Failed to load usage");
      return response.json();
    },
    enabled: !!menuName,
  });

  if (isLoading) {
    return (
      <div className="bg-muted rounded-md p-4 mb-6" data-testid="menu-usage-skeleton">
        <div className="flex items-start gap-3">
          <Skeleton className="h-5 w-5 shrink-0 rounded" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { defaultContentTypes, overrides } = data;
  const hasDefaults = defaultContentTypes.length > 0;
  const hasOverrides = overrides.length > 0;

  if (!hasDefaults && !hasOverrides) {
    return (
      <div className="bg-muted rounded-md p-4 mb-6 flex items-start gap-3" data-testid="menu-usage-empty">
        <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <span className="text-sm text-muted-foreground">
          This menu is not currently assigned to any content.
        </span>
      </div>
    );
  }

  const typeNames = defaultContentTypes.map((ct) => ct.name);

  return (
    <div className="bg-muted rounded-md p-4 mb-6 flex items-start gap-3" data-testid="menu-usage-info">
      <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
      <span className="text-sm text-muted-foreground">
        {hasDefaults && (
          <>
            This menu is displayed in all{" "}
            {typeNames.map((name, i) => (
              <span key={name}>
                {i > 0 && i < typeNames.length - 1 && ", "}
                {i > 0 && i === typeNames.length - 1 && " and "}
                <strong className="text-foreground">{name}s</strong>
              </span>
            ))}
          </>
        )}
        {!hasDefaults && hasOverrides && "This menu is used in "}
        {hasOverrides && hasDefaults && " and "}
        {hasOverrides && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="text-primary underline underline-offset-2 hover:text-primary/80 inline"
                data-testid="button-show-overrides"
              >
                {overrides.length} additional URL{overrides.length !== 1 ? "s" : ""}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 max-h-60 overflow-auto" align="start">
              <div className="space-y-1">
                <p className="text-sm font-medium mb-2">Per-entry overrides</p>
                {overrides.map((o, i) => (
                  <div
                    key={`${o.contentType}-${o.slug}-${o.position}-${i}`}
                    className="flex items-center justify-between gap-2 text-xs py-1 border-b last:border-0"
                    data-testid={`override-item-${i}`}
                  >
                    <span className="text-foreground truncate">
                      {o.contentType}/{o.slug}
                    </span>
                    <span className="text-muted-foreground shrink-0">
                      {o.source} ({o.position})
                    </span>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
        .
      </span>
    </div>
  );
}

export default function MenuEditor() {
  const params = useParams<{ menuName: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const menuName = params.menuName || "";

  const [locale, setLocale] = useState<string>("en");
  const [pendingLocaleSwitch, setPendingLocaleSwitch] = useState<string | null>(null);
  const [yamlSource, setYamlSource] = useState<string>("");
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [navbarSettingsOpen, setNavbarSettingsOpen] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);
  const [showSourceSidebar, setShowSourceSidebar] = useState(false);
  const [originalYaml, setOriginalYaml] = useState<string>("");
  const [varModalOpen, setVarModalOpen] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const cmSidebarRef = useRef<ReactCodeMirrorRef>(null);
  const activeEditorRef = useRef<"main" | "sidebar">("main");
  
  const isEnglish = locale === "en";

  const parsedResult: { data: MenuData | null; error: string | null } = (() => {
    if (!yamlSource) return { data: null, error: null };
    try {
      const { escaped, map } = escapeTemplateVars(yamlSource);
      const parsed = unescapeObjectVars(yaml.load(escaped), map) as MenuData;
      return { data: parsed, error: null };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e.message : "Invalid YAML" };
    }
  })();

  const menuData = parsedResult.data;

  useEffect(() => {
    setYamlError(parsedResult.error);
  }, [parsedResult.error]);

  const updateYamlFromData = (newData: MenuData) => {
    try {
      const newYaml = safeYamlDump(newData, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
      });
      setYamlSource(newYaml);
      setHasChanges(true);
    } catch (e) {
      console.error("Failed to serialize YAML:", e);
    }
  };

  const { data, isLoading, error, refetch } = useQuery<MenuResponse>({
    queryKey: ["/api/menus", menuName, locale],
    queryFn: async () => {
      const response = await fetch(`/api/menus/${menuName}?locale=${locale}&raw=true`);
      if (!response.ok) throw new Error("Failed to load menu");
      return response.json();
    },
    enabled: !!menuName,
  });

  useEffect(() => {
    if (data?.data) {
      const initialYaml = safeYamlDump(data.data, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
      });
      setYamlSource(initialYaml);
      setOriginalYaml(initialYaml);
      setHasChanges(false);
    }
  }, [data]);
  
  const handleLocaleSwitch = (newLocale: string) => {
    if (newLocale === locale) return;
    
    if (hasChanges) {
      setPendingLocaleSwitch(newLocale);
    } else {
      setLocale(newLocale);
    }
  };
  
  const confirmLocaleSwitch = () => {
    if (pendingLocaleSwitch) {
      setLocale(pendingLocaleSwitch);
      setPendingLocaleSwitch(null);
      setHasChanges(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (yamlContent: string) => {
      const { escaped, map } = escapeTemplateVars(yamlContent);
      const parsedData = unescapeObjectVars(yaml.load(escaped), map) as MenuData;
      
      // Use different endpoints based on locale:
      // - English: structure endpoint (propagates to all translations)
      // - Other locales: translations endpoint (text-only changes)
      if (isEnglish) {
        return apiRequest("PUT", `/api/menus/${menuName}/structure`, { data: parsedData, author: getDebugUserName() });
      } else {
        return apiRequest("PUT", `/api/menus/${menuName}/translations?locale=${locale}`, { data: parsedData, author: getDebugUserName() });
      }
    },
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/menus", menuName, "en"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menus", menuName, "es"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menus"] });
      refetch();
      setOriginalYaml(yamlSource);
      setHasChanges(false);
      
      const syncMessage = response.syncResults && Object.keys(response.syncResults).length > 0
        ? ` Synced to: ${Object.keys(response.syncResults).join(", ")}`
        : "";
      
      const endpointMessage = isEnglish 
        ? `Structure saved and synced to translations.${syncMessage}`
        : `${locale.toUpperCase()} translations saved.`;
      
      toast({
        title: "Menu saved",
        description: `${endpointMessage} Refresh the homepage to see updates.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Error saving menu",
        description: error instanceof Error ? error.message : "Failed to save menu",
        variant: "destructive",
      });
    },
  });

  const isNavbarMenu = !!(menuData?.navbar?.items);
  const isFooterMenu = !!(menuData?.footer);
  const footerData = menuData?.footer;

  const updateFooter = (updates: Partial<FooterData>) => {
    if (!menuData || !footerData) return;
    updateYamlFromData({ ...menuData, footer: { ...footerData, ...updates } });
  };

  const updateFooterColumn = (colIndex: number, updates: Partial<FooterColumn>) => {
    if (!footerData) return;
    const newColumns = [...footerData.columns];
    const current = newColumns[colIndex];
    const next: FooterColumn = {
      title: updates.title ?? current.title,
      items: current.items,
    };
    if ("items_per_column" in updates) {
      if (
        typeof updates.items_per_column === "number" &&
        updates.items_per_column >= 1
      ) {
        next.items_per_column = updates.items_per_column;
      }
    } else if (typeof current.items_per_column === "number") {
      next.items_per_column = current.items_per_column;
    }
    newColumns[colIndex] = next;
    updateFooter({ columns: newColumns });
  };

  const updateFooterColumnItem = (colIndex: number, itemIndex: number, updates: Partial<FooterColumnItem>) => {
    if (!footerData) return;
    const newColumns = [...footerData.columns];
    const newItems = [...(newColumns[colIndex].items || [])];
    newItems[itemIndex] = { ...newItems[itemIndex], ...updates };
    newColumns[colIndex] = { ...newColumns[colIndex], items: newItems };
    updateFooter({ columns: newColumns });
  };

  const addFooterColumnItem = (colIndex: number) => {
    if (!footerData) return;
    const newColumns = [...footerData.columns];
    newColumns[colIndex] = {
      ...newColumns[colIndex],
      items: [...(newColumns[colIndex].items || []), { label: "New Item", href: "/new-page" }],
    };
    updateFooter({ columns: newColumns });
  };

  const deleteFooterColumnItem = (colIndex: number, itemIndex: number) => {
    if (!footerData) return;
    const newColumns = [...footerData.columns];
    newColumns[colIndex] = {
      ...newColumns[colIndex],
      items: (newColumns[colIndex].items || []).filter((_, i) => i !== itemIndex),
    };
    updateFooter({ columns: newColumns });
  };

  const reorderFooterColumnItems = (colIndex: number, oldIndex: number, newIndex: number) => {
    if (!footerData) return;
    const newColumns = [...footerData.columns];
    const items = [...(newColumns[colIndex].items || [])];
    newColumns[colIndex] = { ...newColumns[colIndex], items: arrayMove(items, oldIndex, newIndex) };
    updateFooter({ columns: newColumns });
  };

  const addFooterColumn = () => {
    if (!footerData) return;
    updateFooter({ columns: [...footerData.columns, { title: "New Column", items: [] }] });
  };

  const deleteFooterColumn = (colIndex: number) => {
    if (!footerData) return;
    updateFooter({ columns: footerData.columns.filter((_, i) => i !== colIndex) });
  };

  const updateFooterSocial = (index: number, updates: Partial<FooterSocial>) => {
    if (!footerData) return;
    const newSocials = [...(footerData.socials || [])];
    newSocials[index] = { ...newSocials[index], ...updates };
    updateFooter({ socials: newSocials });
  };

  const addFooterSocial = () => {
    if (!footerData) return;
    updateFooter({ socials: [...(footerData.socials || []), { name: "New Social", icon: "linkedin", link: "https://" }] });
  };

  const deleteFooterSocial = (index: number) => {
    if (!footerData) return;
    updateFooter({ socials: (footerData.socials || []).filter((_, i) => i !== index) });
  };

  const updateFooterLegalLink = (index: number, updates: Partial<FooterLegalLink>) => {
    if (!footerData) return;
    const newLinks = [...(footerData.legal_links || [])];
    newLinks[index] = { ...newLinks[index], ...updates };
    updateFooter({ legal_links: newLinks });
  };

  const addFooterLegalLink = () => {
    if (!footerData) return;
    updateFooter({ legal_links: [...(footerData.legal_links || []), { label: "New Link", href: "/new-page" }] });
  };

  const deleteFooterLegalLink = (index: number) => {
    if (!footerData) return;
    updateFooter({ legal_links: (footerData.legal_links || []).filter((_, i) => i !== index) });
  };

  const handleUpdateItem = (index: number, updatedItem: MenuItemData) => {
    if (!menuData || !menuData.navbar) return;
    const newItems = [...menuData.navbar.items];
    newItems[index] = updatedItem;
    updateYamlFromData({ ...menuData, navbar: { ...menuData.navbar, items: newItems } });
  };

  const handleDeleteItem = (index: number) => {
    if (!menuData || !menuData.navbar) return;
    const newItems = menuData.navbar.items.filter((_, i) => i !== index);
    updateYamlFromData({ ...menuData, navbar: { ...menuData.navbar, items: newItems } });
    setConfirmDeleteIndex(null);
  };

  const updateNavbarSettings = (updates: Partial<NavbarSettings>) => {
    if (!menuData || !menuData.navbar) return;
    updateYamlFromData({ ...menuData, navbar: { ...menuData.navbar, ...updates } });
  };

  const updateMarqueeSettings = (updates: Partial<MarqueeConfigSetting>) => {
    const current = menuData?.navbar?.marquee || {};
    updateNavbarSettings({ marquee: { ...current, ...updates } });
  };

  const updateMarqueeMessage = (index: number, updates: Partial<MarqueeMessageSetting>) => {
    const currentTexts = menuData?.navbar?.marquee?.texts || [];
    const newTexts = currentTexts.map((msg, i) => i === index ? { ...msg, ...updates } : msg);
    updateMarqueeSettings({ texts: newTexts });
  };

  const addMarqueeMessage = () => {
    const currentTexts = menuData?.navbar?.marquee?.texts || [];
    updateMarqueeSettings({ texts: [...currentTexts, { text: "" }] });
  };

  const deleteMarqueeMessage = (index: number) => {
    const currentTexts = menuData?.navbar?.marquee?.texts || [];
    updateMarqueeSettings({ texts: currentTexts.filter((_, i) => i !== index) });
  };

  const handleMarqueeDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const currentTexts = menuData?.navbar?.marquee?.texts || [];
    const oldIndex = currentTexts.findIndex((_, i) => `marquee-msg-${i}` === active.id);
    const newIndex = currentTexts.findIndex((_, i) => `marquee-msg-${i}` === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      updateMarqueeSettings({ texts: arrayMove(currentTexts, oldIndex, newIndex) });
    }
  };

  const handleAddItem = () => {
    if (!menuData || !menuData.navbar) return;
    const newItem: MenuItemData = {
      label: "NEW ITEM",
      href: "/new-page",
      component: "SimpleLink",
    };
    const newItems = [...menuData.navbar.items, newItem];
    updateYamlFromData({ ...menuData, navbar: { ...menuData.navbar, items: newItems } });
    setExpandedItems(new Set([...Array.from(expandedItems), newItems.length - 1]));
  };

  const handleSave = () => {
    if (!yamlSource || yamlError) return;
    saveMutation.mutate(yamlSource);
  };

  const handleYamlEdit = (newYaml: string) => {
    setYamlSource(newYaml);
    setHasChanges(newYaml !== originalYaml);
  };

  const handleCmUpdate = (update: import("@codemirror/view").ViewUpdate) => {
    const sel = update.state.selection.main;
    const text = sel.empty ? "" : update.state.sliceDoc(sel.from, sel.to);
    setSelectedText(text);
  };

  const handleVariableCreated = (_varName: string, templateSyntax: string) => {
    const ref = activeEditorRef.current === "sidebar" ? cmSidebarRef : cmRef;
    const view = ref.current?.view;
    if (!view) return;

    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: templateSyntax },
      selection: { anchor: from + templateSyntax.length },
    });

    const newVal = view.state.doc.toString();
    handleYamlEdit(newVal);
  };

  const toggleExpand = (index: number) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedItems(newExpanded);
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!menuData || !menuData.navbar || !over || active.id === over.id) return;

    const items = menuData.navbar.items;
    const oldIndex = items.findIndex((_, i) => `item-${i}` === active.id);
    const newIndex = items.findIndex((_, i) => `item-${i}` === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const draggedItem = items[oldIndex];
    const targetItem = items[newIndex];
    const isSpecial = (item: { component: string }) => item.component === "Logo" || item.component === "LanguageSwitcher";

    if (isSpecial(draggedItem) || isSpecial(targetItem)) return;

    const newItems = arrayMove(items, oldIndex, newIndex);
    updateYamlFromData({ ...menuData, navbar: { ...menuData.navbar, items: newItems } });
  };

  const handleFooterDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!footerData || !over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const itemMatch = activeId.match(/^footer-col-(\d+)-item-(\d+)$/);
    if (itemMatch) {
      const colIndex = parseInt(itemMatch[1], 10);
      const overItemMatch = overId.match(/^footer-col-(\d+)-item-(\d+)$/);
      if (overItemMatch && parseInt(overItemMatch[1], 10) === colIndex) {
        const oldIndex = parseInt(itemMatch[2], 10);
        const newIndex = parseInt(overItemMatch[2], 10);
        reorderFooterColumnItems(colIndex, oldIndex, newIndex);
      }
      return;
    }

    const oldIndex = footerData.columns.findIndex((_, i) => `footer-col-${i}` === activeId);
    const newIndex = footerData.columns.findIndex((_, i) => `footer-col-${i}` === overId);

    if (oldIndex !== -1 && newIndex !== -1) {
      const newColumns = arrayMove(footerData.columns, oldIndex, newIndex);
      updateFooter({ columns: newColumns });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || (!menuData && !yamlError)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">Failed to load menu</p>
          <Button variant="outline" onClick={() => navigate("/")}>
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background border-b">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/")}
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                <Menu className="h-5 w-5 text-primary" />
                {menuName}
              </h1>
              <p className="text-sm text-muted-foreground">Menu Editor</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center border rounded-md overflow-hidden">
              <button
                type="button"
                onClick={() => handleLocaleSwitch("en")}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  locale === "en"
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-muted"
                }`}
                data-testid="button-locale-en"
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => handleLocaleSwitch("es")}
                className={`px-3 py-1.5 text-sm font-medium border-l transition-colors ${
                  locale === "es"
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-muted"
                }`}
                data-testid="button-locale-es"
              >
                ES
              </button>
            </div>
            {hasChanges && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                Unsaved changes
              </span>
            )}
            <Button
              variant="outline"
              onClick={() => setShowSourceSidebar(true)}
              data-testid="button-view-source"
            >
              <FileCode className="h-4 w-4 mr-2" />
              View Source
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending || !!yamlError}
              data-testid="button-save-menu"
            >
              {saveMutation.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Changes
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="max-w-5xl mx-auto">
          {yamlError && (
            <Card className="mb-6 border-destructive">
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-destructive">
                  <Code className="h-5 w-5" />
                  <span className="font-medium">YAML Error</span>
                </div>
                <p className="text-sm text-muted-foreground mt-2 font-mono">{yamlError}</p>
              </CardContent>
            </Card>
          )}

          <MenuUsageInfo menuName={menuName} />

          {menuData && isNavbarMenu && (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Menu Items ({menuData.navbar!.items.length})
                </h2>
                {isEnglish && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddItem}
                    data-testid="button-add-item"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Item
                  </Button>
                )}
              </div>

              <ScrollArea className="max-h-[calc(100vh-200px)]">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={menuData.navbar!.items.map((_, i) => `item-${i}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    {menuData.navbar!.items.map((item, index) => {
                      const isSpecialItem = item.component === "Logo" || item.component === "LanguageSwitcher";
                      return (
                        <SortableMenuItemEditor
                          key={`item-${index}`}
                          id={`item-${index}`}
                          item={item}
                          index={index}
                          onUpdate={handleUpdateItem}
                          onDelete={isEnglish && !isSpecialItem ? (idx) => setConfirmDeleteIndex(idx) : undefined}
                          isExpanded={expandedItems.has(index)}
                          onToggleExpand={toggleExpand}
                          isReadOnlyStructure={!isEnglish || isSpecialItem}
                          locale={locale}
                        />
                      );
                    })}
                  </SortableContext>
                </DndContext>
                {menuData.navbar!.items.length === 0 && isEnglish && (
                  <div className="text-center py-12">
                    <Menu className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground mb-4">No menu items yet</p>
                    <Button onClick={handleAddItem} data-testid="button-add-first-item">
                      <Plus className="h-4 w-4 mr-2" />
                      Add First Item
                    </Button>
                  </div>
                )}
              </ScrollArea>

              <div className="mt-4 border rounded-md">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium rounded-md hover-elevate"
                    onClick={() => setNavbarSettingsOpen((v) => !v)}
                    data-testid="button-navbar-settings-toggle"
                  >
                    <span>Menu Settings</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {(() => {
                          const s = menuData!.navbar!.size;
                          const sizeLabel = s !== undefined ? `${s}px` : "Default (64px)";
                          const marginLabel = menuData!.navbar!.constrained_margin ? "Constrained" : "Full width";
                          const stickyLabel = menuData!.navbar!.sticky === false ? "Not sticky" : "Sticky";
                          const subtleTopLabel = menuData!.navbar!.subtle_at_top ? "Subtle at top" : null;
                          const floatingLabel = menuData!.navbar!.floating ? "Floating" : null;
                          const marqueeLabel = menuData!.navbar!.marquee?.enabled ? `Marquee (${menuData!.navbar!.marquee.texts?.length || 0} msg)` : null;
                          return [sizeLabel, marginLabel, stickyLabel, subtleTopLabel, floatingLabel, marqueeLabel].filter(Boolean).join(" · ");
                        })()}
                      </span>
                      {navbarSettingsOpen
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {navbarSettingsOpen && (
                    <div className="px-4 py-4 border-t space-y-5">
                      {!isEnglish && (
                        <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
                          Layout settings apply to all languages and can only be changed in English.
                        </p>
                      )}
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <Label className={`text-sm font-medium ${!isEnglish ? "text-muted-foreground" : ""}`}>Constrained margin</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Limits content to a centered max-width container
                          </p>
                        </div>
                        <Switch
                          checked={!!menuData!.navbar!.constrained_margin}
                          onCheckedChange={(checked) => updateNavbarSettings({ constrained_margin: checked || undefined })}
                          disabled={!isEnglish}
                          data-testid="switch-constrained-margin"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className={`text-sm font-medium ${!isEnglish ? "text-muted-foreground" : ""}`}>Navbar size</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={20}
                            placeholder="64"
                            value={menuData!.navbar!.size ?? ""}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              updateNavbarSettings({ size: val || undefined });
                            }}
                            disabled={!isEnglish}
                            data-testid="input-navbar-size"
                          />
                          <span className="text-sm text-muted-foreground shrink-0">px</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <Label className={`text-sm font-medium ${!isEnglish ? "text-muted-foreground" : ""}`}>Sticky header</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Header stays fixed at the top while scrolling
                          </p>
                        </div>
                        <Switch
                          checked={menuData!.navbar!.sticky !== false}
                          onCheckedChange={(checked) => updateNavbarSettings({ sticky: checked ? undefined : false })}
                          disabled={!isEnglish}
                          data-testid="switch-sticky"
                        />
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <Label className={`text-sm font-medium ${!isEnglish ? "text-muted-foreground" : ""}`}>Subtle at top</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Make navbar transparent and compact at page top, then restore on scroll
                          </p>
                        </div>
                        <Switch
                          checked={!!menuData!.navbar!.subtle_at_top}
                          onCheckedChange={(checked) => updateNavbarSettings({ subtle_at_top: checked || undefined })}
                          disabled={!isEnglish}
                          data-testid="switch-subtle-at-top"
                        />
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <Label className={`text-sm font-medium ${!isEnglish ? "text-muted-foreground" : ""}`}>Floating</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Add margin, rounded corners, border and a soft shadow to the navbar chrome
                          </p>
                        </div>
                        <Switch
                          checked={!!menuData!.navbar!.floating}
                          onCheckedChange={(checked) => updateNavbarSettings({ floating: checked || undefined })}
                          disabled={!isEnglish}
                          data-testid="switch-floating-navbar"
                        />
                      </div>

                      <div className="border rounded-md">
                        <div className="flex items-center justify-between gap-4 px-3 py-3">
                          <div>
                            <Label className="text-sm font-medium">Marquee bar</Label>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Show an animated text strip near the menu
                            </p>
                          </div>
                          <Switch
                            checked={!!menuData!.navbar!.marquee?.enabled}
                            onCheckedChange={(checked) => updateMarqueeSettings({ enabled: checked || undefined })}
                            data-testid="switch-marquee"
                          />
                        </div>

                        {menuData!.navbar!.marquee?.enabled && (
                          <div className="border-t px-3 py-3 space-y-4">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <Label className="text-sm font-medium">Messages</Label>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={addMarqueeMessage}
                                  data-testid="button-add-marquee-message"
                                >
                                  <Plus className="h-3 w-3 mr-1" />
                                  Add message
                                </Button>
                              </div>

                              <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleMarqueeDragEnd}
                              >
                                <SortableContext
                                  items={(menuData!.navbar!.marquee?.texts || []).map((_, i) => `marquee-msg-${i}`)}
                                  strategy={verticalListSortingStrategy}
                                >
                                  <div className="space-y-2">
                                    {(menuData!.navbar!.marquee?.texts || []).map((msg, index) => (
                                      <SortableMarqueeMessageRow
                                        key={`marquee-msg-${index}`}
                                        id={`marquee-msg-${index}`}
                                        msg={msg}
                                        index={index}
                                        locale={locale}
                                        onUpdate={(updates) => updateMarqueeMessage(index, updates)}
                                        onDelete={() => deleteMarqueeMessage(index)}
                                      />
                                    ))}
                                    {(!menuData!.navbar!.marquee?.texts || menuData!.navbar!.marquee.texts.length === 0) && (
                                      <p className="text-xs text-muted-foreground text-center py-2">No messages yet — add one above</p>
                                    )}
                                  </div>
                                </SortableContext>
                              </DndContext>
                            </div>

                            <div className="space-y-1.5">
                              <Label className="text-sm font-medium">Position</Label>
                              <div className="flex gap-1">
                                {(["above", "below"] as const).map((pos) => (
                                  <Button
                                    key={pos}
                                    variant={( menuData!.navbar!.marquee?.position ?? "below") === pos ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => updateMarqueeSettings({ position: pos })}
                                    data-testid={`button-marquee-position-${pos}`}
                                  >
                                    {pos.charAt(0).toUpperCase() + pos.slice(1)}
                                  </Button>
                                ))}
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-3">
                              <Label className="text-sm font-medium whitespace-nowrap">Show on</Label>
                              <div className="flex rounded-md border border-border overflow-hidden">
                                {([
                                  { id: "", label: "Both" },
                                  { id: "desktop", label: "Desktop" },
                                  { id: "mobile", label: "Mobile" },
                                ] as const).map((option, index) => {
                                  const currentShowOn = menuData!.navbar!.marquee?.show_on ?? "";
                                  const isSelected = currentShowOn === option.id;
                                  return (
                                    <button
                                      key={option.id || "both"}
                                      type="button"
                                      onClick={() => updateMarqueeSettings({ show_on: option.id || undefined })}
                                      className={`px-3 py-1.5 text-sm transition-colors ${
                                        isSelected
                                          ? "bg-primary text-primary-foreground"
                                          : "bg-transparent text-muted-foreground hover:bg-muted"
                                      } ${index !== 0 ? "border-l border-border" : ""}`}
                                      data-testid={`button-marquee-show-on-${option.id || "both"}`}
                                    >
                                      {option.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <Label className="text-sm font-medium">Sticky</Label>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Keep the marquee visible while scrolling
                                </p>
                              </div>
                              <Switch
                                checked={!!menuData!.navbar!.marquee?.sticky}
                                onCheckedChange={(checked) => updateMarqueeSettings({ sticky: checked || undefined })}
                                data-testid="switch-marquee-sticky"
                              />
                            </div>

                            <ColorPicker
                              value={menuData!.navbar!.marquee?.background ?? ""}
                              onChange={(value) => updateMarqueeSettings({ background: value || undefined })}
                              type="background"
                              label="Background color"
                              testIdPrefix="marquee-bg"
                            />

                            <div className="space-y-2">
                              <Label className="text-sm font-medium">Timing</Label>
                              <div className="grid grid-cols-3 gap-2">
                                <div className="space-y-1">
                                  <Label className="text-xs text-muted-foreground">Start delay (ms)</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    placeholder="600"
                                    value={menuData!.navbar!.marquee?.start_delay ?? ""}
                                    onChange={(e) => updateMarqueeSettings({ start_delay: parseInt(e.target.value, 10) || undefined })}
                                    data-testid="input-marquee-start-delay"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs text-muted-foreground">Char delay (ms)</Label>
                                  <Input
                                    type="number"
                                    min={1}
                                    placeholder="40"
                                    value={menuData!.navbar!.marquee?.char_delay ?? ""}
                                    onChange={(e) => updateMarqueeSettings({ char_delay: parseInt(e.target.value, 10) || undefined })}
                                    data-testid="input-marquee-char-delay"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs text-muted-foreground">Display time (ms)</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    placeholder="3000"
                                    value={menuData!.navbar!.marquee?.display_time ?? ""}
                                    onChange={(e) => updateMarqueeSettings({ display_time: parseInt(e.target.value, 10) || undefined })}
                                    data-testid="input-marquee-display-time"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
              </div>
            </>
          )}

          {menuData && isFooterMenu && footerData && (
            <ScrollArea className="h-[calc(100vh-200px)]">
              <div className="space-y-8">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-medium text-muted-foreground">
                      Footer Columns ({footerData.columns?.length || 0})
                    </h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addFooterColumn}
                      data-testid="button-add-footer-column"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Column
                    </Button>
                  </div>

                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleFooterDragEnd}
                  >
                    <SortableContext
                      items={(footerData.columns || []).map((_, i) => `footer-col-${i}`)}
                      strategy={horizontalListSortingStrategy}
                    >
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 p-6 bg-popover border border-border rounded-lg">
                        {(footerData.columns || []).map((column, colIndex) => (
                          <SortableFooterColumn
                            key={`footer-col-${colIndex}`}
                            id={`footer-col-${colIndex}`}
                            column={column}
                            colIndex={colIndex}
                            isEnglish={isEnglish}
                            locale={locale}
                            onDeleteColumn={deleteFooterColumn}
                            onUpdateColumn={updateFooterColumn}
                            onUpdateColumnItem={updateFooterColumnItem}
                            onDeleteColumnItem={deleteFooterColumnItem}
                            onAddColumnItem={addFooterColumnItem}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-medium text-muted-foreground">
                      Social Links ({footerData.socials?.length || 0})
                    </h2>
                    {isEnglish && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={addFooterSocial}
                        data-testid="button-add-footer-social"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Social
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2">
                    {(footerData.socials || []).map((social, index) => (
                      <Card key={index} className="p-3" data-testid={`footer-social-${index}`}>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 grid grid-cols-3 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Name</Label>
                              <Input
                                value={social.name}
                                onChange={(e) => updateFooterSocial(index, { name: e.target.value })}
                                placeholder="Social name"
                                className="h-8 text-sm"
                                data-testid={`footer-social-${index}-name`}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Icon</Label>
                              <Select
                                value={social.icon}
                                onValueChange={(icon) => updateFooterSocial(index, { icon })}
                              >
                                <SelectTrigger className="h-8 text-sm" data-testid={`footer-social-${index}-icon`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="linkedin">Linkedin</SelectItem>
                                  <SelectItem value="facebook">Facebook</SelectItem>
                                  <SelectItem value="x-logo">X (Twitter)</SelectItem>
                                  <SelectItem value="instagram">Instagram</SelectItem>
                                  <SelectItem value="youtube">YouTube</SelectItem>
                                  <SelectItem value="tiktok">TikTok</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">URL</Label>
                              <div className="relative">
                                <LinkIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                <Input
                                  value={social.link}
                                  onChange={(e) => updateFooterSocial(index, { link: e.target.value })}
                                  placeholder="https://..."
                                  className="h-8 text-sm pl-7"
                                  data-testid={`footer-social-${index}-link`}
                                />
                              </div>
                            </div>
                          </div>
                          {isEnglish && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteFooterSocial(index)}
                              className="text-destructive hover:text-destructive flex-shrink-0"
                              data-testid={`footer-social-${index}-delete`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-medium text-muted-foreground">
                      Legal Links ({footerData.legal_links?.length || 0})
                    </h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addFooterLegalLink}
                      data-testid="button-add-footer-legal"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Link
                    </Button>
                  </div>

                  <div className="p-4 bg-popover border border-border rounded-lg">
                    <ul className="space-y-1">
                      {(footerData.legal_links || []).map((link, index) => (
                        <li key={index}>
                          <EditableLinkItem
                            label={link.label || ""}
                            href={link.href || ""}
                            onLabelChange={(label) => updateFooterLegalLink(index, { label })}
                            onHrefChange={(href) => updateFooterLegalLink(index, { href })}
                            onSave={(label, href) => updateFooterLegalLink(index, { label, href })}
                            onDelete={() => deleteFooterLegalLink(index)}
                            testIdPrefix={`footer-legal-${index}`}
                            isReadOnlyStructure={false}
                            locale={locale}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-medium text-muted-foreground mb-4">
                    Copyright Text
                  </h2>
                  <Input
                    value={footerData.copyright_text || ""}
                    onChange={(e) => updateFooter({ copyright_text: e.target.value })}
                    placeholder="2024 4Geeks Academy. All rights reserved."
                    data-testid="footer-copyright-input"
                  />
                </div>
              </div>
            </ScrollArea>
          )}

          {menuData && !isNavbarMenu && !isFooterMenu && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-muted-foreground">
                  YAML Editor
                </h2>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!selectedText}
                    onClick={() => { activeEditorRef.current = "main"; setVarModalOpen(true); }}
                    data-testid="button-insert-variable-main"
                  >
                    <Braces className="h-4 w-4 mr-1" />
                    Convert to Variable
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Edit the menu content directly in YAML
                  </p>
                </div>
              </div>
              <div data-testid="codemirror-yaml-editor">
                <CodeMirror
                  ref={cmRef}
                  value={yamlSource}
                  height="calc(100vh - 250px)"
                  extensions={[yamlLang()]}
                  theme={oneDark}
                  onChange={(value) => handleYamlEdit(value)}
                  onUpdate={handleCmUpdate}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      <Sheet open={showSourceSidebar} onOpenChange={setShowSourceSidebar}>
        <SheetContent className="w-[600px] sm:max-w-[600px] flex flex-col p-0">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between border-b">
            <div className="flex items-center gap-2">
              <FileCode className="h-5 w-5 text-primary" />
              <span className="font-semibold">YAML Source</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!selectedText}
                onClick={() => { activeEditorRef.current = "sidebar"; setVarModalOpen(true); }}
                data-testid="button-insert-variable-sidebar"
              >
                <Braces className="h-4 w-4 mr-1" />
                Convert to Variable
              </Button>
              {yamlError && (
                <span className="text-xs text-destructive">Invalid YAML</span>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-hidden" data-testid="codemirror-yaml-source">
            <CodeMirror
              ref={cmSidebarRef}
              value={yamlSource}
              height="calc(100vh - 80px)"
              extensions={[yamlLang()]}
              theme={oneDark}
              onChange={(value) => handleYamlEdit(value)}
              onUpdate={handleCmUpdate}
            />
          </div>
        </SheetContent>
      </Sheet>

      <VariableDetailModal
        open={varModalOpen}
        onOpenChange={setVarModalOpen}
        variableName=""
        inlineDefault={selectedText}
        mode="create"
        onCreated={handleVariableCreated}
      />

      <Dialog open={confirmDeleteIndex !== null} onOpenChange={() => setConfirmDeleteIndex(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Menu Item</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this menu item? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteIndex(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeleteIndex !== null && handleDeleteItem(confirmDeleteIndex)}
              data-testid="button-confirm-delete"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingLocaleSwitch !== null} onOpenChange={() => setPendingLocaleSwitch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch Language?</DialogTitle>
            <DialogDescription>
              You have unsaved changes. Switching languages will discard your changes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingLocaleSwitch(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmLocaleSwitch}
              data-testid="button-confirm-locale-switch"
            >
              Discard Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
