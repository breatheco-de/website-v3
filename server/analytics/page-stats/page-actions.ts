/**
 * Page actions resolver: counts checkout buttons, lead forms, and micro events on a page.
 * Used to decide whether a decision-stage page should track enrollment clicks or only leads.
 */

import { trackedEnrollButtonsByVersion } from "../../versioning/enroll-buttons";
import { getAllFormEntries } from "../../form-state";
import { getLeadConversionEventNames } from "../../settings";
import { loadAllMicroEvents, resolveLoadedMicroEvents } from "../../component-registry";
import { TEST_DEFAULT_VERSION } from "@shared/page-stats";
import type { VersioningManager } from "../../versioning/VersioningManager";
import type { ContentIndex } from "../../content-index";
import { child } from "../../logger";

const log = child({ module: "page-stats/page-actions" });

export type PageActions = {
  checkout_buttons: number;
  lead_forms: number;
  micro: {
    event_names: string[];
    broken: boolean;
  };
};

export type ResolvePageActionsOpts = {
  contentFolder: string;
  contentRoot?: string;
  entry: { content_type: string; slug: string; locale: string };
  /** All locales in scope for this page stats call (one for `url`, all for `entry`). */
  locales: string[];
  vm: VersioningManager;
};

/** Resolves page actions for objective selection (enrollment vs lead-only). */
export function resolvePageActions(opts: ResolvePageActionsOpts): PageActions {
  const checkoutButtons = countCheckoutButtons(opts);
  const leadForms = countLeadForms(opts);
  const micro = resolveMicroEvents(opts);

  return {
    checkout_buttons: checkoutButtons,
    lead_forms: leadForms,
    micro,
  };
}

/** Count tracked enrollment buttons across live + running test versions and all locales in scope. */
function countCheckoutButtons(opts: ResolvePageActionsOpts): number {
  try {
    const test = opts.vm.getLatestRun(opts.entry.content_type, opts.entry.slug, opts.entry.locale);
    const versions: string[] = [TEST_DEFAULT_VERSION];
    
    // Add running test versions
    if (test && !test.ended_at) {
      versions.push(...test.versions.filter((v) => v !== TEST_DEFAULT_VERSION));
    }

    let total = 0;
    for (const locale of opts.locales) {
      const buttons = trackedEnrollButtonsByVersion({
        vm: opts.vm,
        contentType: opts.entry.content_type,
        slug: opts.entry.slug,
        locale,
        versions,
        contentFolder: opts.contentFolder,
      });

      if (buttons) {
        total += Object.values(buttons).reduce((sum, count) => sum + count, 0);
      }
    }

    return total;
  } catch (err) {
    log.warn({ err, entry: opts.entry }, "[page-actions] checkout button count failed");
    return 0;
  }
}

/** Count form-state entries for this entry/locales whose conversion_name is a lead event. */
function countLeadForms(opts: ResolvePageActionsOpts): number {
  try {
    const leadEventNames = new Set(getLeadConversionEventNames(opts.contentRoot));
    const allForms = getAllFormEntries();
    
    // Form-state uses plural content type folder names (e.g., "programs" not "program")
    // We need to match the content_type exactly as it appears in form-state
    const localeSet = new Set(opts.locales);
    
    const matchingForms = allForms.filter((form) => {
      // Match entry by content_type and slug
      const typeMatch = form.content_type === opts.entry.content_type;
      const slugMatch = form.slug === opts.entry.slug;
      const localeMatch = localeSet.has(form.locale);
      const isLeadEvent = form.conversion_name && leadEventNames.has(form.conversion_name);
      
      return typeMatch && slugMatch && localeMatch && isLeadEvent;
    });

    return matchingForms.length;
  } catch (err) {
    log.warn({ err, entry: opts.entry }, "[page-actions] lead form count failed");
    return 0;
  }
}

/** Load micro events catalog and walk sections to union event names; broken if any file is broken. */
function resolveMicroEvents(opts: ResolvePageActionsOpts): { event_names: string[]; broken: boolean } {
  try {
    const catalog = loadAllMicroEvents(opts.contentFolder);
    
    // For a complete implementation, we would need to:
    // 1. Load the page's sections (live + test versions)
    // 2. For each section, resolve its micro events using the catalog
    // 3. Union all event names
    // 4. Check if any section's micro-events file is broken
    
    // For now, return a minimal implementation that checks for broken files
    const eventNames = new Set<string>();
    let broken = false;

    for (const [componentType, entry] of Object.entries(catalog)) {
      if (entry.status === "error") {
        broken = true;
      } else if (entry.status === "ok") {
        // Collect event names from this component's micro events
        for (const row of entry.map) {
          if (row.events) {
            for (const event of row.events) {
              if (typeof event === "string") {
                eventNames.add(event);
              } else if (event && typeof event === "object" && "name" in event) {
                eventNames.add(String(event.name));
              }
            }
          }
        }
      }
    }

    return {
      event_names: Array.from(eventNames).sort(),
      broken,
    };
  } catch (err) {
    log.warn({ err, entry: opts.entry }, "[page-actions] micro events resolution failed");
    return { event_names: [], broken: true };
  }
}
