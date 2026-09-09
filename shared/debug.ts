/**
 * Weblify verbose / debug mode.
 * On when DEBUG is exactly true/1, WEBLIFY_DEBUG is true/1, or argv has --debug.
 * Bare DEBUG=* (e.g. express:*) does not enable Weblify debug.
 */

function truthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true";
}

export function isWeblifyDebug(argv: string[] = process.argv): boolean {
  if (argv.includes("--debug")) return true;
  if (truthyFlag(process.env.WEBLIFY_DEBUG)) return true;
  if (truthyFlag(process.env.DEBUG)) return true;
  return false;
}

/** Apply CLI --debug into env so child processes inherit. */
export function applyDebugFromArgv(argv: string[] = process.argv): void {
  if (argv.includes("--debug") && !truthyFlag(process.env.WEBLIFY_DEBUG)) {
    process.env.WEBLIFY_DEBUG = "1";
  }
}
