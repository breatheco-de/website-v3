/** Loopback URL for browser / agents. Prefer 127.0.0.1 over localhost:
 * on macOS, localhost:5000 often hits AirPlay (Control Center), not Weblify.
 */
export function localOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** Default PORT for new Weblify projects (avoids macOS AirPlay on 5000). */
export const WEBLIFY_DEFAULT_PORT = 5050;

/** True when macOS AirPlay / Control Center commonly steals this port. */
export function isAirplayConflictPort(port: number): boolean {
  return port === 5000 && process.platform === "darwin";
}
