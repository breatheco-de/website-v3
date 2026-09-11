import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navbar, MobileNav, renderNavbarItem, type NavbarConfig } from "@/components/menus";
import { TypewriterAnnouncement } from "@/components/menus/TypewriterAnnouncement";
import { MenuVisualContextProvider } from "@/contexts/MenuVisualContext";
import { useMenuConfig } from "@/hooks/useMenuConfig";
import { getMenuChromeHeights } from "@/lib/menuChrome";
import { useEditModeOptional } from "@/contexts/EditModeContext";

/** Matches Tailwind `nav:` screen — mobile navbar chrome below this width. */
const NAV_MOBILE_MAX_WIDTH = 830;

interface HeaderProps {
  menuId?: string;
  menuConfig?: NavbarConfig;
  isLoading?: boolean;
}

export default function Header({ menuId = "main-navbar", menuConfig: injectedMenuConfig, isLoading: injectedIsLoading }: HeaderProps) {
  const editMode = useEditModeOptional();
  const { i18n } = useTranslation();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isPastThreshold, setIsPastThreshold] = useState(false);
  const [isTopZone, setIsTopZone] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < NAV_MOBILE_MAX_WIDTH : false);
  const locale = i18n.language || 'en';

  const hasInjectedMenuState = injectedMenuConfig !== undefined || injectedIsLoading !== undefined;
  const { menuConfig: queriedMenuConfig, isLoading: queriedIsLoading } = useMenuConfig(
    menuId,
    locale,
    !hasInjectedMenuState,
  );
  const menuConfig = hasInjectedMenuState ? injectedMenuConfig : queriedMenuConfig;
  const isLoading = hasInjectedMenuState ? !!injectedIsLoading : queriedIsLoading;

  const logoItem = menuConfig?.navbar?.items?.find(item => item.component === "Logo");
  const langItem = menuConfig?.navbar?.items?.find(item => item.component === "LanguageSwitcher");
  const buttonItems = menuConfig?.navbar?.items?.filter(item => item.component === "Button") ?? [];

  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY;
      setIsScrolled(y > 0);
      setIsPastThreshold(prev => {
        if (y > 20) return true;
        if (y < 10) return false;
        return prev;
      });
      setIsTopZone(prev => {
        if (y > 20) return false;
        if (y < 10) return true;
        return prev;
      });
    };
    const handleResize = () => setIsMobile(window.innerWidth < NAV_MOBILE_MAX_WIDTH);
    window.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const urlParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
  if (urlParams.get('navbar') === 'false') {
    return null;
  }

  if (editMode?.isEditMode && editMode.previewBreakpoint === "mobile") {
    return null;
  }

  const chromeHeights = getMenuChromeHeights(menuConfig);
  const navSize = chromeHeights.navHeight;
  const constrainClass = menuConfig?.navbar?.constrained_margin
    ? "max-w-6xl mx-auto px-4"
    : "px-4 lg:px-6";

  const stickyEnabled = menuConfig?.navbar?.sticky ?? true;
  const headerSlideOut = !stickyEnabled && isPastThreshold;
  const subtleAtTopEnabled = menuConfig?.navbar?.subtle_at_top ?? false;
  const useSubtleAtTop = subtleAtTopEnabled && isTopZone;
  const floatingEnabled = menuConfig?.navbar?.floating ?? false;
  const useFloatingChrome = floatingEnabled && !useSubtleAtTop;

  const marquee = menuConfig?.navbar?.marquee;
  const showMarquee = chromeHeights.showMarquee;
  const marqueeSticky = marquee?.sticky ?? false;
  const marqueeCollapsed = isPastThreshold && !marqueeSticky;
  const marqueePosition = marquee?.position ?? "below";
  const marqueeShowOn = marquee?.show_on ?? "";
  const hasVisibleMarquee = showMarquee && !marqueeCollapsed;

  const marqueeVisibilityClass =
    marqueeShowOn === "mobile" ? "nav:hidden" :
    marqueeShowOn === "desktop" ? "hidden nav:block" :
    "";

  const floatingVisualOffset = useFloatingChrome ? 12 : 0;
  const totalHeightDesktop = chromeHeights.totalHeightDesktop;
  const totalHeightMobile = chromeHeights.totalHeightMobile;

  const marqueeStrip = showMarquee ? (
    <div
      className={`${marqueeVisibilityClass} overflow-hidden transition-[max-height] duration-300 ease-in-out ${marqueeCollapsed ? "max-h-0" : "max-h-12"} ${
        useFloatingChrome
          ? marqueePosition === "above"
            ? `rounded-t-2xl rounded-b-none ${hasVisibleMarquee ? "border border-border border-b-0" : ""}`
            : `rounded-b-2xl rounded-t-none ${hasVisibleMarquee ? "border border-border border-t-0" : ""}`
          : useSubtleAtTop
            ? "border-b border-border"
          : hasVisibleMarquee && marqueePosition === "below"
            ? "border-t"
            : ""
      }`}
      style={marquee?.background ? { background: marquee.background } : { background: "hsl(var(--primary) / 0.05)" }}
    >
      <div className={`${constrainClass} flex h-10 items-center`}>
        {isLoading ? (
          <div className="flex w-full items-center justify-center">
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          </div>
        ) : (
          <TypewriterAnnouncement
            messages={marquee!.texts!}
            charDelay={marquee?.char_delay}
            startDelay={marquee?.start_delay}
            displayTime={marquee?.display_time}
          />
        )}
      </div>
    </div>
  ) : null;

  const totalHeight = isMobile ? totalHeightMobile : totalHeightDesktop;

  return (
    <>
      <div aria-hidden="true" className="hidden nav:block" style={{ height: `${totalHeightDesktop}px` }} />
      <div aria-hidden="true" className="nav:hidden" style={{ height: `${totalHeightMobile}px` }} />

      <div
        className="fixed left-0 right-0 z-50 transition-[top] duration-300 ease-in-out"
        style={{ top: headerSlideOut ? `-${totalHeight + floatingVisualOffset}px` : '0px' }}
      >
        <div
          className={`relative transition-transform duration-150 ease-out ${
            useFloatingChrome
              ? "mx-3 translate-y-3 drop-shadow-[0_18px_22px_hsl(var(--foreground)/0.14)] nav:mx-4"
              : ""
          }`}
        >
          {marqueePosition === "above" && marqueeStrip}
          <header
            className={`relative z-10 w-full transition-[background-color,border-color] duration-150 ease-out ${
              useSubtleAtTop
                ? "bg-transparent border-b border-transparent"
                : useFloatingChrome
                  ? hasVisibleMarquee
                    ? marqueePosition === "above"
                      ? "rounded-b-2xl rounded-t-none border border-border border-t-0 bg-background"
                      : "rounded-t-2xl rounded-b-none border border-border border-b-0 bg-background"
                    : "rounded-2xl border border-border bg-background"
                  : isScrolled
                    ? "bg-background border-b"
                    : "bg-background border-b border-background"
            }`}
          >
            <MenuVisualContextProvider value={{ isCompact: useSubtleAtTop }}>
              <div className={`flex items-center gap-4 ${constrainClass}`} style={{ height: `${navSize}px` }}>
                <div className="hidden nav:flex flex-1">
                  {isLoading ? (
                    <div className="flex items-center gap-4">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-4 w-20 bg-muted animate-pulse rounded" />
                      ))}
                    </div>
                  ) : menuConfig ? (
                    <Navbar config={menuConfig} />
                  ) : null}
                </div>

                <div className="flex nav:hidden flex-1 items-center justify-between gap-3">
                  {logoItem && renderNavbarItem(logoItem, undefined, undefined, menuConfig?.navbar?.constrained_margin)}
                  <div className="flex items-center gap-2">
                    {langItem && renderNavbarItem(langItem)}
                    {buttonItems.map((item) => renderNavbarItem(item))}
                    {menuConfig && <MobileNav config={menuConfig} />}
                  </div>
                </div>
              </div>
            </MenuVisualContextProvider>
          </header>
          {marqueePosition === "below" && marqueeStrip}
        </div>
      </div>
    </>
  );
}
