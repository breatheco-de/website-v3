// section-spacing: overlay
/**
 * ModalTwoColumn — overlay layout aligned with two_column (image + copy + CTAs).
 * Image hidden on mobile. CTAs are a generic buttons[] (link or dropdown via items).
 */
import { useEffect, useId, useState, type CSSProperties } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UniversalImage } from "@/components/UniversalImage";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { useInternalNav } from "@/hooks/useInternalNav";
import { getIcon } from "@/lib/icons";
import { coerceToHtml, coerceToText, resolveTemplateFallback } from "@/lib/variable-manager";
import { cn } from "@/lib/utils";

export interface ModalCta {
  text: string;
  url?: string;
  variant?: "primary" | "secondary" | "outline" | "accent";
  icon?: string;
  items?: Array<{ name: string; url: string }>;
}

export interface ModalTwoColumnColumn {
  image?: string;
  image_alt?: string;
  image_object_fit?: "cover" | "contain" | "fill" | "none" | "scale-down";
  image_object_position?: string;
  image_max_width?: string;
  image_max_height?: string;
  image_mobile_max_width?: string;
  image_mobile_max_height?: string;
  justify?: "start" | "center" | "end";
  heading?: string;
  description?: string;
  bullets?: Array<{ text: string; icon?: string }>;
  bullet_icon?: string;
  bullet_icon_color?: string;
  buttons?: ModalCta[];
}

export interface ModalTwoColumnData {
  type: "modal";
  variant: "twoColumn";
  section_id: string;
  show_close?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  proportions?: [number, number];
  left?: ModalTwoColumnColumn;
  right?: ModalTwoColumnColumn;
}

interface ModalTwoColumnProps {
  data: ModalTwoColumnData;
}

const SIZE_CLASSES: Record<string, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

function getGridColClass(proportion: number): string {
  const colMap: Record<number, string> = {
    1: "md:col-span-1",
    2: "md:col-span-2",
    3: "md:col-span-3",
    4: "md:col-span-4",
    5: "md:col-span-5",
    6: "md:col-span-6",
    7: "md:col-span-7",
    8: "md:col-span-8",
    9: "md:col-span-9",
    10: "md:col-span-10",
    11: "md:col-span-11",
    12: "md:col-span-12",
  };
  return colMap[proportion] || "md:col-span-6";
}

function getResponsiveJustifyClass(justify?: "start" | "center" | "end"): string {
  switch (justify) {
    case "start":
      return "justify-center md:justify-start";
    case "end":
      return "justify-center md:justify-end";
    case "center":
    default:
      return "justify-center";
  }
}

function renderIcon(iconName: string, className?: string) {
  const IconComponent = getIcon(iconName);
  return IconComponent ? <IconComponent className={className} size={20} /> : null;
}

function buttonVariant(
  variant?: "primary" | "secondary" | "outline" | "accent",
): "default" | "secondary" | "outline" | "accent" {
  if (variant === "outline") return "outline";
  if (variant === "secondary") return "secondary";
  if (variant === "accent") return "accent";
  return "default";
}

function normalizeCtas(raw: ModalCta[] | undefined): Array<{
  text: string;
  url: string;
  variant: "default" | "secondary" | "outline" | "accent";
  icon?: string;
  items: Array<{ name: string; url: string }>;
}> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => {
      const text = coerceToText(b?.text).trim();
      const url = resolveTemplateFallback(coerceToText(b?.url));
      const items = (b?.items || [])
        .map((it) => ({
          name: coerceToText(it?.name).trim(),
          url: resolveTemplateFallback(coerceToText(it?.url)),
        }))
        .filter((it) => !!it.name && !!it.url);
      return {
        text,
        url,
        variant: buttonVariant(b?.variant),
        icon: coerceToText(b?.icon) || undefined,
        items,
      };
    })
    .filter((b) => b.text && (b.items.length > 0 || !!b.url));
}

function columnHasMobileText(column: ModalTwoColumnColumn): boolean {
  const headingHtml = coerceToHtml(column.heading);
  const descriptionHtml = coerceToHtml(column.description);
  const bullets = (column.bullets || []).some((b) => coerceToText(b?.text).trim());
  const buttons = normalizeCtas(column.buttons).length > 0;
  return !!(headingHtml || descriptionHtml || bullets || buttons);
}

