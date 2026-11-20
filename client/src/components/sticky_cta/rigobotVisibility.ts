/** Resolve sticky_cta `show_rigobot` (enum + legacy boolean) to a visibility mode. */
export type StickyShowRigobot = "off" | "mobile" | "desktop" | "all";

export function resolveShowRigobot(
  value: StickyShowRigobot | boolean | undefined | null,
): StickyShowRigobot {
  if (value === true) return "all";
  if (value === false || value == null || value === "off") return "off";
  return value;
}

/**
 * Tailwind classes matching section `showOn` (md = 768px).
 * Returns null when Rigobot should not mount.
 */
export function rigobotVisibilityClass(
  value: StickyShowRigobot | boolean | undefined | null,
): string | null {
  switch (resolveShowRigobot(value)) {
    case "mobile":
      return "block md:hidden";
    case "desktop":
      return "hidden md:block";
    case "all":
      return "";
    case "off":
    default:
      return null;
  }
}
