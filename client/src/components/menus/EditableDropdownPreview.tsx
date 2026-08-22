import { useState } from "react";
import { BarChart3, Brain, Briefcase, Building, ChevronRight, Code, GraduationCap, GripVertical, Link, Medal, Pencil, Plus, Puzzle, Settings, Shield, Trash2, Wifi, X } from "lucide-react";
import { RichTextArea } from "@/components/editing/RichTextArea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SitemapSearch } from "./SitemapSearch";
import {
  cardsGridColsClass,
  cardsPanelNominalWidthPx,
  resolveCardsLayout,
  type CardsLayoutConfig,
  type CardsLayoutMode,
  CARDS_COLUMN_WIDTH_PX,
} from "./cardsLayout";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  code: Code,
  chart: BarChart3,
  shield: Shield,
  brain: Brain,
  medal: Medal,
  "graduation-cap": GraduationCap,
  building: Building,
  briefcase: Briefcase,
  puzzle: Puzzle,
  wifi: Wifi,
};

const iconOptions = [
  { value: "code", label: "Code" },
  { value: "chart", label: "Chart" },
  { value: "shield", label: "Shield" },
  { value: "brain", label: "Brain" },
  { value: "medal", label: "Medal" },
  { value: "graduation-cap", label: "Graduation Cap" },
  { value: "building", label: "Building" },
  { value: "briefcase", label: "Briefcase" },
  { value: "puzzle", label: "Puzzle" },
  { value: "wifi", label: "Wifi" },
];

interface EditableTextProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  as?: "span" | "h3" | "h4" | "p" | "a";
  testId?: string;
}

export function EditableText({ value, onChange, placeholder, className, as: Tag = "span", testId }: EditableTextProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);

  const handleSave = () => {
    onChange(tempValue);
    setIsEditing(false);
  };

  return (
    <Popover open={isEditing} onOpenChange={setIsEditing}>
      <PopoverTrigger asChild>
        <Tag
          className={`group relative cursor-pointer inline-flex items-center gap-1 ${className || ""}`}
          onClick={() => {
            setTempValue(value);
            setIsEditing(true);
          }}
          data-testid={testId}
        >
          {value || <span className="text-muted-foreground italic">{placeholder}</span>}
          <Pencil className="h-3 w-3 text-primary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        </Tag>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="flex gap-2">
          <Input
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            placeholder={placeholder}
            className="h-8 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") setIsEditing(false);
            }}
            data-testid={testId ? `${testId}-input` : undefined}
          />
          <Button size="sm" className="h-8" onClick={handleSave} data-testid={testId ? `${testId}-save` : undefined}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface EditableLinkItemProps {
  label: string;
  href: string;
  onLabelChange: (label: string) => void;
  onHrefChange: (href: string) => void;
  onSave?: (label: string, href: string) => void;
  onDelete: () => void;
  testIdPrefix: string;
  isReadOnlyStructure?: boolean;
  locale?: string;
}