function ColumnBlock({
  column,
  columnKey,
  sectionId,
}: {
  column: ModalTwoColumnColumn;
  columnKey: "left" | "right";
  sectionId: string;
}) {
  const handleLinkClick = useInternalNav();
  const imageDomId = useId().replace(/:/g, "");
  const imageSrc = resolveTemplateFallback(coerceToText(column.image));
  const headingHtml = coerceToHtml(column.heading);
  const descriptionHtml = coerceToHtml(column.description);
  const bullets = (column.bullets || [])
    .map((b) => ({
      text: coerceToText(b?.text).trim(),
      icon: coerceToText(b?.icon) || undefined,
    }))
    .filter((b) => b.text);
  const bulletIcon = coerceToText(column.bullet_icon) || "Check";
  const bulletIconColor = coerceToText(column.bullet_icon_color) || "text-primary";
  const buttons = normalizeCtas(column.buttons);

  const hasText =
    !!headingHtml || !!descriptionHtml || bullets.length > 0 || buttons.length > 0;

  return (
    <div
      className="flex flex-col gap-4 w-full min-w-0"
      data-testid={`modal-two-column-${columnKey}-${sectionId}`}
    >
      {hasText ? (
        <div className="flex flex-col gap-4 w-full text-left">
          {headingHtml ? (
            <h2
              className="text-foreground text-[36px] font-bold"
              data-testid={`text-modal-heading-${sectionId}-${columnKey}`}
            >
              <div
                className="leading-[1.05]"
                dangerouslySetInnerHTML={{ __html: headingHtml }}
              />
            </h2>
          ) : null}

          {descriptionHtml ? (
            <RichTextContent
              html={descriptionHtml}
              className="text-body text-muted-foreground"
              data-testid={`text-modal-description-${sectionId}-${columnKey}`}
            />
          ) : null}

          {bullets.length > 0 ? (
            <ul
              className="w-full space-y-3 flex flex-col items-start pl-1"
              data-testid={`list-modal-bullets-${sectionId}`}
            >
              {bullets.map((bullet, index) => (
                <li key={`${index}-${bullet.text.slice(0, 24)}`} className="flex items-start gap-3 w-full">
                  <span className={`${bulletIconColor} mt-1 flex-shrink-0`}>
                    {renderIcon(bullet.icon || bulletIcon, "w-5 h-5")}
                  </span>
                  <span className="text-foreground text-body">{bullet.text}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {buttons.length > 0 ? (
            <div className="mt-2 flex flex-row flex-wrap items-start gap-3">
              {buttons.map((btn, i) => {
                if (btn.items.length > 0) {
                  const Icon = btn.icon ? getIcon(btn.icon) : null;
                  return (
                    <DropdownMenu key={`dropdown-${btn.text}-${i}`}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant={btn.variant}
                          size="lg"
                          className="!px-5"
                          data-testid={`button-modal-cta-${sectionId}-${i}`}
                        >
                          {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden /> : null}
                          <span>{btn.text}</span>
                          <ChevronDown className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="z-[10001] min-w-[var(--radix-dropdown-menu-trigger-width)] w-[var(--radix-dropdown-menu-trigger-width)]"
                      >
                        {btn.items.map((item) => (
                          <DropdownMenuItem key={`${item.name}-${item.url}`} asChild>
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid={`link-modal-cta-item-${item.name}`}
                            >
                              {item.name}
                            </a>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                }

                return (
                  <Button
                    key={`${btn.text}-${btn.url}-${i}`}
                    variant={btn.variant}
                    size="lg"
                    asChild
                    className="!px-5"
                    data-testid={`button-modal-cta-${sectionId}-${i}`}
                  >
                    <a
                      href={btn.url}
                      onClick={handleLinkClick}
                      className="inline-flex items-center justify-start gap-2"
                    >
                      {btn.icon ? renderIcon(btn.icon) : null}
                      {btn.text}
                    </a>
                  </Button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {imageSrc ? (
        <div
          className={cn(
            "hidden md:flex w-full",
            getResponsiveJustifyClass(column.justify),
          )}
        >
          <style>{`
            #${imageDomId} {
              max-width: ${column.image_max_width || "100%"};
              max-height: ${column.image_max_height || "none"};
            }
          `}</style>
          <div id={imageDomId}>
            <UniversalImage
              id={imageSrc}
              alt={coerceToText(column.image_alt) || "Section image"}
              className="rounded-md w-full h-auto"
              style={{
                objectFit:
                  (column.image_object_fit as CSSProperties["objectFit"]) || "cover",
                objectPosition: column.image_object_position || "center center",
              }}
              fieldContext={{ fieldPath: `${columnKey}.image` }}
              data-testid={`img-modal-two-column-${columnKey}`}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModalBody({
  data,
  sectionId,
}: {
  data: ModalTwoColumnData;
  sectionId: string;
}) {
  const [leftProp, rightProp] = data.proportions ?? [6, 6];
  const left = data.left ?? {};
  const right = data.right ?? {};
  const plainHeading =
    coerceToText(right.heading).replace(/<[^>]+>/g, "").trim() ||
    coerceToText(left.heading).replace(/<[^>]+>/g, "").trim() ||
    "Modal";
  const leftMobileText = columnHasMobileText(left);
  const rightMobileText = columnHasMobileText(right);

  return (
    <div className="p-6 pt-10 md:p-8 md:pt-10" data-testid={`modal-two-column-body-${sectionId}`}>
      <DialogTitle className="sr-only">{plainHeading}</DialogTitle>
      <DialogDescription className="sr-only">{plainHeading}</DialogDescription>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8 items-center">
        <div
          className={cn(
            "min-w-0",
            getGridColClass(leftProp),
            !leftMobileText && "hidden md:block",
          )}
        >
          <ColumnBlock column={left} columnKey="left" sectionId={sectionId} />
        </div>
        <div
          className={cn(
            "min-w-0",
            getGridColClass(rightProp),
            !rightMobileText && "hidden md:block",
          )}
        >
          <ColumnBlock column={right} columnKey="right" sectionId={sectionId} />
        </div>
      </div>
    </div>
  );
}

export default function ModalTwoColumn({ data }: ModalTwoColumnProps) {
  const [isOpen, setIsOpen] = useState(false);
  const editMode = useEditModeOptional();
  const isEditMode = editMode?.isEditMode ?? false;

  const sectionId = data.section_id || "modal";
  const showClose = data.show_close !== false;
  const sizeClass = SIZE_CLASSES[data.size || "xl"] || SIZE_CLASSES.xl;

  useEffect(() => {
    const checkHash = () => {
      const hash = window.location.hash.replace("#", "");
      setIsOpen(hash === sectionId);
    };
    checkHash();
    window.addEventListener("hashchange", checkHash);
    return () => window.removeEventListener("hashchange", checkHash);
  }, [sectionId]);

  const handleClose = () => {
    setIsOpen(false);
    if (window.location.hash === `#${sectionId}`) {
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  };

  const dialog = (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          if (isEditMode) setIsOpen(false);
          else handleClose();
        }
      }}
    >
      <DialogContent
        className={cn(sizeClass, "p-0 gap-0 overflow-hidden")}
        hideClose={!showClose}
        data-testid={`modal-content-${sectionId}`}
      >
        <ModalBody data={data} sectionId={sectionId} />
      </DialogContent>
    </Dialog>
  );

  if (isEditMode) {
    const previewHeading =
      coerceToText(data.right?.heading).replace(/<[^>]+>/g, "").trim() ||
      coerceToText(data.left?.heading).replace(/<[^>]+>/g, "").trim();
    return (
      <div
        className="w-full py-8 px-4"
        data-testid={`modal-edit-placeholder-${sectionId}`}
      >
        <div className="max-w-4xl mx-auto border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 bg-muted/20">
          <div className="flex items-center justify-center gap-3 text-muted-foreground">
            <X className="h-5 w-5" />
            <span className="text-sm font-medium">
              Two-column modal — opens via{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
                #{sectionId}
              </code>
            </span>
            <X className="h-5 w-5" />
          </div>
          <div className="mt-4 flex flex-col items-center gap-2 text-sm">
            {previewHeading ? (
              <span className="text-foreground font-medium text-center">{previewHeading}</span>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsOpen(true)}
              data-testid={`button-preview-modal-${sectionId}`}
            >
              Preview Modal
            </Button>
          </div>
        </div>
        {dialog}
      </div>
    );
  }

  return dialog;
}
