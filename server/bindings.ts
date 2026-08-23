import fs from "fs";
import { getDefaultContentFolder } from "./site-config";
import path from "path";
import yaml from "js-yaml";
import { escapeObjectVars, unescapeYamlDump } from "@shared/templateVars";
import { markFileAsModified } from "./sync-state";
import {
  acquireLease,
  getActiveLease,
  releaseLease,
  bindingLeaseResource,
  type LeaseRecord,
} from "./leases";
import { generateSectionId } from "./utils/generateSectionId";
import { contentIndex } from "./content-index";
import { isSharedLayoutType } from "./shared-layout-entry";
import { child } from "./logger";
const log = child({ module: "bindings" });



function safeYamlDump(obj: unknown, opts?: yaml.DumpOptions): string {
  const { escaped, map } = escapeObjectVars(obj);
  const dumped = yaml.dump(escaped, opts);
  return unescapeYamlDump(dumped, map);
}

function getBindingsFile(): string {
  return path.join(process.cwd(), getDefaultContentFolder(), "section-bindings.json");
}

/** True when the content type uses shared layout (DB-backed or single_template). */
export function isSharedLayoutContentType(
  contentType: string,
  contentRoot?: string,
): boolean {
  return isSharedLayoutType(contentType, contentRoot);
}

function assertMembersNotOnSharedLayout(members: BindingMember[]): void {
  for (const member of members) {
    if (isSharedLayoutContentType(member.contentType)) {
      throw new Error(
        `Section bindings cannot be used on shared-layout content types (${member.contentType}). ` +
          `Bindings only work on ordinary page types without a shared template.`,
      );
    }
  }
}

const EXCLUDED_PROPERTIES = new Set([
  "paddingY",
  "paddingTop",
  "paddingBottom",
  "marginY",
  "marginTop",
  "marginBottom",
  "padding",
  "margin",
  "background",
  "background_color",
  "backgroundColor",
  "bg_color",
  "visibility",
  "show_on",
  "item_overrides",
  "section_id",
  "anchor",
  "css_class",
  "cssClass",
  "customClass",
]);

export interface BindingMember {
  contentType: string;
  slug: string;
  sectionId: string;
}

export interface BindingGroup {
  id: string;
  name?: string;
  component: string;
  locale: string;
  members: BindingMember[];
  createdAt: string;
  updatedAt?: string;
}

interface BindingsData {
  groups: BindingGroup[];
}

