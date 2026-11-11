import { IconDownload, IconArrowRight } from "@tabler/icons-react";
import { getIcon } from "@/lib/icons";
import type { CtaBannerStrip } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { useInternalNav } from "@/hooks/useInternalNav";

interface Props {
  data: CtaBannerStrip;
}

export function CtaBannerStrip({ data }: Props) {
  const handleLinkClick = useInternalNav();
  const { text, icon, cta_buttons } = data;

  const ResolvedIcon = icon ? (getIcon(icon) ?? IconDownload) : IconDownload;

  return (
    <div
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[13px] border border-border bg-background px-4 py-3.5 sm:flex-nowrap sm:gap-5 sm:px-5"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 3px 10px rgba(0,0,0,0.03)" }}
    >
      {/* Icon + rich text */}
      <div className="flex min-w-0 w-full sm:flex-1 items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-background shadow-sm border border-border/60">
          <ResolvedIcon size={22} className="text-primary" aria-hidden="true" />
        </div>

        {text && (
          <p
            className="min-w-0 text-[13.5px] leading-5 sm:text-[15.5px] sm:leading-6 text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: text }}
          />
        )}
      </div>

      {/* CTA buttons */}
      {cta_buttons?.map((btn, i) => {
        const resolvedVariant = (btn.button_variant || btn.variant) as string;
        const isLink = resolvedVariant === "link";
        const variant = isLink ? "link"
          : resolvedVariant === "primary" ? "default"
          : resolvedVariant === "secondary" ? "secondary"
          : resolvedVariant === "outline" ? "outline"
          : resolvedVariant === "accent" ? "accent"
          : "link";
        const BtnIcon = btn.icon ? (getIcon(btn.icon) ?? null) : null;
        return (
          <Button
            key={i}
            variant={variant as any}
            size="sm"
            asChild
            className={`sm:ml-auto shrink-0 font-bold text-[15px] ${isLink ? "no-default-hover-elevate" : ""}`}
          >
            <a href={btn.url} onClick={handleLinkClick}>
              {btn.text}
              {BtnIcon
                ? <BtnIcon size={16} aria-hidden="true" />
                : !isLink && <IconArrowRight size={16} aria-hidden="true" />
              }
            </a>
          </Button>
        );
      })}
    </div>
  );
}

export default CtaBannerStrip;
