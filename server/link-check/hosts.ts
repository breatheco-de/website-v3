/**
 * Which hosts are "ours": the site's own domains (links resolved offline as internal)
 * and our media buckets (dead images there are our bug, so they are errors).
 */

import * as path from "path";
import { getBucketName, getSiteConfigs } from "../site-config";

/** Buckets that serve our uploaded media, besides the sites.yml `bucket_name`. */
const OWN_MEDIA_BUCKETS = ["breathecode-prod-images", "4geeks-academy-website"];

export function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** Domain + aliases of the site whose content folder is `contentRoot` (www. stripped). */
export function ownHostsForContentRoot(contentRoot?: string): string[] {
  const folder = contentRoot ? path.basename(contentRoot) : undefined;
  const out = new Set<string>();
  try {
    for (const c of getSiteConfigs()) {
      if (folder && path.basename(c.contentFolder) !== folder) continue;
      out.add(stripWww(c.domain));
      for (const a of c.aliases ?? []) out.add(stripWww(a));
    }
  } catch {
    /* no sites.yml → no own hosts */
  }
  return [...out];
}

export function ownMediaBuckets(): string[] {
  const buckets = new Set(OWN_MEDIA_BUCKETS);
  try {
    const configured = getBucketName();
    if (configured) buckets.add(configured);
  } catch {
    /* optional */
  }
  return [...buckets];
}

/** True for `storage.googleapis.com/<bucket>/…` and `<bucket>.storage.googleapis.com/…` on our buckets. */
export function isOwnMediaUrl(rawUrl: string, buckets: string[] = ownMediaBuckets()): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === "storage.googleapis.com") {
    const bucket = url.pathname.split("/")[1] ?? "";
    return buckets.includes(bucket);
  }
  if (host.endsWith(".storage.googleapis.com")) {
    return buckets.includes(host.slice(0, -".storage.googleapis.com".length));
  }
  return false;
}