function generateId(): string {
  return `bind_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}


class BindingManager {
  private data: BindingsData = { groups: [] };
  private memberIndex: Map<string, string> = new Map();
  private loaded = false;

  private memberKey(contentType: string, slug: string, sectionId: string, locale: string): string {
    return `${contentType}:${slug}:${sectionId}:${locale}`;
  }

  private rebuildIndex(): void {
    this.memberIndex.clear();
    for (const group of this.data.groups) {
      for (const member of group.members) {
        const key = this.memberKey(member.contentType, member.slug, member.sectionId, group.locale);
        this.memberIndex.set(key, group.id);
      }
    }
  }

  resolveSectionIndex(contentType: string, slug: string, sectionId: string, locale: string): number {
    const { data } = this.loadPageContent(contentType, slug, locale);
    if (!data) return -1;
    const sections = data.sections as Record<string, unknown>[];
    if (!Array.isArray(sections)) return -1;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i] as Record<string, unknown>;
      if (s && s.section_id === sectionId) return i;
    }
    return -1;
  }

  ensureSectionId(contentType: string, slug: string, sectionIndex: number, locale: string, author?: string): string {
    const { data, filePath } = this.loadPageContent(contentType, slug, locale);
    if (!data) throw new Error(`Cannot load content for ${contentType}/${slug}`);
    const sections = data.sections as Record<string, unknown>[];
    if (!Array.isArray(sections) || sectionIndex >= sections.length) {
      throw new Error(`Section index ${sectionIndex} out of range for ${contentType}/${slug}`);
    }
    const section = sections[sectionIndex] as Record<string, unknown>;
    if (!section) throw new Error(`Invalid section at index ${sectionIndex}`);

    if (section.section_id && typeof section.section_id === "string") {
      return section.section_id;
    }

    const componentType = (section.type as string) || "section";
    const newId = generateSectionId(componentType);
    section.section_id = newId;

    const updatedYaml = safeYamlDump(data, {
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });
    fs.writeFileSync(filePath, updatedYaml, "utf-8");
    markFileAsModified(filePath, author);

    return newId;
  }

  getSectionIdAtIndex(contentType: string, slug: string, sectionIndex: number, locale: string): string | null {
    const { data } = this.loadPageContent(contentType, slug, locale);
    if (!data) return null;
    const sections = data.sections as Record<string, unknown>[];
    if (!Array.isArray(sections) || sectionIndex >= sections.length) return null;
    const section = sections[sectionIndex] as Record<string, unknown>;
    if (!section || typeof section.section_id !== "string") return null;
    return section.section_id;
  }

  load(): void {
    try {
      if (fs.existsSync(getBindingsFile())) {
        const raw = fs.readFileSync(getBindingsFile(), "utf-8");
        this.data = JSON.parse(raw);
        if (!Array.isArray(this.data.groups)) {
          this.data = { groups: [] };
        }
      } else {
        this.data = { groups: [] };
      }
    } catch (error) {
      log.error({ err: error }, "[BindingManager] Error loading bindings:");
      this.data = { groups: [] };
    }
    this.migrateFromSectionIndex();
    this.rebuildIndex();
    this.loaded = true;
    log.info(`[BindingManager] Loaded ${this.data.groups.length} binding groups`);
  }

  private migrateFromSectionIndex(): void {
    let migrated = 0;
    let needsSave = false;

    for (const group of this.data.groups) {
      const newMembers: BindingMember[] = [];
      for (const member of group.members) {
        const legacyMember = member as unknown as { contentType: string; slug: string; sectionIndex?: number; sectionId?: string };
        if (typeof legacyMember.sectionIndex === "number" && !legacyMember.sectionId) {
          try {
            const sid = this.ensureSectionId(legacyMember.contentType, legacyMember.slug, legacyMember.sectionIndex, group.locale);
            newMembers.push({ contentType: legacyMember.contentType, slug: legacyMember.slug, sectionId: sid });
            migrated++;
            needsSave = true;
          } catch (err) {
            log.error({ err: err }, `[BindingManager] Migration failed for ${legacyMember.contentType}/${legacyMember.slug}[${legacyMember.sectionIndex}]:`);
          }
        } else if (legacyMember.sectionId) {
          newMembers.push({ contentType: legacyMember.contentType, slug: legacyMember.slug, sectionId: legacyMember.sectionId });
        }
      }
      group.members = newMembers;
    }

    this.data.groups = this.data.groups.filter(g => g.members.length >= 2);

    if (needsSave) {
      log.info(`[BindingManager] Migrated ${migrated} members from sectionIndex to sectionId`);
      this.save();
    }
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load();
  }

  private save(author?: string): void {
    try {
      const bindingsFile = getBindingsFile();
      const dir = path.dirname(bindingsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(bindingsFile, JSON.stringify(this.data, null, 2), "utf-8");
      markFileAsModified(`${getDefaultContentFolder()}/section-bindings.json`, author);
    } catch (error) {
      log.error({ err: error }, "[BindingManager] Error saving bindings:");
    }
  }

  getAll(): BindingGroup[] {
    this.ensureLoaded();
    return [...this.data.groups];
  }

  getGroupById(groupId: string): BindingGroup | undefined {
    this.ensureLoaded();
    return this.data.groups.find(g => g.id === groupId);
  }

  findGroupForSection(contentType: string, slug: string, sectionId: string, locale?: string): BindingGroup | undefined {
    this.ensureLoaded();
    if (locale) {
      const key = this.memberKey(contentType, slug, sectionId, locale);
      const groupId = this.memberIndex.get(key);
      if (!groupId) return undefined;
      return this.data.groups.find(g => g.id === groupId);
    }
    return this.data.groups.find(g =>
      g.members.some(m => m.contentType === contentType && m.slug === slug && m.sectionId === sectionId)
    );
  }

  findGroupForSectionByIndex(contentType: string, slug: string, sectionIndex: number, locale: string): BindingGroup | undefined {
    this.ensureLoaded();
    const sectionId = this.getSectionIdAtIndex(contentType, slug, sectionIndex, locale);
    if (!sectionId) return undefined;
    return this.findGroupForSection(contentType, slug, sectionId, locale);
  }

  findGroupsForPage(contentType: string, slug: string): BindingGroup[] {
    this.ensureLoaded();
    return this.data.groups.filter(g =>
      g.members.some(m => m.contentType === contentType && m.slug === slug)
    );
  }

  /** All binding groups that include at least one member of this content type. */
  findGroupsForContentType(contentType: string): BindingGroup[] {
    this.ensureLoaded();
    return this.data.groups.filter((g) =>
      g.members.some((m) => m.contentType === contentType),
    );
  }

  /**
   * Dissolve every binding group that includes this content type.
   * Used when enabling shared layout — bindings and shared templates do not mix.
   */
  dissolveGroupsForContentType(
    contentType: string,
    author?: string,
  ): { dissolved: BindingGroup[]; count: number } {
    this.ensureLoaded();
    const toRemove = this.findGroupsForContentType(contentType);
    if (toRemove.length === 0) {
      return { dissolved: [], count: 0 };
    }
    const removeIds = new Set(toRemove.map((g) => g.id));
    this.data.groups = this.data.groups.filter((g) => !removeIds.has(g.id));
    this.rebuildIndex();
    this.save(author);
    return { dissolved: toRemove, count: toRemove.length };
  }

  private validateMemberComponent(member: BindingMember, expectedComponent: string, locale: string): void {
    const idx = this.resolveSectionIndex(member.contentType, member.slug, member.sectionId, locale);
    if (idx === -1) {
      throw new Error(`Section with id "${member.sectionId}" not found in ${member.contentType}/${member.slug}`);
    }
    const { data } = this.loadPageContent(member.contentType, member.slug, locale);
    if (!data) throw new Error(`Cannot access content for ${member.contentType}/${member.slug}`);
    const sections = data.sections as Record<string, unknown>[];
    const section = sections[idx];
    if (!section || (section as Record<string, unknown>).type !== expectedComponent) {
      throw new Error(
        `Section "${member.sectionId}" in ${member.contentType}/${member.slug} is type "${(section as Record<string, unknown>)?.type}", expected "${expectedComponent}"`
      );
    }
  }

  createGroup(
    component: string,
    locale: string,
    members: BindingMember[],
    options?: { name?: string; sourceIndex?: number },
    author?: string
  ): BindingGroup {
    this.ensureLoaded();

    if (members.length < 2) {
      throw new Error("A binding group requires at least 2 members");
    }

    assertMembersNotOnSharedLayout(members);

    for (const member of members) {
      this.validateMemberComponent(member, component, locale);
      const key = this.memberKey(member.contentType, member.slug, member.sectionId, locale);
      const existingGroupId = this.memberIndex.get(key);
      if (existingGroupId) {
        throw new Error(
          `Section "${member.sectionId}" in ${member.contentType}/${member.slug} is already in binding group ${existingGroupId}`
        );
      }
    }

    const group: BindingGroup = {
      id: generateId(),
      component,
      locale,
      members,
      createdAt: new Date().toISOString(),
    };
    if (options?.name) {
      group.name = options.name;
    }

    this.data.groups.push(group);
    this.rebuildIndex();
    this.save(author);

    const srcIdx = options?.sourceIndex ?? 0;
    const sourceMember = members[srcIdx] || members[0];
    this.propagateFromMember(group, sourceMember, author);

    return group;
  }

  renameGroup(groupId: string, name: string, author?: string): BindingGroup {
    this.ensureLoaded();
    const group = this.data.groups.find(g => g.id === groupId);
    if (!group) throw new Error(`Binding group ${groupId} not found`);
    group.name = name || undefined;
    group.updatedAt = new Date().toISOString();
    this.save(author);
    return group;
  }

  private propagateFromMember(group: BindingGroup, sourceMember: BindingMember, author?: string): void {
    const sourceIdx = this.resolveSectionIndex(sourceMember.contentType, sourceMember.slug, sourceMember.sectionId, group.locale);
    if (sourceIdx === -1) return;
    const { data: sourceData } = this.loadPageContent(sourceMember.contentType, sourceMember.slug, group.locale);
    if (!sourceData) return;
    const sourceSections = sourceData.sections as Record<string, unknown>[];
    if (!Array.isArray(sourceSections) || sourceIdx >= sourceSections.length) return;
    const sourceSection = sourceSections[sourceIdx] as Record<string, unknown>;
    if (!sourceSection) return;

    const siblings = group.members.filter(
      m => !(m.contentType === sourceMember.contentType && m.slug === sourceMember.slug && m.sectionId === sourceMember.sectionId)
    );

    for (const sibling of siblings) {
      try {
        const siblingIdx = this.resolveSectionIndex(sibling.contentType, sibling.slug, sibling.sectionId, group.locale);
        if (siblingIdx === -1) continue;
        const { data: siblingData, filePath } = this.loadPageContent(sibling.contentType, sibling.slug, group.locale);
        if (!siblingData) continue;
        const sections = siblingData.sections as Record<string, unknown>[];
        if (!Array.isArray(sections) || siblingIdx >= sections.length) continue;
        const existingSectionObj = sections[siblingIdx] as Record<string, unknown>;
        if (!existingSectionObj) continue;

        sections[siblingIdx] = this.mergeContentIntoSection(existingSectionObj, sourceSection);
        const updatedYaml = safeYamlDump(siblingData, {
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
          forceQuotes: false,
        });
        fs.writeFileSync(filePath, updatedYaml, "utf-8");
        markFileAsModified(filePath, author);
      } catch (err) {
        log.error({ err: err }, `[BindingManager] Error propagating to ${sibling.contentType}/${sibling.slug}:`);
      }
    }
  }

  addMember(groupId: string, member: BindingMember, author?: string): BindingGroup {
    this.ensureLoaded();
    const group = this.data.groups.find(g => g.id === groupId);
    if (!group) throw new Error(`Binding group ${groupId} not found`);

    assertMembersNotOnSharedLayout([member]);

    this.validateMemberComponent(member, group.component, group.locale);

    const key = this.memberKey(member.contentType, member.slug, member.sectionId, group.locale);
    const existingGroupId = this.memberIndex.get(key);
    if (existingGroupId) {
      throw new Error(
        `Section "${member.sectionId}" in ${member.contentType}/${member.slug} is already in binding group ${existingGroupId}`
      );
    }

    const alreadyMember = group.members.some(
      m => m.contentType === member.contentType && m.slug === member.slug && m.sectionId === member.sectionId
    );
    if (alreadyMember) {
      throw new Error("Section is already a member of this group");
    }

    group.members.push(member);
    group.updatedAt = new Date().toISOString();
    this.rebuildIndex();
    this.save(author);

    const existingMember = group.members.find(
      m => !(m.contentType === member.contentType && m.slug === member.slug && m.sectionId === member.sectionId)
    );
    if (existingMember) {
      this.propagateFromMember(
        { ...group, members: [existingMember, member] },
        existingMember,
        author
      );
    }

    return group;
  }

  removeMemberBySectionId(groupId: string, contentType: string, slug: string, sectionId: string, author?: string): BindingGroup | null {
    this.ensureLoaded();
    const group = this.data.groups.find(g => g.id === groupId);
    if (!group) throw new Error(`Binding group ${groupId} not found`);

    group.members = group.members.filter(
      m => !(m.contentType === contentType && m.slug === slug && m.sectionId === sectionId)
    );

    if (group.members.length < 2) {
      this.data.groups = this.data.groups.filter(g => g.id !== groupId);
      this.rebuildIndex();
      this.save(author);
      return null;
    }

    group.updatedAt = new Date().toISOString();
    this.rebuildIndex();
    this.save(author);
    return group;
  }

  deleteGroup(groupId: string, author?: string): void {
    this.ensureLoaded();
    this.data.groups = this.data.groups.filter(g => g.id !== groupId);
    this.rebuildIndex();
    this.save(author);
  }

  private loadPageContent(contentType: string, slug: string, locale: string): { data: Record<string, unknown> | null; filePath: string } {
    const { data, filePath } = contentIndex.loadLocaleData(contentType, slug, locale);
    return { data, filePath };
  }

  private stripExcludedProperties(section: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(section)) {
      if (!EXCLUDED_PROPERTIES.has(key)) {
        result[key] = value;
      }
    }
    return result;
  }

  private mergeContentIntoSection(
    existingSection: Record<string, unknown>,
    sourceSection: Record<string, unknown>
  ): Record<string, unknown> {
    const contentOnly = this.stripExcludedProperties(sourceSection);

    const preserved: Record<string, unknown> = {};
    EXCLUDED_PROPERTIES.forEach(key => {
      if (key in existingSection) {
        preserved[key] = existingSection[key];
      }
    });

    return { ...contentOnly, ...preserved };
  }

  propagateUpdate(
    sourceContentType: string,
    sourceSlug: string,
    sectionIndex: number,
    updatedSection: Record<string, unknown> | undefined,
    author?: string,
    locale?: string,
    opts?: { reReadSource?: boolean },
  ): { success: boolean; updatedFiles: string[]; errors: string[] } {
    this.ensureLoaded();

    const resolvedLocale = locale || "en";
    const sectionId = this.getSectionIdAtIndex(sourceContentType, sourceSlug, sectionIndex, resolvedLocale);
    if (!sectionId) return { success: true, updatedFiles: [], errors: [] };

    const group = this.findGroupForSection(sourceContentType, sourceSlug, sectionId, resolvedLocale);
    if (!group) return { success: true, updatedFiles: [], errors: [] };

    let sectionToPropagate = updatedSection;
    if (opts?.reReadSource || !sectionToPropagate) {
      const { data: sourceData } = this.loadPageContent(sourceContentType, sourceSlug, resolvedLocale);
      const sections = sourceData?.sections as Record<string, unknown>[] | undefined;
      if (!sections || sectionIndex >= sections.length) {
        return { success: false, updatedFiles: [], errors: ["Source section not found for propagation"] };
      }
      sectionToPropagate = sections[sectionIndex] as Record<string, unknown>;
    }
    if (!sectionToPropagate) {
      return { success: false, updatedFiles: [], errors: ["No section content to propagate"] };
    }

    const siblings = group.members.filter(
      m => !(m.contentType === sourceContentType && m.slug === sourceSlug && m.sectionId === sectionId)
    );

    if (siblings.length === 0) return { success: true, updatedFiles: [], errors: [] };

    const updatedFiles: string[] = [];
    const errors: string[] = [];

    for (const sibling of siblings) {
      try {
        const siblingIdx = this.resolveSectionIndex(sibling.contentType, sibling.slug, sibling.sectionId, group.locale);
        if (siblingIdx === -1) {
          errors.push(`Section "${sibling.sectionId}" not found in ${sibling.contentType}/${sibling.slug}`);
          continue;
        }

        const { data: siblingData, filePath } = this.loadPageContent(sibling.contentType, sibling.slug, group.locale);
        if (!siblingData) {
          errors.push(`Could not load content for ${sibling.contentType}/${sibling.slug}`);
          continue;
        }

        const sections = siblingData.sections as Record<string, unknown>[];
        if (!Array.isArray(sections) || siblingIdx >= sections.length) {
          errors.push(`Section index ${siblingIdx} out of range for ${sibling.contentType}/${sibling.slug}`);
          continue;
        }

        const existingSection = sections[siblingIdx];
        if (typeof existingSection !== "object" || existingSection === null) {
          errors.push(`Invalid section at index ${siblingIdx} for ${sibling.contentType}/${sibling.slug}`);
          continue;
        }

        const existingSectionObj = existingSection as Record<string, unknown>;
        if (existingSectionObj.type !== sectionToPropagate.type) {
          errors.push(
            `Component mismatch at ${sibling.contentType}/${sibling.slug}[${siblingIdx}]: ` +
            `expected ${sectionToPropagate.type}, found ${existingSectionObj.type}`
          );
          continue;
        }

        sections[siblingIdx] = this.mergeContentIntoSection(existingSectionObj, sectionToPropagate);

        const updatedYaml = safeYamlDump(siblingData, {
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
          forceQuotes: false,
        });

        fs.writeFileSync(filePath, updatedYaml, "utf-8");
        markFileAsModified(filePath, author);
        updatedFiles.push(`${sibling.contentType}/${sibling.slug}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        errors.push(`Error propagating to ${sibling.contentType}/${sibling.slug}: ${msg}`);
      }
    }

    return { success: errors.length === 0, updatedFiles, errors };
  }

  cleanupStaleReferences(dryRun = false): number {
    this.ensureLoaded();
    let removed = 0;

    for (const group of this.data.groups) {
      const validMembers = group.members.filter(member => {
        try {
          const idx = this.resolveSectionIndex(member.contentType, member.slug, member.sectionId, group.locale);
          if (idx === -1) return false;
          const { data } = this.loadPageContent(member.contentType, member.slug, group.locale);
          if (!data) return false;
          const sections = data.sections as unknown[];
          if (!Array.isArray(sections) || idx >= sections.length) return false;
          const section = sections[idx] as Record<string, unknown>;
          return section && section.type === group.component;
        } catch {
          return false;
        }
      });

      removed += group.members.length - validMembers.length;
      if (!dryRun) {
        group.members = validMembers;
      }
    }

    const emptyGroups = dryRun
      ? this.data.groups.filter(g => g.members.length < 2).length
      : 0;

    if (!dryRun) {
      const beforeCount = this.data.groups.length;
      this.data.groups = this.data.groups.filter(g => g.members.length >= 2);
      removed += beforeCount - this.data.groups.length;

      if (removed > 0) {
        this.rebuildIndex();
        this.save();
        log.info(`[BindingManager] Cleaned up ${removed} stale references`);
      }
    } else {
      removed += emptyGroups;
    }

    return removed;
  }

  acquirePropagationLease(
    site: string,
    groupId: string,
    locale: string,
    holder: string,
  ): { ok: true; lease: LeaseRecord } | { ok: false; lease: LeaseRecord } {
    return acquireLease(site, bindingLeaseResource(groupId, locale), holder);
  }

  getActivePropagationLease(site: string, groupId: string, locale: string): LeaseRecord | null {
    return getActiveLease(site, bindingLeaseResource(groupId, locale));
  }

  releasePropagationLease(
    site: string,
    groupId: string,
    locale: string,
    holder: string,
    token: number,
  ): void {
    releaseLease(site, bindingLeaseResource(groupId, locale), holder, token);
  }
}

export const bindingManager = new BindingManager();
