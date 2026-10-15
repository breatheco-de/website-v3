import {
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconSchool,
  IconShoppingCart,
  IconSpeakerphone,
  IconTarget,
} from "@tabler/icons-react";
import { AlertTriangle, Check, ChevronDown, ExternalLink, Info, Pencil, Plus } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  FUNNEL_STAGE_ICON_TONE,
  FUNNEL_STAGE_SELECTED_RING,
  FUNNEL_STAGE_TAPER,
  FUNNEL_STAGE_TONE,
} from "@/lib/funnel-stage-ui";
import { FUNNEL_STAGES, type FunnelBlock } from "@shared/funnel";
import type { ProductPersona } from "@shared/productAudience";
import type { SeoModalSavedDetail } from "@/components/editing/seoModalSaved";
import { notifySeoModalSaved } from "@/components/editing/seoModalSaved";
import type { ContentInfo } from "../types";

type ProductOption = {
  content_slug: string;
  name: string;
  actively_selling?: boolean;
  audience_status?: "missing" | "minimal" | "complete";
  personas?: { id: string; label: string }[];
};

type ProductAudienceResponse = {
  audience: { personas?: ProductPersona[] } | null;
  product?: { personas?: ProductPersona[] };
};

function personasFromAudienceResponse(
  data: ProductAudienceResponse | undefined,
): ProductPersona[] {
  return data?.audience?.personas ?? data?.product?.personas ?? [];
}

function stopPersonaInfoEvent(e: SyntheticEvent) {
  e.stopPropagation();
}

function PersonaReminderBody({
  personaId,
  label,
  detail,
  isLoading,
}: {
  personaId: string;
  label: string;
  detail: ProductPersona | undefined;
  isLoading: boolean;
}) {
  const title = detail?.label || label || personaId;
  const meta = [detail?.role, detail?.industry_or_context, detail?.demographics]
    .map((s) => s?.trim())
    .filter(Boolean) as string[];
  const dialogue = detail?.avatar?.internal_dialogue?.trim();
  const fears = (detail?.avatar?.fears ?? []).map((f) => f.trim()).filter(Boolean).slice(0, 2);

  if (isLoading) {
    return <p className="text-muted-foreground">Loading…</p>;
  }
  if (!detail) {
    return (
      <p className="text-muted-foreground">
        No persona details yet. Edit this product&apos;s Audience in Store.
      </p>
    );
  }
  return (
    <>
      <p className="font-medium text-foreground text-sm leading-tight">{title}</p>
      {meta.length > 0 && (
        <p className="text-muted-foreground leading-snug">{meta.join(" · ")}</p>
      )}
      {dialogue && (
        <p className="italic text-foreground/90 leading-relaxed line-clamp-3">
          &ldquo;{dialogue}&rdquo;
        </p>
      )}
      {fears.length > 0 && (
        <ul className="space-y-0.5 text-muted-foreground">
          {fears.map((fear) => (
            <li key={fear} className="truncate">
              · {fear}
            </li>
          ))}
        </ul>
      )}
      {!meta.length && !dialogue && fears.length === 0 && (
        <p className="text-muted-foreground">Sparse brief — only the id/label is filled in.</p>
      )}
    </>
  );
}

