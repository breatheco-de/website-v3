import { collectExternalUrlsFromData } from "../../../server/link-extract";
import { ownHostsForContentRoot } from "../../../server/link-check/hosts";
import { entryLinkSource } from "./entryLinkSource";
import { isSeoValidationTarget } from "./seoValidationScope";
import type { ContentFile } from "./types";

/** External URLs used by the live (non-variant) files among `files`. */
export function externalUrlsForFiles(files: ContentFile[], contentRoot?: string): Set<string> {
  const ownHosts = ownHostsForContentRoot(contentRoot);
  const urls = new Set<string>();
  for (const file of files) {
    if (!isSeoValidationTarget(file)) continue;
    for (const url of collectExternalUrlsFromData(entryLinkSource(file), ownHosts)) urls.add(url);
  }
  return urls;
}
