import { Job } from "sidequest";
import { buildHtmlRebuildSite } from "../../html-rebuild";
import { child } from "../../logger";
import { markJobFinished, markJobStarted } from "../heartbeat";

const log = child({ module: "job:local-database-refresh" });

export type LocalDatabaseRefreshPayload = {
  siteId: string;
  contentRoot: string;
  dbName: string;
};

export class LocalDatabaseRefreshJob extends Job {
  async run(payload: LocalDatabaseRefreshPayload): Promise<{ ok: boolean; changed: boolean }> {
    markJobStarted("local_database_refresh");
    try {
      if (!payload?.dbName || !payload.contentRoot || !payload.siteId) {
        return { ok: false, changed: false };
      }
      const site = buildHtmlRebuildSite(payload.contentRoot, payload.siteId);
      const rows = await site.database.reloadLocalFromDisk(payload.dbName);
      if (rows) {
        const { emitDatabaseRefreshed } = await import("../../content-events");
        emitDatabaseRefreshed(payload.siteId, payload.dbName, rows);
      }
      log.info(
        { dbName: payload.dbName, changed: rows !== null, rows: rows?.length ?? 0 },
        "local database refresh",
      );
      return { ok: true, changed: rows !== null };
    } finally {
      markJobFinished("local_database_refresh");
    }
  }
}
