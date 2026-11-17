import React, {
  useRef,
  useEffect,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useInternalNav } from "@/hooks/useInternalNav";
import {
  isExternalHref,
  isInternalHref,
  isPrefetchableHref,
  prefetchNavigationHref,
} from "@/lib/prefetchNavigation";
import { isNonNavigableHref } from "@shared/safe-href";

export type InternalLinkPrefetch = "none" | "hover";

export interface InternalLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  children: ReactNode;
  onNavigate?: () => void;
  /** Preload eager section chunks from build manifest on mouse enter (internal paths only). */
  prefetch?: InternalLinkPrefetch;
  /**
   * Optional in-flight work before leaving (e.g. tracked enrollment click).
   * Passed to useInternalNav as beforeLeave.
   */
  beforeLeave?: Promise<unknown> | null | (() => Promise<unknown> | null);
}

export function InternalLink({
  href,
  children,
  onNavigate,
  prefetch = "hover",
  onClick,
  onMouseEnter,
  beforeLeave,
  target,
  rel,
  className,
  ...rest
}: InternalLinkProps) {
  const nonNavigable = isNonNavigableHref(href ?? "");
  const isExternal = !nonNavigable && isExternalHref(href);
  const useSpaNav = !nonNavigable && isInternalHref(href) && !isExternal;
  const handleClick = useInternalNav(useSpaNav ? onNavigate : undefined);
  const prefetchedRef = useRef(false);

  useEffect(() => {
    prefetchedRef.current = false;
  }, [href]);

  // Do not emit crawlable href="null" / CSS-like values into the DOM.
  if (nonNavigable) {
    return (
      <span className={className} {...(rest as Record<string, unknown>)}>
        {children}
      </span>
    );
  }

  const handleMouseEnter = (e: MouseEvent<HTMLAnchorElement>) => {
    onMouseEnter?.(e);
    if (
      !useSpaNav ||
      prefetch === "none" ||
      prefetchedRef.current ||
      !isPrefetchableHref(href)
    ) {
      return;
    }
    prefetchedRef.current = true;
    prefetchNavigationHref(href);
  };

  const externalProps =
    isExternal && target === undefined
      ? { target: "_blank" as const, rel: rel ?? "noopener noreferrer" }
      : { target, rel };

  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        const sent =
          typeof beforeLeave === "function" ? beforeLeave() : beforeLeave ?? null;
        handleClick(e, { beforeLeave: sent });
        onClick?.(e);
      }}
      onMouseDown={(e) => {
        handleClick.onMouseDown(e);
      }}
      onMouseEnter={handleMouseEnter}
      {...externalProps}
      {...rest}
    >
      {children}
    </a>
  );
}