export function EditableLinkItem({ label, href, onLabelChange, onHrefChange, onSave, onDelete, testIdPrefix, isReadOnlyStructure = false, locale = "en" }: EditableLinkItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempLabel, setTempLabel] = useState(label);
  const [tempHref, setTempHref] = useState(href);

  const handleSave = () => {
    if (onSave) {
      onSave(tempLabel, tempHref);
    } else {
      onLabelChange(tempLabel);
      onHrefChange(tempHref);
    }
    setIsEditing(false);
  };

  return (
    <div className="group/item flex items-center gap-1">
      <Popover open={isEditing} onOpenChange={(open) => {
        if (open) {
          setTempLabel(label);
          setTempHref(href);
        }
        setIsEditing(open);
      }}>
        <PopoverTrigger asChild>
          <button
            className="flex-1 flex items-center justify-between px-2 py-2 rounded-md text-sm text-foreground hover-elevate text-left"
            data-testid={`${testIdPrefix}-trigger`}
          >
            <span className="flex items-center gap-1">
              {label || <span className="text-muted-foreground italic">Item label</span>}
              <Pencil className="h-3 w-3 text-primary opacity-0 group-hover/item:opacity-100 transition-opacity" />
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3" align="start">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Label</Label>
              <Input
                value={tempLabel}
                onChange={(e) => setTempLabel(e.target.value)}
                placeholder="Item label"
                className="h-8 text-sm"
                autoFocus
                data-testid={`${testIdPrefix}-label-input`}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">URL</Label>
              <SitemapSearch
                value={tempHref}
                onChange={(url) => setTempHref(url)}
                locale={locale}
                testId={`${testIdPrefix}-href`}
              />
            </div>
            <Button size="sm" className="w-full h-8" onClick={handleSave} data-testid={`${testIdPrefix}-save`}>
              Save
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {!isReadOnlyStructure && (
        <button
          onClick={onDelete}
          className="p-1 rounded-md text-destructive opacity-0 group-hover/item:opacity-100 transition-opacity"
          data-testid={`${testIdPrefix}-delete`}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

interface EditableIconProps {
  value?: string;
  onChange: (value: string) => void;
  testId?: string;
}

function EditableIcon({ value, onChange, testId }: EditableIconProps) {
  const [isEditing, setIsEditing] = useState(false);
  const IconComponent = value ? iconMap[value] : null;

  return (
    <Popover open={isEditing} onOpenChange={setIsEditing}>
      <PopoverTrigger asChild>
        <div 
          className="group relative cursor-pointer w-12 h-12 flex items-center justify-center rounded-lg bg-primary/10 text-primary"
          data-testid={testId}
        >
          {IconComponent ? (
            <IconComponent className="w-6 h-6" />
          ) : (
            <Plus className="w-6 h-6 opacity-50" />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
            <Pencil className="h-4 w-4 text-primary" />
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="start">
        <div className="grid grid-cols-4 gap-2">
          {iconOptions.map((icon) => {
            const Icon = iconMap[icon.value];
            return (
              <button
                key={icon.value}
                onClick={() => {
                  onChange(icon.value);
                  setIsEditing(false);
                }}
                className={`p-2 rounded-md hover-elevate ${value === icon.value ? "bg-primary/20" : ""}`}
                title={icon.label}
                data-testid={testId ? `${testId}-option-${icon.value}` : undefined}
              >
                <Icon className="w-5 h-5" />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface CardItem {
  title: string;
  description: string;
  cta: string;
  href: string;
  icon?: string;
}

interface ColumnItem {
  label: string;
  href: string;
}

interface Column {
  title: string;
  items: ColumnItem[];
}

interface GroupItem {
  label: string;
  href: string;
}

interface Group {
  title: string;
  items: GroupItem[];
}

interface CardsDropdownData {
  type: "cards";
  title?: string;
  description?: string;
  layout?: CardsLayoutConfig;
  items?: CardItem[];
  footer?: {
    text: string;
  };
}

interface ColumnsDropdownData {
  type: "columns";
  title?: string;
  description?: string;
  icon?: string;
  columns?: Column[];
}

interface SimpleListDropdownData {
  type: "simple-list";
  title?: string;
  description?: string;
  icon?: string;
  items?: ColumnItem[];
}

interface GroupedListDropdownData {
  type: "grouped-list";
  title?: string;
  description?: string;
  icon?: string;
  groups?: Group[];
}

type DropdownData = CardsDropdownData | ColumnsDropdownData | SimpleListDropdownData | GroupedListDropdownData;

interface EditableDropdownPreviewProps {
  dropdown: DropdownData;
  onChange: (dropdown: DropdownData) => void;
  isReadOnlyStructure?: boolean;
  locale?: string;
}

function EditableCardItem({
  item,
  index,
  onUpdate,
  onDelete,
  isReadOnlyStructure = false,
  locale = "en",
}: {
  item: CardItem;
  index: number;
  onUpdate: (updates: Partial<CardItem>) => void;
  onDelete: () => void;
  isReadOnlyStructure?: boolean;
  locale?: string;
}) {
  return (
    <div className="group/card relative block rounded-lg p-3 border border-transparent hover:border-border">
      {!isReadOnlyStructure && (
        <button
          onClick={onDelete}
          className="absolute top-1 right-1 p-1 rounded-md bg-destructive/10 text-destructive opacity-0 group-hover/card:opacity-100 transition-opacity"
          data-testid={`editable-card-${index}-delete`}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
      
      <div className="mb-3 transition-all duration-200 group-hover/card:ml-8">
        <EditableIcon
          value={item.icon}
          onChange={(icon) => onUpdate({ icon })}
          testId={`editable-card-${index}-icon`}
        />
      </div>
      <EditableText
        value={item.title}
        onChange={(title) => onUpdate({ title })}
        placeholder="Card title"
        className="font-semibold text-foreground mb-2 block"
        as="h4"
        testId={`editable-card-${index}-title`}
      />
      <EditableText
        value={item.description}
        onChange={(description) => onUpdate({ description })}
        placeholder="Card description"
        className="text-sm text-muted-foreground mb-3 block line-clamp-3"
        as="p"
        testId={`editable-card-${index}-description`}
      />
      <EditableText
        value={item.cta}
        onChange={(cta) => onUpdate({ cta })}
        placeholder="CTA text"
        className="inline-flex items-center text-sm font-medium border border-border rounded-md px-3 py-1.5"
        testId={`editable-card-${index}-cta`}
      />
      
      <div className="mt-2">
        <SitemapSearch
          value={item.href}
          onChange={(href) => onUpdate({ href })}
          testId={`editable-card-${index}-href`}
          locale={locale}
        />
      </div>
    </div>
  );
}

function SortableCardItem({
  id,
  item,
  index,
  onUpdate,
  onDelete,
  isReadOnlyStructure = false,
  locale = "en",
}: {
  id: string;
  item: CardItem;
  index: number;
  onUpdate: (updates: Partial<CardItem>) => void;
  onDelete: () => void;
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

  return (
    <div ref={setNodeRef} style={style} className="group/card relative">
      {!isReadOnlyStructure && (
        <div
          {...attributes}
          {...listeners}
          className="absolute top-4 left-4 p-1 rounded-md bg-background/80 border border-border text-muted-foreground opacity-0 group-hover/card:opacity-100 hover:bg-muted cursor-grab active:cursor-grabbing z-10"
          data-testid={`editable-card-${index}-drag-handle`}
        >
          <GripVertical className="h-4 w-4" />
        </div>
      )}
      <EditableCardItem
        item={item}
        index={index}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isReadOnlyStructure={isReadOnlyStructure}
        locale={locale}
      />
    </div>
  );
}

function EditableCardsPreview({ 
  dropdown, 
  onChange,
  isReadOnlyStructure = false,
  locale = "en",
}: { 
  dropdown: CardsDropdownData; 
  onChange: (dropdown: CardsDropdownData) => void;
  isReadOnlyStructure?: boolean;
  locale?: string;
}) {
  const items = dropdown.items || [];
  const itemIds = items.map((_, index) => `card-${index}`);
  const [editingFooter, setEditingFooter] = useState(false);
  const [footerDraft, setFooterDraft] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      const oldIndex = itemIds.indexOf(active.id as string);
      const newIndex = itemIds.indexOf(over.id as string);
      const newItems = arrayMove(items, oldIndex, newIndex);
      onChange({ ...dropdown, items: newItems });
    }
  };

  const updateItem = (index: number, updates: Partial<CardItem>) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], ...updates };
    onChange({ ...dropdown, items: newItems });
  };

  const addItem = () => {
    const newItem: CardItem = {
      title: "New Card",
      description: "Card description",
      cta: "Learn More",
      href: "/new-page",
      icon: "code",
    };
    onChange({ ...dropdown, items: [...items, newItem] });
  };

  const deleteItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    onChange({ ...dropdown, items: newItems });
  };

  const { mode, cols } = resolveCardsLayout(items.length, dropdown.layout);
  const colsClass = cardsGridColsClass(cols);
  const panelWidth =
    mode === "max" ? cardsPanelNominalWidthPx(items.length, dropdown.layout) : undefined;

  const updateLayout = (updates: Partial<CardsLayoutConfig>) => {
    const nextMode = (updates.mode ?? dropdown.layout?.mode ?? "max") as CardsLayoutMode;
    const nextCount = updates.count ?? dropdown.layout?.count ?? 4;
    onChange({
      ...dropdown,
      layout: {
        mode: nextMode,
        count: Math.min(Math.max(nextCount, 1), 4),
      },
    });
  };

  // w-0 min-w-full keeps this from expanding ScrollArea/table parents; overflow-x
  // shows a scrollbar when max-mode nominal width exceeds the editor container.
  return (
    <div className="w-0 min-w-full max-w-full overflow-x-auto overscroll-x-contain">
    <div
      className="p-6 bg-popover border border-border rounded-lg min-w-0"
      style={panelWidth != null ? { width: panelWidth } : undefined}
    >
      <div className="mb-6">
        <EditableText
          value={dropdown.title || ""}
          onChange={(title) => onChange({ ...dropdown, title })}
          placeholder="Dropdown Title"
          className="text-lg font-semibold text-foreground mb-1 block"
          as="h3"
          testId="editable-cards-title"
        />
        <EditableText
          value={dropdown.description || ""}
          onChange={(description) => onChange({ ...dropdown, description })}
          placeholder="Dropdown description"
          className="text-sm text-muted-foreground block"
          as="p"
          testId="editable-cards-description"
        />
      </div>
      
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={itemIds} strategy={rectSortingStrategy}>
          <div className={`grid gap-4 ${colsClass}`}>
            {items.map((item, index) => (
              <div
                key={`card-${index}`}
                style={mode === "max" ? { width: CARDS_COLUMN_WIDTH_PX, minWidth: CARDS_COLUMN_WIDTH_PX } : undefined}
                className="min-w-0"
              >
                <SortableCardItem
                  id={`card-${index}`}
                  item={item}
                  index={index}
                  onUpdate={(updates) => updateItem(index, updates)}
                  onDelete={() => deleteItem(index)}
                  isReadOnlyStructure={isReadOnlyStructure}
                  locale={locale}
                />
              </div>
            ))}
            
            {!isReadOnlyStructure && (
              <div
                className="flex flex-col rounded-lg border-2 border-dashed border-muted-foreground/30 min-h-[200px] overflow-hidden min-w-0"
                style={mode === "max" ? { width: CARDS_COLUMN_WIDTH_PX, minWidth: CARDS_COLUMN_WIDTH_PX } : undefined}
                data-testid="editable-cards-actions"
              >
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center justify-center gap-2 px-3 py-2.5 border-b border-dashed border-muted-foreground/30 text-sm text-muted-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-foreground transition-colors"
                      data-testid="editable-cards-layout-settings"
                    >
                      <Settings className="h-4 w-4" />
                      <span>Layout</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 space-y-3" align="start">
                    <div className="space-y-1.5">
                      <Label htmlFor="cards-layout-mode">Mode</Label>
                      <Select
                        value={mode}
                        onValueChange={(value) => updateLayout({ mode: value as CardsLayoutMode })}
                      >
                        <SelectTrigger id="cards-layout-mode" data-testid="editable-cards-layout-mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="max">Max (hug)</SelectItem>
                          <SelectItem value="fixed">Fixed (fill)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cards-layout-count">Columns</Label>
                      <Select
                        value={String(dropdown.layout?.count ?? 4)}
                        onValueChange={(value) => updateLayout({ count: Number(value) })}
                      >
                        <SelectTrigger id="cards-layout-count" data-testid="editable-cards-layout-count">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4].map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {mode === "max"
                        ? "Up to N columns; shrinks when fewer cards."
                        : "Always N columns; cards share full width."}
                    </p>
                  </PopoverContent>
                </Popover>
                <button
                  type="button"
                  onClick={addItem}
                  className="flex flex-1 flex-col items-center justify-center gap-2 p-4 hover:border-primary/50 hover:bg-primary/5 transition-colors"
                  data-testid="editable-cards-add"
                >
                  <Plus className="h-8 w-8 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Add Card</span>
                </button>
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <div className="mt-6 pt-4 border-t">
        {!dropdown.footer ? (
          !isReadOnlyStructure && (
            <button
              onClick={() =>
                onChange({
                  ...dropdown,
                  footer: { text: "" },
                })
              }
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 transition-colors text-sm text-muted-foreground"
              data-testid="editable-cards-add-footer"
            >
              <Plus className="h-4 w-4" />
              Add footer
            </button>
          )
        ) : editingFooter ? (
          <div className="space-y-2">
            <RichTextArea
              value={footerDraft}
              onChange={setFooterDraft}
              placeholder="Footer content — use bold, links, line breaks, etc."
              minHeight="4rem"
              locale={locale}
              data-testid="editable-cards-footer-text"
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingFooter(false)}
                data-testid="editable-cards-footer-cancel"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onChange({ ...dropdown, footer: { text: footerDraft } });
                  setEditingFooter(false);
                }}
                data-testid="editable-cards-footer-save"
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="relative">
            {!isReadOnlyStructure && (
              <div className="flex justify-end gap-1 mb-1">
                <button
                  onClick={() => {
                    setFooterDraft(dropdown.footer!.text);
                    setEditingFooter(true);
                  }}
                  className="p-1 rounded-md bg-background border border-border text-muted-foreground hover-elevate"
                  data-testid="editable-cards-footer-edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onChange({ ...dropdown, footer: undefined })}
                  className="p-1 rounded-md bg-background border border-border text-destructive hover-elevate"
                  data-testid="editable-cards-remove-footer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div
              className="text-center text-sm text-muted-foreground [&_a]:text-primary [&_a]:no-underline [&_a:hover]:underline"
              dangerouslySetInnerHTML={{ __html: dropdown.footer.text || "<em>Empty footer</em>" }}
            />
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

function EditableSimpleListPreview({
  dropdown,
  onChange,
  isReadOnlyStructure = false,
  locale = "en",
}: {
  dropdown: SimpleListDropdownData;
  onChange: (dropdown: SimpleListDropdownData) => void;
  isReadOnlyStructure?: boolean;
  locale?: string;
}) {
  const items = dropdown.items || [];

  const updateItem = (index: number, updates: Partial<ColumnItem>) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], ...updates };
    onChange({ ...dropdown, items: newItems });
  };

  const addItem = () => {
    const newItem: ColumnItem = { label: "New Item", href: "/new-page" };
    onChange({ ...dropdown, items: [...items, newItem] });
  };

  const deleteItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    onChange({ ...dropdown, items: newItems });
  };

  return (
    <div className="w-80 p-4 bg-popover border border-border rounded-lg">
      <div className="flex items-start gap-3 mb-4 pb-4 border-b">
        <EditableIcon
          value={dropdown.icon}
          onChange={(icon) => onChange({ ...dropdown, icon })}
          testId="editable-simple-list-icon"
        />
        <div className="flex-1">
          <EditableText
            value={dropdown.title || ""}
            onChange={(title) => onChange({ ...dropdown, title })}
            placeholder="Dropdown title"
            className="font-semibold text-foreground block"
            as="h3"
            testId="editable-simple-list-title"
          />
          <EditableText
            value={dropdown.description || ""}
            onChange={(description) => onChange({ ...dropdown, description })}
            placeholder="Description"
            className="text-xs text-muted-foreground mt-1 block"
            as="p"
            testId="editable-simple-list-description"
          />
        </div>
      </div>
      
      <ul className="space-y-1">
        {items.map((item, index) => (
          <li key={index}>
            <EditableLinkItem
              label={item.label || ""}
              href={item.href || ""}
              onLabelChange={(label) => updateItem(index, { label })}
              onHrefChange={(href) => updateItem(index, { href })}
              onSave={(label, href) => updateItem(index, { label, href })}
              onDelete={() => deleteItem(index)}
              testIdPrefix={`editable-simple-list-item-${index}`}
              isReadOnlyStructure={isReadOnlyStructure}
              locale={locale}
            />
          </li>
        ))}
      </ul>
      
      {!isReadOnlyStructure && (
        <button
          onClick={addItem}
          className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 rounded-md border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 transition-colors text-sm text-muted-foreground"
          data-testid="editable-simple-list-add"
        >
          <Plus className="h-4 w-4" />
          Add Item
        </button>
      )}
    </div>
  );
}

function EditableColumnsPreview({
  dropdown,
  onChange,
  isReadOnlyStructure = false,
  locale = "en",
}: {
  dropdown: ColumnsDropdownData;
  onChange: (dropdown: ColumnsDropdownData) => void;
  isReadOnlyStructure?: boolean;
  locale?: string;
}) {
  const columns = dropdown.columns || [];

  const updateColumn = (colIndex: number, updates: Partial<Column>) => {
    const newColumns = [...columns];
    newColumns[colIndex] = { ...newColumns[colIndex], ...updates };
    onChange({ ...dropdown, columns: newColumns });
  };

  const updateColumnItem = (colIndex: number, itemIndex: number, updates: Partial<ColumnItem>) => {
    const newColumns = [...columns];
    const newItems = [...(newColumns[colIndex].items || [])];
    newItems[itemIndex] = { ...newItems[itemIndex], ...updates };
    newColumns[colIndex] = { ...newColumns[colIndex], items: newItems };
    onChange({ ...dropdown, columns: newColumns });
  };

  const addColumnItem = (colIndex: number) => {
    const newColumns = [...columns];
    newColumns[colIndex] = {
      ...newColumns[colIndex],
      items: [...(newColumns[colIndex].items || []), { label: "New Item", href: "/new-page" }],
    };
    onChange({ ...dropdown, columns: newColumns });
  };

  const deleteColumnItem = (colIndex: number, itemIndex: number) => {
    const newColumns = [...columns];
    newColumns[colIndex] = {
      ...newColumns[colIndex],
      items: (newColumns[colIndex].items || []).filter((_, i) => i !== itemIndex),
    };
    onChange({ ...dropdown, columns: newColumns });
  };

  const addColumn = () => {
    onChange({
      ...dropdown,
      columns: [...columns, { title: "New Column", items: [] }],
    });
  };

  const deleteColumn = (colIndex: number) => {
    onChange({
      ...dropdown,
      columns: columns.filter((_, i) => i !== colIndex),
    });
  };

  return (
    <div className="w-full max-w-4xl p-6 bg-popover border border-border rounded-lg">
      <div className="flex items-start gap-4 mb-6 pb-4 border-b">
        <EditableIcon
          value={dropdown.icon}
          onChange={(icon) => onChange({ ...dropdown, icon })}
          testId="editable-columns-icon"
        />
        <div className="flex-1">
          <EditableText
            value={dropdown.title || ""}
            onChange={(title) => onChange({ ...dropdown, title })}
            placeholder="Dropdown title"
            className="flex items-center gap-1 text-lg font-semibold text-foreground"
            as="h3"
            testId="editable-columns-title"
          />
          <EditableText
            value={dropdown.description || ""}
            onChange={(description) => onChange({ ...dropdown, description })}
            placeholder="Description"
            className="text-sm text-muted-foreground mt-1 block"
            as="p"
            testId="editable-columns-description"
          />
        </div>
      </div>
      
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
        {columns.map((column, colIndex) => (
          <div key={colIndex} className="group/col relative">
            {!isReadOnlyStructure && (
              <button
                onClick={() => deleteColumn(colIndex)}
                className="absolute -top-2 -right-2 p-1 rounded-md bg-destructive/10 text-destructive opacity-0 group-hover/col:opacity-100 transition-opacity z-10"
                data-testid={`editable-column-${colIndex}-delete`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
            
            <EditableText
              value={column.title}
              onChange={(title) => updateColumn(colIndex, { title })}
              placeholder="Column title"
              className="font-semibold text-foreground mb-3 block"
              as="h4"
              testId={`editable-column-${colIndex}-title`}
            />
            <ul className="space-y-2">
              {(column.items || []).map((item, itemIndex) => (
                <li key={itemIndex}>
                  <EditableLinkItem
                    label={item.label || ""}
                    href={item.href || ""}
                    onLabelChange={(label) => updateColumnItem(colIndex, itemIndex, { label })}
                    onHrefChange={(href) => updateColumnItem(colIndex, itemIndex, { href })}
                    onSave={(label, href) => updateColumnItem(colIndex, itemIndex, { label, href })}
                    onDelete={() => deleteColumnItem(colIndex, itemIndex)}
                    testIdPrefix={`editable-column-${colIndex}-item-${itemIndex}`}
                    isReadOnlyStructure={isReadOnlyStructure}
                    locale={locale}
                  />
                </li>
              ))}
              {!isReadOnlyStructure && (
                <li>
                  <button
                    onClick={() => addColumnItem(colIndex)}
                    className="flex items-center gap-1 text-sm text-muted-foreground/50 hover:text-primary"
                    data-testid={`editable-column-${colIndex}-add-item`}
                  >
                    <Plus className="h-3 w-3" />
                    Add item
                  </button>
                </li>
              )}
            </ul>
          </div>
        ))}
        
        {!isReadOnlyStructure && (
          <button
            onClick={addColumn}
            className="flex flex-col items-center justify-center rounded-lg p-4 border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 transition-colors min-h-[120px]"
            data-testid="editable-columns-add-column"
          >
            <Plus className="h-6 w-6 text-muted-foreground mb-1" />
            <span className="text-xs text-muted-foreground">Add Column</span>
          </button>
        )}
      </div>
    </div>
  );
}

function EditableGroupedListPreview({
  dropdown,
  onChange,
  isReadOnlyStructure = false,
  locale = "en",
}: {
  dropdown: GroupedListDropdownData;
  onChange: (dropdown: GroupedListDropdownData) => void;
  isReadOnlyStructure?: boolean;
  locale?: string;
}) {
  const groups = dropdown.groups || [];
  const [activeGroup, setActiveGroup] = useState(0);

  const updateGroup = (groupIndex: number, updates: Partial<Group>) => {
    const newGroups = [...groups];
    newGroups[groupIndex] = { ...newGroups[groupIndex], ...updates };
    onChange({ ...dropdown, groups: newGroups });
  };

  const updateGroupItem = (groupIndex: number, itemIndex: number, updates: Partial<GroupItem>) => {
    const newGroups = [...groups];
    const newItems = [...(newGroups[groupIndex].items || [])];
    newItems[itemIndex] = { ...newItems[itemIndex], ...updates };
    newGroups[groupIndex] = { ...newGroups[groupIndex], items: newItems };
    onChange({ ...dropdown, groups: newGroups });
  };

  const addGroupItem = (groupIndex: number) => {
    const newGroups = [...groups];
    newGroups[groupIndex] = {
      ...newGroups[groupIndex],
      items: [...(newGroups[groupIndex].items || []), { label: "New Item", href: "/new-page" }],
    };
    onChange({ ...dropdown, groups: newGroups });
  };

  const deleteGroupItem = (groupIndex: number, itemIndex: number) => {
    const newGroups = [...groups];
    newGroups[groupIndex] = {
      ...newGroups[groupIndex],
      items: (newGroups[groupIndex].items || []).filter((_, i) => i !== itemIndex),
    };
    onChange({ ...dropdown, groups: newGroups });
  };

  const addGroup = () => {
    onChange({
      ...dropdown,
      groups: [...groups, { title: "New Group", items: [] }],
    });
  };

  const deleteGroup = (groupIndex: number) => {
    const newGroups = groups.filter((_, i) => i !== groupIndex);
    onChange({ ...dropdown, groups: newGroups });
    if (activeGroup >= newGroups.length) {
      setActiveGroup(Math.max(0, newGroups.length - 1));
    }
  };

  return (
    <div className="w-full max-w-xl p-4 bg-popover border border-border rounded-lg">
      <div className="flex items-start gap-3 mb-4 pb-4 border-b">
        <EditableIcon
          value={dropdown.icon}
          onChange={(icon) => onChange({ ...dropdown, icon })}
          testId="editable-grouped-list-icon"
        />
        <div className="flex-1">
          <EditableText
            value={dropdown.title || ""}
            onChange={(title) => onChange({ ...dropdown, title })}
            placeholder="Dropdown title"
            className="font-semibold text-foreground block"
            as="h3"
            testId="editable-grouped-list-title"
          />
          <EditableText
            value={dropdown.description || ""}
            onChange={(description) => onChange({ ...dropdown, description })}
            placeholder="Description"
            className="text-xs text-muted-foreground mt-1 block"
            as="p"
            testId="editable-grouped-list-description"
          />
        </div>
      </div>
      
      <div className="flex gap-6">
        <div className="w-32 flex-shrink-0 space-y-1">
          {groups.map((group, index) => (
            <div key={index} className="group/tab relative flex items-center">
              <button
                onClick={() => setActiveGroup(index)}
                className={`flex-1 text-left px-3 py-2 text-xs font-semibold rounded-md transition-colors ${
                  activeGroup === index
                    ? "text-foreground bg-muted"
                    : "text-muted-foreground hover-elevate"
                }`}
                data-testid={`editable-group-tab-${index}`}
              >
                <EditableText
                  value={group.title}
                  onChange={(title) => updateGroup(index, { title })}
                  placeholder="Group"
                  testId={`editable-group-${index}-title`}
                />
              </button>
              {!isReadOnlyStructure && (
                <button
                  onClick={() => deleteGroup(index)}
                  className="absolute right-0 p-1 text-destructive opacity-0 group-hover/tab:opacity-100"
                  data-testid={`editable-group-${index}-delete`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {!isReadOnlyStructure && (
            <button
              onClick={addGroup}
              className="w-full flex items-center justify-center gap-1 px-3 py-2 text-xs text-muted-foreground border-2 border-dashed border-muted-foreground/30 rounded-md hover:border-primary/50"
              data-testid="editable-grouped-list-add-group"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
          )}
        </div>
        
        <div className="flex-1">
          {groups.length > 0 && groups[activeGroup] ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {(groups[activeGroup].items || []).map((item, index) => (
                <EditableLinkItem
                  key={index}
                  label={item.label || ""}
                  href={item.href || ""}
                  onLabelChange={(label) => updateGroupItem(activeGroup, index, { label })}
                  onHrefChange={(href) => updateGroupItem(activeGroup, index, { href })}
                  onSave={(label, href) => updateGroupItem(activeGroup, index, { label, href })}
                  onDelete={() => deleteGroupItem(activeGroup, index)}
                  testIdPrefix={`editable-group-${activeGroup}-item-${index}`}
                  isReadOnlyStructure={isReadOnlyStructure}
                  locale={locale}
                />
              ))}
              {!isReadOnlyStructure && (
                <button
                  onClick={() => addGroupItem(activeGroup)}
                  className="flex items-center gap-1 py-1.5 text-sm text-muted-foreground/50 hover:text-primary"
                  data-testid={`editable-group-${activeGroup}-add-item`}
                >
                  <Plus className="h-3 w-3" />
                  Add item
                </button>
              )}
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground py-8">
              Add a group to get started
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function EditableDropdownPreview({ dropdown, onChange, isReadOnlyStructure = false, locale = "en" }: EditableDropdownPreviewProps) {
  switch (dropdown.type) {
    case "cards":
      return (
        <EditableCardsPreview
          dropdown={dropdown}
          onChange={onChange as (d: CardsDropdownData) => void}
          isReadOnlyStructure={isReadOnlyStructure}
          locale={locale}
        />
      );
    case "simple-list":
      return (
        <EditableSimpleListPreview
          dropdown={dropdown}
          onChange={onChange as (d: SimpleListDropdownData) => void}
          isReadOnlyStructure={isReadOnlyStructure}
          locale={locale}
        />
      );
    case "columns":
      return (
        <EditableColumnsPreview
          dropdown={dropdown}
          onChange={onChange as (d: ColumnsDropdownData) => void}
          isReadOnlyStructure={isReadOnlyStructure}
          locale={locale}
        />
      );
    case "grouped-list":
      return (
        <EditableGroupedListPreview
          dropdown={dropdown}
          onChange={onChange as (d: GroupedListDropdownData) => void}
          isReadOnlyStructure={isReadOnlyStructure}
          locale={locale}
        />
      );
    default:
      return (
        <div className="p-4 bg-muted/50 rounded-md text-sm text-muted-foreground">
          Unknown dropdown type. Select a dropdown type above.
        </div>
      );
  }
}