export function PersonaReminderPopover({
  productSlug,
  personaId,
  label,
  detail: detailProp,
  isLoading: loadingProp = false,
  trigger = "icon",
}: {
  productSlug: string;
  personaId: string;
  label?: string;
  detail?: ProductPersona;
  isLoading?: boolean;
  trigger?: "icon" | "text";
}) {
  const [open, setOpen] = useState(false);
  const needsFetch = !detailProp;
  const { data, isLoading: fetchLoading } = useQuery<ProductAudienceResponse>({
    queryKey: [`/api/product/${productSlug}`, { content_type: "program" }],
    enabled: open && needsFetch && Boolean(productSlug),
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/product/${productSlug}?content_type=program`,
      );
      return res.json();
    },
    staleTime: 60_000,
  });

  const detail =
    detailProp ??
    personasFromAudienceResponse(data).find((p) => p.id === personaId);
  const isLoading = detailProp ? loadingProp : fetchLoading;
  const title = detail?.label || label || personaId;

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger === "text" ? (
          <button
            type="button"
            className="inline text-muted-foreground underline-offset-2 hover:underline hover:text-foreground"
            aria-label={`About ${title}`}
            data-testid={`button-funnel-persona-info-${personaId}`}
            onClick={stopPersonaInfoEvent}
            onPointerDown={stopPersonaInfoEvent}
            onMouseDown={stopPersonaInfoEvent}
          >
            {title}
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-foreground/10"
            aria-label={`About ${title}`}
            data-testid={`button-funnel-persona-info-${personaId}`}
            onClick={stopPersonaInfoEvent}
            onPointerDown={stopPersonaInfoEvent}
            onMouseDown={stopPersonaInfoEvent}
          >
            <Info className="h-3 w-3" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // Portal to body (no container) so overflow-y on the fields modal cannot clip it.
        className="w-72 space-y-2 p-3 text-xs z-[10050] pointer-events-auto"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDown={(e) => e.stopPropagation()}
        data-testid={`popover-funnel-persona-${personaId}`}
      >
        <PersonaReminderBody
          personaId={personaId}
          label={label || personaId}
          detail={detail}
          isLoading={isLoading}
        />
      </PopoverContent>
    </Popover>
  );
}

type FunnelBinding = { product: string; persona?: string };

type FunnelApiResponse = {
  funnel: FunnelBlock;
  effectiveProducts: string[] | "all" | null;
  effectiveBindings?: FunnelBinding[] | "all" | null;
  storeMembership: { productSlug: string; stage: string; persona?: string }[];
  warnings: { code: string; message: string; ids?: string[]; action_required?: string }[];
  relativePath: string;
};

const STAGE_OPTIONS: {
  value: (typeof FUNNEL_STAGES)[number];
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  {
    value: "awareness",
    label: "Awareness",
    description: "Top of funnel — widest audience, most general.",
    icon: IconSpeakerphone,
  },
  {
    value: "consideration",
    label: "Consideration",
    description: "Middle of funnel — target buyer persona.",
    icon: IconTarget,
  },
  {
    value: "decision",
    label: "Decision",
    description: "Bottom of funnel — ready to buy.",
    icon: IconShoppingCart,
  },
  {
    value: "post-enrollment",
    label: "Post-enrollment",
    description: "After purchase — onboarding and upsell.",
    icon: IconSchool,
  },
];

const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  STAGE_OPTIONS.map((o) => [o.value, o.label]),
);

const PRODUCT_MODES = [
  { value: "omit" as const, label: "None" },
  { value: "all" as const, label: "All" },
  { value: "list" as const, label: "Specific" },
];

/** Single-page: omit=None (clear). Bulk: leave | all | list | clear. */
export type FunnelProductsMode = "omit" | "all" | "list" | "leave" | "clear";

export type FunnelFieldsFormProps = {
  stage: string;
  onStageChange: (stage: string) => void;
  stageEditing: boolean;
  onStageEditingChange: (editing: boolean) => void;
  productsMode: FunnelProductsMode;
  onProductsModeChange: (mode: FunnelProductsMode) => void;
  selectedBindings: FunnelBinding[];
  onSelectedBindingsChange: (bindings: FunnelBinding[]) => void;
  productOptions: ProductOption[];
  portalContainer?: HTMLElement | null;
  /** Override products mode toggles (bulk Leave/Set/Clear). */
  productsModeOptions?: { value: FunnelProductsMode; label: string }[];
  /** Extra education / context above the form controls */
  education?: ReactNode;
  /** Hide store membership section */
  hideStoreMembership?: boolean;
  storeMembership?: { productSlug: string; stage: string; persona?: string }[];
  warnings?: { code: string; message: string; ids?: string[]; action_required?: string }[];
  isProgram?: boolean;
  contentSlug?: string;
  relativePathHint?: string;
  footer?: ReactNode;
};

export function FunnelFieldsForm({
  stage,
  onStageChange,
  stageEditing,
  onStageEditingChange,
  productsMode,
  onProductsModeChange,
  selectedBindings,
  onSelectedBindingsChange,
  productOptions,
  portalContainer,
  productsModeOptions,
  education,
  hideStoreMembership,
  storeMembership,
  warnings,
  isProgram,
  contentSlug,
  relativePathHint,
  footer,
}: FunnelFieldsFormProps) {
  const productModes = productsModeOptions ?? PRODUCT_MODES;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [addProductKey, setAddProductKey] = useState(0);
  const [pendingProduct, setPendingProduct] = useState<string | null>(null);
  const [pendingPersonaIds, setPendingPersonaIds] = useState<string[]>([]);
  const [pendingOmitPersona, setPendingOmitPersona] = useState(false);

  const productBySlug = new Map(productOptions.map((p) => [p.content_slug, p]));
  const bindingKey = (b: FunnelBinding) => `${b.product}\0${b.persona ?? ""}`;
  const selectedKeys = new Set(selectedBindings.map(bindingKey));

  const { data: pendingProductAudience, isLoading: pendingAudienceLoading } =
    useQuery<ProductAudienceResponse>({
      queryKey: [`/api/product/${pendingProduct}`, { content_type: "program" }],
      enabled: Boolean(pendingProduct),
      queryFn: async () => {
        const res = await apiRequest(
          "GET",
          `/api/product/${pendingProduct}?content_type=program`,
        );
        return res.json();
      },
      staleTime: 60_000,
    });

  const pendingPersonaDetails = new Map(
    personasFromAudienceResponse(pendingProductAudience).map((p) => [p.id, p]),
  );

  const clearPendingPicker = () => {
    setPendingProduct(null);
    setPendingPersonaIds([]);
    setPendingOmitPersona(false);
  };

  const removeBinding = (b: FunnelBinding) => {
    onSelectedBindingsChange(selectedBindings.filter((x) => bindingKey(x) !== bindingKey(b)));
  };

  const addBindings = (bindings: FunnelBinding[]) => {
    const next = [...selectedBindings];
    const keys = new Set(selectedKeys);
    for (const b of bindings) {
      const key = bindingKey(b);
      if (keys.has(key)) continue;
      keys.add(key);
      next.push(b);
    }
    onSelectedBindingsChange(next);
    clearPendingPicker();
    setAddProductOpen(false);
    setAddProductKey((k) => k + 1);
  };

  const addBinding = (b: FunnelBinding) => {
    addBindings([b]);
  };

  const openPersonaPicker = (slug: string) => {
    setPendingProduct(slug);
    setPendingPersonaIds([]);
    setPendingOmitPersona(false);
    setAddProductOpen(false);
    setAddProductKey((k) => k + 1);
  };

  const togglePendingPersona = (personaId: string) => {
    setPendingOmitPersona(false);
    setPendingPersonaIds((prev) =>
      prev.includes(personaId) ? prev.filter((id) => id !== personaId) : [...prev, personaId],
    );
  };

  const applyPendingPersonas = () => {
    if (!pendingProduct) return;
    if (pendingOmitPersona) {
      addBinding({ product: pendingProduct });
      return;
    }
    if (pendingPersonaIds.length === 0) return;
    addBindings(pendingPersonaIds.map((persona) => ({ product: pendingProduct, persona })));
  };

  const tryAddProduct = (slug: string) => {
    const product = productBySlug.get(slug);
    const status = product?.audience_status ?? "missing";
    const personas = product?.personas ?? [];
    const isSelf = isProgram && contentSlug === slug;

    if (status === "missing") {
      // Still allow selecting for program self without persona; otherwise block in UI
      if (isSelf) {
        addBinding({ product: slug });
        return;
      }
      clearPendingPicker();
      setAddProductOpen(false);
      return;
    }

    if (personas.length === 0) {
      if (isSelf) addBinding({ product: slug });
      return;
    }

    // Always open picker so staff can multi-select personas (or omit on self)
    openPersonaPicker(slug);
  };

  return (
    <div className="space-y-4 py-2" data-testid="funnel-tab-content">
      {education ?? (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm text-muted-foreground">
          <p className="text-foreground font-medium flex items-center gap-1.5">
            <Info className="h-4 w-4 shrink-0" />
            How funnel fields work
          </p>
          <p>
            <strong>Stage</strong> is why this URL exists in the buyer journey.{" "}
            <strong>Products</strong> are product+persona bindings (or{" "}
            <code className="text-xs bg-muted px-1 rounded">all</code> for every active product with
            no persona). When a product has an audience, landings must pick a persona; the program
            catalog page may omit persona for itself. Tracking and Store journeys read{" "}
            <code className="text-xs bg-muted px-1 rounded">_common.yml</code>.
          </p>
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-foreground hover:text-foreground/80">
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              />
              Read more (advanced)
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 text-xs space-y-1 font-mono">
              <p>{relativePathHint ?? `{type}/{slug}/_common.yml`}</p>
              <p>shared/funnel.ts · shared/resolveProductScope.ts</p>
              <p>GET /api/ecommerce/funnel/:slug · GET /api/seo/overview</p>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {isProgram && (
        <p className="text-xs text-muted-foreground rounded-md border px-3 py-2">
          Program pages always include this slug in effective products, even when{" "}
          <code className="text-[10px]">funnel.products</code> is empty. Persona is optional on this
          catalog page; other pages that bind this product must pick a persona once audience exists.
        </p>
      )}

      {(warnings ?? []).map((w) => (
        <div
          key={w.code}
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs flex gap-2"
          data-testid={`funnel-warning-${w.code}`}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            {w.message}
            {w.ids?.length ? ` (${w.ids.join(", ")})` : ""}
          </span>
        </div>
      ))}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Stage</Label>
          {stage && !stageEditing && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => onStageEditingChange(true)}
              aria-label="Change funnel stage"
              data-testid="button-edit-funnel-stage"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div
          className={cn(
            "grid gap-2",
            stage && !stageEditing ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2",
          )}
          role="group"
          aria-label="Funnel stage"
          data-testid="funnel-stage-bar"
        >
          {STAGE_OPTIONS.filter((option) => stageEditing || !stage || stage === option.value).map(
            (option) => {
              const selected = stage === option.value;
              const StageIcon = option.icon;
              const taper = FUNNEL_STAGE_TAPER[option.value];
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    if (selected) {
                      onStageChange("");
                      onStageEditingChange(true);
                      return;
                    }
                    onStageChange(option.value);
                    onStageEditingChange(false);
                  }}
                  className={cn(
                    "text-left rounded-md border p-3 transition-colors hover-elevate",
                    FUNNEL_STAGE_TONE[taper],
                    selected && "ring-2 ring-offset-1 ring-offset-background",
                    selected && FUNNEL_STAGE_SELECTED_RING[taper],
                  )}
                  data-testid={`button-funnel-stage-${option.value}`}
                >
                  <div className="flex items-start gap-2">
                    <StageIcon
                      className={cn(
                        "h-4 w-4 shrink-0 mt-0.5",
                        FUNNEL_STAGE_ICON_TONE[taper],
                      )}
                    />
                    <div className="min-w-0">
                      <span className="text-sm font-medium">{option.label}</span>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                        {option.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            },
          )}
        </div>
        {!stage && (
          <p className="text-[11px] text-muted-foreground">
            No stage selected — shows as Unknown in diagnostics.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Products</Label>
        <div
          className="flex rounded-md border overflow-hidden"
          role="group"
          aria-label="Products scope"
          data-testid="funnel-products-mode-bar"
        >
          {productModes.map((mode, i) => (
            <Button
              key={mode.value}
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "flex-1 rounded-none h-9 toggle-elevate",
                i > 0 && "border-l",
                productsMode === mode.value && "toggle-elevated bg-muted",
              )}
              onClick={() => onProductsModeChange(mode.value)}
              data-testid={`button-funnel-products-mode-${mode.value}`}
            >
              {mode.label}
            </Button>
          ))}
        </div>
        {productsMode === "list" && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex flex-wrap gap-1.5" data-testid="funnel-products-tag-cloud">
              {selectedBindings.map((b) => {
                const product = productBySlug.get(b.product);
                const personaLabel =
                  product?.personas?.find((p) => p.id === b.persona)?.label || b.persona;
                return (
                  <button
                    key={bindingKey(b)}
                    type="button"
                    onClick={() => removeBinding(b)}
                    className="inline-flex"
                    data-testid={`funnel-product-${b.product}${b.persona ? `-${b.persona}` : ""}`}
                  >
                    <Badge variant="default" className="gap-1">
                      <Check className="h-3 w-3" />
                      {product?.name || b.product}
                      {personaLabel ? ` · ${personaLabel}` : ""}
                    </Badge>
                  </button>
                );
              })}
              <Popover open={addProductOpen} onOpenChange={setAddProductOpen} modal={false}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    role="combobox"
                    aria-expanded={addProductOpen}
                    className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed px-2.5 text-xs text-muted-foreground shadow-none hover-elevate"
                    data-testid="select-funnel-product-add"
                  >
                    <Plus className="h-3 w-3" />
                    Add more +
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-72 p-0 z-[10001] pointer-events-auto"
                  align="start"
                  container={portalContainer}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Command key={addProductKey}>
                    <CommandInput
                      placeholder="Search products…"
                      data-testid="input-funnel-product-search"
                    />
                    <CommandList>
                      <CommandEmpty>No products found.</CommandEmpty>
                      <CommandGroup>
                        {productOptions.map((p) => {
                          const missing = (p.audience_status ?? "missing") === "missing";
                          const isSelf = isProgram && contentSlug === p.content_slug;
                          const blocked = missing && !isSelf;
                          return (
                            <CommandItem
                              key={p.content_slug}
                              value={`${p.name} ${p.content_slug}`}
                              disabled={blocked}
                              onSelect={() => {
                                if (blocked) return;
                                tryAddProduct(p.content_slug);
                              }}
                              data-testid={`option-funnel-product-${p.content_slug}`}
                            >
                              <span className="flex-1 truncate">{p.name || p.content_slug}</span>
                              <span className="text-[10px] text-muted-foreground font-mono ml-2 shrink-0">
                                {blocked ? "needs audience" : p.content_slug}
                              </span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            {pendingProduct && (
              <div
                className="rounded-md border bg-muted/40 p-2 space-y-2"
                data-testid="funnel-persona-picker"
              >
                <p className="text-xs text-muted-foreground">
                  Select personas for <strong>{pendingProduct}</strong>, then Apply
                  {isProgram && contentSlug === pendingProduct
                    ? " (persona optional on this program page)"
                    : ""}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(productBySlug.get(pendingProduct)?.personas ?? []).map((persona) => {
                    const selected = pendingPersonaIds.includes(persona.id);
                    const alreadyBound = selectedKeys.has(
                      bindingKey({ product: pendingProduct, persona: persona.id }),
                    );
                    const selectDisabled = alreadyBound && !selected;
                    return (
                      <div
                        key={persona.id}
                        className={cn(
                          "inline-flex h-7 items-center gap-0.5 rounded-md border border-secondary-border bg-secondary text-secondary-foreground pl-2.5 pr-1",
                          selected && "bg-primary/10 text-primary border-primary/30",
                          selectDisabled && "opacity-50",
                        )}
                        data-testid={`button-funnel-persona-${persona.id}`}
                      >
                        <button
                          type="button"
                          className={cn(
                            "inline-flex h-full items-center gap-1 text-xs font-medium",
                            selectDisabled ? "cursor-not-allowed" : "hover:opacity-90",
                          )}
                          disabled={selectDisabled}
                          onClick={() => togglePendingPersona(persona.id)}
                          aria-pressed={selected}
                          data-testid={`button-funnel-persona-select-${persona.id}`}
                        >
                          {selected ? <Check className="h-3 w-3" /> : null}
                          {persona.label || persona.id}
                        </button>
                        <PersonaReminderPopover
                          productSlug={pendingProduct}
                          personaId={persona.id}
                          label={persona.label || persona.id}
                          detail={pendingPersonaDetails.get(persona.id)}
                          isLoading={pendingAudienceLoading}
                        />
                      </div>
                    );
                  })}
                  {isProgram && contentSlug === pendingProduct && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={cn(
                        "h-7 text-xs gap-1",
                        pendingOmitPersona &&
                          "bg-primary/10 text-primary border-primary/30 hover:bg-primary/15",
                      )}
                      onClick={() => {
                        setPendingPersonaIds([]);
                        setPendingOmitPersona((v) => !v);
                      }}
                      data-testid="button-funnel-persona-omit"
                      aria-pressed={pendingOmitPersona}
                    >
                      {pendingOmitPersona ? <Check className="h-3 w-3" /> : null}
                      No persona (catalog)
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={clearPendingPicker}
                    data-testid="button-funnel-persona-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!pendingOmitPersona && pendingPersonaIds.length === 0}
                    onClick={applyPendingPersonas}
                    data-testid="button-funnel-persona-apply"
                  >
                    Apply
                    {!pendingOmitPersona && pendingPersonaIds.length > 0
                      ? ` (${pendingPersonaIds.length})`
                      : ""}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!hideStoreMembership && storeMembership && storeMembership.length > 0 && (
        <div className="space-y-2">
          <Label>Store product journeys</Label>
          <ul className="text-xs space-y-1">
            {storeMembership.map((m) => {
              const personaLabel =
                (m.persona &&
                  productBySlug
                    .get(m.productSlug)
                    ?.personas?.find((p) => p.id === m.persona)?.label) ||
                m.persona;
              return (
                <li key={`${m.productSlug}-${m.persona ?? ""}`}>
                  <Link
                    href={`/private/store/product/${m.productSlug}`}
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {m.productSlug}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                  <span className="text-muted-foreground">
                    {" "}
                    · {STAGE_LABELS[m.stage] ?? m.stage}
                    {m.persona ? (
                      <>
                        {" · "}
                        <PersonaReminderPopover
                          productSlug={m.productSlug}
                          personaId={m.persona}
                          label={personaLabel}
                          trigger="text"
                        />
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {footer}
    </div>
  );
}

export function FunnelTab({
  contentInfo,
  contentTypeLabel,
  portalContainer,
  locale = "en",
  variant,
  onSaved,
}: {
  contentInfo: ContentInfo;
  contentTypeLabel?: string;
  portalContainer?: HTMLElement | null;
  locale?: string;
  variant?: string | null;
  onSaved?: (detail: SeoModalSavedDetail) => void;
}) {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<string>("");
  const [stageEditing, setStageEditing] = useState(false);
  const [productsMode, setProductsMode] = useState<FunnelProductsMode>("omit");
  const [selectedBindings, setSelectedBindings] = useState<FunnelBinding[]>([]);

  const hasEntry = !!contentInfo.type && !!contentInfo.slug;

  const { data, isLoading, isError } = useQuery<FunnelApiResponse>({
    queryKey: [`/api/content-types/${contentInfo.type}/funnel/${contentInfo.slug}`],
    enabled: hasEntry,
  });

  const { data: productMap } = useQuery<{ products: ProductOption[] }>({
    queryKey: ["/api/ecommerce/product-map"],
    enabled: hasEntry,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!data?.funnel) return;
    const f = data.funnel;
    const nextStage = typeof f.stage === "string" ? f.stage : "";
    setStage(nextStage);
    setStageEditing(!nextStage);
    if (f.products === "all") {
      setProductsMode("all");
      setSelectedBindings([]);
    } else if (Array.isArray(f.products) && f.products.length > 0) {
      setProductsMode("list");
      setSelectedBindings(
        f.products.map((p) =>
          typeof p === "string"
            ? { product: p }
            : {
                product: (p as FunnelBinding).product,
                ...((p as FunnelBinding).persona
                  ? { persona: (p as FunnelBinding).persona }
                  : {}),
              },
        ),
      );
    } else {
      setProductsMode("omit");
      setSelectedBindings([]);
    }
  }, [data?.funnel]);

  const saveMutation = useMutation({
    mutationFn: async (body: {
      stage?: string | null;
      products?: FunnelBinding[] | "all" | null;
    }) => {
      const res = await apiRequest(
        "PUT",
        `/api/content-types/${contentInfo.type}/funnel/${contentInfo.slug}`,
        body,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      return json;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [`/api/content-types/${contentInfo.type}/funnel/${contentInfo.slug}`],
      });
      void queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentInfo.type, "funnel-entries"],
      });
      if (contentInfo.type && contentInfo.slug) {
        const variantParam =
          typeof variant === "string" && variant.trim() && variant.trim() !== "default"
            ? variant.trim()
            : undefined;
        notifySeoModalSaved(
          onSaved,
          {
            contentType: contentInfo.type,
            slug: contentInfo.slug,
            locale,
            variant: variantParam,
          },
          ["funnel"],
        );
      }
    },
  });

  if (!hasEntry) {
    return (
      <div
        className="rounded-md border border-dashed p-6 text-sm text-muted-foreground text-center"
        data-testid="funnel-tab-empty"
      >
        Open from a content entry to edit page-level funnel fields.
      </div>
    );
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground p-4">Loading funnel…</p>;
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive p-4" data-testid="funnel-tab-error">
        Failed to load funnel settings.
      </p>
    );
  }

  const typeLabel =
    contentTypeLabel ||
    (contentInfo.type
      ? contentInfo.type.charAt(0).toUpperCase() + contentInfo.type.slice(1)
      : "Entry");
  const isProgram = contentInfo.type === "program";
  const productOptions = (productMap?.products ?? []).filter(
    (p) => p.actively_selling !== false,
  );

  const handleSave = () => {
    const body: { stage?: string | null; products?: FunnelBinding[] | "all" | null } = {};
    body.stage = stage || null;
    if (productsMode === "all") body.products = "all";
    else if (productsMode === "list") body.products = selectedBindings;
    else body.products = null;
    saveMutation.mutate(body);
  };

  const dirty =
    data &&
    (stage !== (data.funnel.stage ?? "") ||
      (productsMode === "all" && data.funnel.products !== "all") ||
      (productsMode === "list" &&
        JSON.stringify(selectedBindings) !== JSON.stringify(data.funnel.products ?? [])) ||
      (productsMode === "omit" && data.funnel.products !== undefined));

  return (
    <FunnelFieldsForm
      stage={stage}
      onStageChange={setStage}
      stageEditing={stageEditing}
      onStageEditingChange={setStageEditing}
      productsMode={productsMode}
      onProductsModeChange={setProductsMode}
      selectedBindings={selectedBindings}
      onSelectedBindingsChange={setSelectedBindings}
      productOptions={productOptions}
      portalContainer={portalContainer}
      isProgram={isProgram}
      contentSlug={contentInfo.slug}
      warnings={data?.warnings}
      storeMembership={data?.storeMembership}
      relativePathHint={data?.relativePath}
      footer={
        <>
          <div className="flex justify-end gap-2 pt-2">
            {saveMutation.isError && (
              <p className="text-xs text-destructive flex-1 self-center">
                {(saveMutation.error as Error)?.message}
              </p>
            )}
            <Button
              type="button"
              disabled={!dirty || saveMutation.isPending}
              onClick={handleSave}
              data-testid="button-save-funnel"
            >
              {saveMutation.isPending ? "Saving…" : "Save funnel"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Saves {typeLabel}/{contentInfo.slug}{" "}
            <code className="bg-muted px-1 rounded">_common.yml</code> only — locale files unchanged.
          </p>
        </>
      }
    />
  );
}
