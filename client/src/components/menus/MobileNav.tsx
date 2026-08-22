import { useState } from "react";
import { ChevronDown, ChevronRight, Menu } from "lucide-react";
import { InternalLink } from "@/components/InternalLink";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import type { NavbarConfig, NavbarItem } from "./index";

interface MobileNavProps {
  config: NavbarConfig;
}

interface MobileNavItemProps {
  item: NavbarItem;
  onNavigate: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

function MobileNavItem({ item, onNavigate, isOpen, onToggle }: MobileNavItemProps) {
  const [openSubIndex, setOpenSubIndex] = useState<number | null>(null);

  const handleSubToggle = (index: number) => {
    setOpenSubIndex(openSubIndex === index ? null : index);
  };

  if (item.component === "Dropdown" && item.dropdown) {
    const dropdown = item.dropdown;

    return (
      <Collapsible open={isOpen} onOpenChange={() => { onToggle(); setOpenSubIndex(null); }}>
        <CollapsibleTrigger className="flex w-full items-center justify-between py-3 px-2 text-base font-medium text-foreground hover-elevate rounded-md">
          <span>{item.label}</span>
          <ChevronDown 
            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} 
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pl-4 pb-2">
          {dropdown.type === "cards" && dropdown.items && (
            <div className="space-y-1">
              {dropdown.items.map((card, index) => (
                <InternalLink
                  key={index}
                  href={card.href}
                  onNavigate={onNavigate}
                  className="flex items-center justify-between py-2 px-2 text-sm text-muted-foreground hover-elevate rounded-md"
                  data-testid={`mobile-nav-card-${(card.title || "item").toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div>
                    <div className="font-medium text-foreground">{card.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-1">{card.description}</div>
                  </div>
                  <ChevronRight className="h-3 w-3 shrink-0 ml-2" />
                </InternalLink> // test
              ))}
            </div>
          )}
          
          {dropdown.type === "columns" && dropdown.columns && (
            <div className="space-y-1">
              {dropdown.columns.map((column, colIndex) => (
                <Collapsible key={colIndex} open={openSubIndex === colIndex} onOpenChange={() => handleSubToggle(colIndex)}>
                  <CollapsibleTrigger className="flex w-full items-center justify-between py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover-elevate rounded-md">
                    <span>{column.title}</span>
                    <ChevronDown 
                      className={`h-3 w-3 transition-transform duration-200 ${openSubIndex === colIndex ? "rotate-180" : ""}`} 
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pl-2">
                    <div className="space-y-1">
                      {column.items.map((link, linkIndex) => (
                        <InternalLink
                          key={linkIndex}
                          href={link.href}
                          onNavigate={onNavigate}
                          className="flex items-center justify-between py-2 px-2 text-sm text-muted-foreground hover-elevate rounded-md"
                          data-testid={`mobile-nav-column-item-${(link.label || "item").toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          <span>{link.label}</span>
                          <ChevronRight className="h-3 w-3 shrink-0 ml-2" />
                        </InternalLink>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          )}
          
          {dropdown.type === "simple-list" && dropdown.items && (
            <div className="space-y-1">
              {dropdown.items.map((link, index) => (
                <InternalLink
                  key={index}
                  href={link.href}
                  onNavigate={onNavigate}
                  className="flex items-center justify-between py-2 px-2 text-sm text-muted-foreground hover-elevate rounded-md"
                  data-testid={`mobile-nav-list-item-${(link.label || "item").toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <span>{link.label}</span>
                  <ChevronRight className="h-3 w-3 shrink-0 ml-2" />
                </InternalLink>
              ))}
            </div>
          )}
          
          {dropdown.type === "grouped-list" && dropdown.groups && (
            <div className="space-y-1">
              {dropdown.groups.map((group, groupIndex) => (
                <Collapsible key={groupIndex} open={openSubIndex === groupIndex} onOpenChange={() => handleSubToggle(groupIndex)}>
                  <CollapsibleTrigger className="flex w-full items-center justify-between py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover-elevate rounded-md">
                    <span>{group.title}</span>
                    <ChevronDown 
                      className={`h-3 w-3 transition-transform duration-200 ${openSubIndex === groupIndex ? "rotate-180" : ""}`} 
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pl-2">
                    <div className="space-y-1">
                      {group.items.map((link, linkIndex) => (
                        <InternalLink
                          key={linkIndex}
                          href={link.href}
                          onNavigate={onNavigate}
                          className="flex items-center justify-between py-2 px-2 text-sm text-muted-foreground hover-elevate rounded-md"
                          data-testid={`mobile-nav-group-item-${(link.label || "item").toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          <span>{link.label}</span>
                          <ChevronRight className="h-3 w-3 shrink-0 ml-2" />
                        </InternalLink>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <InternalLink
      href={item.href}
      onNavigate={onNavigate}
      className="flex items-center py-3 px-2 text-base font-medium text-foreground hover-elevate rounded-md"
      data-testid={`mobile-nav-link-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {item.label}
    </InternalLink>
  );
}

export function MobileNav({ config }: MobileNavProps) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [openItemIndex, setOpenItemIndex] = useState<number | null>(null);

  const handleNavigate = () => {
    setIsSheetOpen(false);
    setOpenItemIndex(null);
  };

  const handleToggle = (index: number) => {
    setOpenItemIndex(openItemIndex === index ? null : index);
  };

  if (!config?.navbar?.items) {
    return null;
  }

  return (
    <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          data-testid="button-mobile-menu"
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[300px] sm:w-[350px] overflow-y-auto">
        <VisuallyHidden>
          <SheetTitle>Navigation Menu</SheetTitle>
        </VisuallyHidden>
        <nav className="flex flex-col mt-8" data-testid="mobile-nav">
          {config.navbar.items
            .filter((item) => item.component !== "Logo" && item.component !== "LanguageSwitcher" && item.component !== "Button")
            .map((item, index) => (
            <MobileNavItem 
              key={index} 
              item={item} 
              onNavigate={handleNavigate}
              isOpen={openItemIndex === index}
              onToggle={() => handleToggle(index)}
            />
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
