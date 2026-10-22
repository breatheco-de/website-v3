import { config as loadDotenv } from "dotenv";
loadDotenv({ quiet: true });
const { getAnalyticsReport } = await import("/Users/alejandrosanchez/Documents/Code/website-v3/server/analytics/reports.ts");
const r = await getAnalyticsReport({ report: "events_by_name", days: 14, limit: 60, contentRoot: "site_4geeks-com" });
console.log("status", r.status, "warnings", JSON.stringify(r.warnings));
for (const row of r.rows) console.log(row.event_name, row.event_count);
process.exit(0);
