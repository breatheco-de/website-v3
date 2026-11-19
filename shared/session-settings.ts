/** Visitor session settings stored in settings.yml → session. */

export type SessionLocationSettings = {
  /** Private database slug that supplies campus rows (e.g. "locations"). Null = off. */
  database: string | null;
  /** When true and database is set, IP geo fills session.location from that catalog. */
  fill_from_ip: boolean;
};

export type SessionSettings = {
  location: SessionLocationSettings;
};

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  location: {
    database: null,
    fill_from_ip: true,
  },
};

export function parseSessionSettings(raw: unknown): SessionSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SESSION_SETTINGS, location: { ...DEFAULT_SESSION_SETTINGS.location } };
  const rec = raw as Record<string, unknown>;
  const loc = rec.location && typeof rec.location === "object" ? (rec.location as Record<string, unknown>) : {};
  const database =
    typeof loc.database === "string" && loc.database.trim() ? loc.database.trim() : null;
  return {
    location: {
      database,
      fill_from_ip: loc.fill_from_ip !== false,
    },
  };
}
