import { useState, useEffect } from "react";
import { Facebook, Instagram, Linkedin, Twitter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useInternalNav } from "@/hooks/useInternalNav";

import { useImageRegistry } from "@/components/UniversalImage";
import { useEditModeOptional } from "@/contexts/EditModeContext";

const LOGO_ID = "4geeks-devs-logo-1763162063433";

interface FooterColumn {
  title: string;
  items: { label: string; href: string }[];
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

interface FooterConfig {
  columns: FooterColumn[];
  socials: FooterSocial[];
  legal_links: FooterLegalLink[];
  copyright_text: string;
  subscribe_text: string;
}

const socialIconMap: Record<string, typeof Linkedin> = {
  linkedin: Linkedin,
  facebook: Facebook,
  "x-logo": Twitter,
  instagram: Instagram,
};

interface FooterProps {
  menuId?: string;
}

function isFooterSpacer(item: { label: string; href: string }): boolean {
  return !item.label.trim() && (!item.href.trim() || item.href === "#");
}

function isFooterSubtitle(item: { label: string; href: string }): boolean {
  return (
    !!item.label.trim() && (!item.href.trim() || item.href === "#")
  );
}

export default function Footer({ menuId = "main-footer" }: FooterProps) {
  const handleLinkClick = useInternalNav();
  const editMode = useEditModeOptional();
  const { i18n } = useTranslation();
  const locale = i18n.language || "en";
  const { registry } = useImageRegistry();
  const logoSrc = registry?.images?.[LOGO_ID]?.src;

  const [colDivisor, setColDivisor] = useState(4);
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setColDivisor(w >= 1024 ? 5 : w >= 768 ? 10 : 4);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const { data: menuResponse } = useQuery<{
    name: string;
    data: { footer: FooterConfig };
  }>({
    queryKey: ["/api/menus", menuId, locale],
    queryFn: async () => {
      const response = await fetch(`/api/menus/${menuId}?locale=${locale}`);
      if (!response.ok) throw new Error("Failed to load footer menu");
      return response.json();
    },
  });

  const config = menuResponse?.data?.footer;
  if (!config) return null;
  if (editMode?.isEditMode && editMode.previewBreakpoint === "mobile") return null;

  const currentYear = new Date().getFullYear();
  const rawCopyright = (config.copyright_text || "4Geeks Academy").replace(
    /^\d{4}\s*/,
    "",
  );
  const copyrightText = `${currentYear} ${rawCopyright}`;

  return (
    <footer className="text-foreground" data-testid="section-global-footer">
      <div className="max-w-7xl mx-auto px-6 py-8 border-t">
        <div className="lg:shrink-0 flex justify-between items-center h-full mb-8">
          <a
            href="/"
            onClick={handleLinkClick}
            className="flex items-center h-full"
            data-testid="link-footer-home"
          >
            {logoSrc && (
              <img src={logoSrc} alt="4Geeks Academy" className="h-9" />
            )}
          </a>
          <div>
            <p className="text-center mb-1">
              {config.subscribe_text || "Subscribe for more"}
            </p>
            <div
              className="flex items-center justify-center gap-3"
              data-testid="footer-socials"
            >
              {config.socials?.map((social) => {
                const Icon = socialIconMap[social.icon];
                if (!Icon) return null;
                return (
                  <a
                    key={social.name}
                    href={social.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground/70 hover:text-foreground transition-colors"
                    data-testid={`link-social-${social.icon}`}
                    aria-label={social.name}
                  >
                    <Icon className="h-6 w-6" />
                  </a>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex flex-col md:flex md:flex-row md:justify-between gap-8 md:gap-4">
          {config.columns?.map((column) => {
            const itemCount = column.items?.length || 0;
            const divisor =
              typeof column.items_per_column === "number" &&
              column.items_per_column >= 1
                ? column.items_per_column
                : colDivisor;
            const subCols = Math.ceil(itemCount / divisor);

            return (
              <div
                key={column.title}
                data-testid={`footer-column-${column.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">
                  {column.title}
                </h3>
                <ul
                  className="gap-x-3 md:columns-"
                  style={{
                    columnCount: subCols,
                    columnGap: "2rem",
                  }}
                >
                  {column.items?.map((item, itemIdx) => {
                    if (isFooterSpacer(item)) {
                      return (
                        <li
                          key={`spacer-${itemIdx}`}
                          className="mb-4 h-3 break-inside-avoid"
                          aria-hidden="true"
                          data-testid="footer-item-spacer"
                        />
                      );
                    }

                    if (isFooterSubtitle(item)) {
                      return (
                        <li
                          key={`subtitle-${item.label}-${itemIdx}`}
                          className="mb-2 mt-3 break-inside-avoid"
                          data-testid={`footer-subtitle-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          <span className="text-xs font-semibold uppercase tracking-wider text-foreground/50">
                            {item.label}
                          </span>
                        </li>
                      );
                    }

                    const isExternal = item.href.startsWith("http");
                    return (
                      <li
                        key={`${item.label}-${itemIdx}`}
                        className="mb-2.5 break-inside-avoid"
                      >
                        <a
                          href={item.href}
                          onClick={isExternal ? undefined : handleLinkClick}
                          target={isExternal ? "_blank" : undefined}
                          rel={isExternal ? "noopener noreferrer" : undefined}
                          className="text-sm text-foreground/70 hover:text-foreground transition-colors"
                          data-testid={`link-footer-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          {item.label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="pt-8 border-t border-background/20">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p
              className="text-sm text-foreground/60"
              data-testid="text-copyright"
            >
              {copyrightText}
            </p>
            <div
              className="flex items-center gap-6 flex-wrap"
              data-testid="footer-legal-links"
            >
              {config.legal_links?.map((link) => {
                const isExternal = link.href.startsWith("http");
                return (
                  <a
                    key={link.label}
                    href={link.href}
                    onClick={isExternal ? undefined : handleLinkClick}
                    target={isExternal ? "_blank" : undefined}
                    rel={isExternal ? "noopener noreferrer" : undefined}
                    className="text-sm text-foreground/60 hover:text-foreground transition-colors"
                    data-testid={`link-legal-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {link.label}
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
