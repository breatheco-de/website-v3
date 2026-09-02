import * as fs from "fs";
import { getDefaultContentRoot } from "./site-config";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  parseTemplateTokens,
  resolveTokens,
  type ResolvedToken,
} from "./template-parser";
import { markFileAsModified } from "./sync-state";
import { child } from "./logger";
import {
  BUILTIN_CONSENT_KEYS,
  consentDefinitionToLocales,
  isBuiltinConsentKey,
  isValidConsentKey,
  localesToConsentDefinition,
} from "@shared/consent-settings";
const log = child({ module: "variable-manager" });

export const BRAND_VAR_KEYS = ["brand.title", "brand.logo", "brand.logo_dark"] as const;
export type BrandVarKey = (typeof BRAND_VAR_KEYS)[number];

export function isBrandVariable(name: string): boolean {
  return name.startsWith("brand.");
}

const DEFAULT_BRAND_LOGO_ID = "4geeks-devs-logo-1763162063433";
const DEFAULT_BRAND_TITLE = "4Geeks Academy";

export interface VariableCondition {
  query: Record<string, string>;
  value: string;
}

export interface VariableDefinition {
  default?: string;
  conditions?: VariableCondition[];
  by_locale?: Record<string, string>;
  by_region?: Record<string, string>;
  by_location?: Record<string, string>;
  isReserved?: boolean;
}

export interface VariableContext {
  location?: string;
  region?: string;
  locale?: string;
}

export interface ResolveResult {
  data: unknown;
  variableMap: VariableMapEntry[];
}

export interface VariableMapEntry {
  path: string;
  variableName: string;
  resolvedValue: string;
  source: ResolvedToken["source"];
  defaultValue: string;
}

class VariableManager {
  private readonly contentRoot: string;
  private readonly contentFolderName: string;
  private readonly variablesPath: string;
  private variables: Record<string, VariableDefinition> = {};
  private lastModified: number = 0;
  private initialized = false;

  constructor(contentRoot: string) {
    this.contentRoot = path.isAbsolute(contentRoot)
      ? contentRoot
      : path.join(process.cwd(), contentRoot);
    this.contentFolderName = path.relative(process.cwd(), this.contentRoot);
    this.variablesPath = path.join(this.contentRoot, "variables.yml");
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.load();
    } else {
      this.reloadIfChanged();
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.variablesPath)) {
        log.warn({ path: this.variablesPath }, "[VariableManager] variables.yml not found");
        this.variables = {};
        this.initialized = true;
        return;
      }

      const stat = fs.statSync(this.variablesPath);
      const raw = fs.readFileSync(this.variablesPath, "utf-8");
      const parsed = yaml.load(raw) as Record<string, VariableDefinition> | null;
      this.variables = parsed || {};
      this.lastModified = stat.mtimeMs;
      this.initialized = true;

      this.aliasReservedIntoGlobal();
      this.ensureBrandDefaults();
      this.markBrandProtected();

      const count = Object.keys(this.variables).length;
      log.info(`[VariableManager] Loaded ${count} variable definitions from ${this.contentFolderName}`);

      this.autoMigrate();
    } catch (err) {
      log.error({ err: err }, "[VariableManager] Failed to load variables.yml:");
      this.variables = {};
      this.initialized = true;
      this.ensureBrandDefaults();
      this.markBrandProtected();
    }
  }

  private markBrandProtected(): void {
    for (const key of Object.keys(this.variables)) {
      if (isBrandVariable(key)) {
        this.variables[key] = { ...this.variables[key], isReserved: true };
      }
    }
  }

  /** Seed brand.* keys if missing (in-memory + persist when any were added). */
  private ensureBrandDefaults(): void {
    let changed = false;
    const defaults: Record<BrandVarKey, string> = {
      "brand.title": DEFAULT_BRAND_TITLE,
      "brand.logo": DEFAULT_BRAND_LOGO_ID,
      "brand.logo_dark": "",
    };
    for (const key of BRAND_VAR_KEYS) {
      if (!this.variables[key]) {
        this.variables[key] = { default: defaults[key], isReserved: true };
        changed = true;
      } else {
        this.variables[key] = { ...this.variables[key], isReserved: true };
      }
    }
    if (changed && fs.existsSync(path.dirname(this.variablesPath))) {
      try {
        this.save();
        log.info("[VariableManager] Seeded brand.* defaults into variables.yml");
      } catch (err) {
        log.warn({ err }, "[VariableManager] Could not persist brand.* defaults");
      }
    }
  }

  getBrandSettings(): { title: string; logo: string; logo_dark: string } {
    this.ensureInitialized();
    return {
      title: this.variables["brand.title"]?.default ?? DEFAULT_BRAND_TITLE,
      logo: this.variables["brand.logo"]?.default ?? DEFAULT_BRAND_LOGO_ID,
      logo_dark: this.variables["brand.logo_dark"]?.default ?? "",
    };
  }

  updateBrandSetting(key: "title" | "logo" | "logo_dark", value: string): void {
    this.ensureInitialized();
    const varKey = `brand.${key}` as BrandVarKey;
    if (!this.variables[varKey]) {
      this.variables[varKey] = {};
    }
    this.variables[varKey].default = value;
    this.variables[varKey].isReserved = true;
    this.save();
  }

  private aliasReservedIntoGlobal(): void {
    for (const [key, def] of Object.entries(this.variables)) {
      if (!key.startsWith("reserved.")) continue;
      const suffix = key.slice("reserved.".length);
      const globalKey = `global.${suffix}`;
      // Mark the reserved entry itself
      this.variables[key] = { ...def, isReserved: true };
      // Alias into global namespace (reserved value takes precedence)
      this.variables[globalKey] = { ...def, isReserved: true };
    }
  }

  private autoMigrate(): void {
    const needsMigration = Object.values(this.variables).some(
      (def) => def.by_location || def.by_region || def.by_locale,
    );
    if (needsMigration) {
      log.info("[VariableManager] Legacy by_* fields detected, auto-migrating to conditions...");
      this.migrateToConditions();
    }
  }

  migrateToConditions(): void {
    for (const [name, def] of Object.entries(this.variables)) {
      if (!def.by_location && !def.by_region && !def.by_locale) continue;

      const conditions: VariableCondition[] = def.conditions || [];

      if (def.by_location) {
        for (const [loc, val] of Object.entries(def.by_location)) {
          conditions.push({ query: { location: loc }, value: val });
        }
        delete def.by_location;
      }

      if (def.by_region) {
        for (const [reg, val] of Object.entries(def.by_region)) {
          conditions.push({ query: { region: reg }, value: val });
        }
        delete def.by_region;
      }

      if (def.by_locale) {
        for (const [loc, val] of Object.entries(def.by_locale)) {
          conditions.push({ query: { locale: loc }, value: val });
        }
        delete def.by_locale;
      }

      def.conditions = conditions;
      this.variables[name] = def;
    }

    this.save();
    log.info("[VariableManager] Migration to conditions format complete");
  }

  private reloadIfChanged(): void {
    try {
      if (!fs.existsSync(this.variablesPath)) return;
      const stat = fs.statSync(this.variablesPath);
      if (stat.mtimeMs > this.lastModified) {
        log.info("[VariableManager] variables.yml changed, reloading...");
        this.load();
      }
    } catch {
      // ignore
    }
  }

  resolveVariable(
    name: string,
    context: VariableContext,
  ): { value: string; source: ResolvedToken["source"] } | null {
    this.ensureInitialized();

    const def = this.variables[name];
    if (!def) return null;

    if (def.conditions && def.conditions.length > 0) {
      for (const condition of def.conditions) {
        const matches = Object.entries(condition.query).every(([key, val]) => {
          const contextVal = (context as Record<string, string | undefined>)[key];
          return contextVal === val;
        });
        if (matches) {
          return { value: condition.value, source: "condition" };
        }
      }
    }

    if (context.location && def.by_location?.[context.location]) {
      return { value: def.by_location[context.location], source: "location" };
    }

    if (context.region && def.by_region?.[context.region]) {
      return { value: def.by_region[context.region], source: "region" };
    }

    if (context.locale && def.by_locale?.[context.locale]) {
      return { value: def.by_locale[context.locale], source: "locale" };
    }

    if (def.default !== undefined) {
      return { value: def.default, source: "default" };
    }

    return null;
  }

  resolveString(text: string, context: VariableContext): {
    text: string;
    resolvedTokens: ResolvedToken[];
  } {
    const tokens = parseTemplateTokens(text);
    if (tokens.length === 0) return { text, resolvedTokens: [] };

    return resolveTokens(text, tokens, (expression) =>
      this.resolveVariable(expression, context),
    );
  }

  resolveDeep(
    data: unknown,
    context: VariableContext,
    currentPath: string = "",
  ): ResolveResult {
    const variableMap: VariableMapEntry[] = [];

    const resolved = this.resolveValue(data, context, currentPath, variableMap);

    return { data: resolved, variableMap };
  }

  private resolveValue(
    value: unknown,
    context: VariableContext,
    currentPath: string,
    variableMap: VariableMapEntry[],
  ): unknown {
    if (typeof value === "string") {
      const { text, resolvedTokens } = this.resolveString(value, context);
      for (const token of resolvedTokens) {
        variableMap.push({
          path: currentPath,
          variableName: token.expression,
          resolvedValue: token.resolvedValue,
          source: token.source,
          defaultValue: token.defaultValue,
        });
      }
      return text;
    }

    if (Array.isArray(value)) {
      return value.map((item, i) =>
        this.resolveValue(item, context, `${currentPath}[${i}]`, variableMap),
      );
    }

    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        if (key.startsWith("_")) {
          result[key] = val;
          continue;
        }
        const childPath = currentPath ? `${currentPath}.${key}` : key;
        result[key] = this.resolveValue(val, context, childPath, variableMap);
      }
      return result;
    }

    return value;
  }

  getDefinitions(): Record<string, VariableDefinition> {
    this.ensureInitialized();
    return { ...this.variables };
  }

  getDefinition(name: string): VariableDefinition | null {
    this.ensureInitialized();
    return this.variables[name] || null;
  }

  updateDefault(name: string, value: string): void {
    this.ensureInitialized();
    if (!this.variables[name]) {
      this.variables[name] = {};
    }
    this.variables[name].default = value;
    this.save();
  }

  addCondition(name: string, condition: VariableCondition): void {
    this.ensureInitialized();
    if (!this.variables[name]) {
      this.variables[name] = {};
    }
    if (!this.variables[name].conditions) {
      this.variables[name].conditions = [];
    }
    this.variables[name].conditions!.push(condition);
    this.save();
  }

  updateCondition(name: string, index: number, condition: VariableCondition): void {
    this.ensureInitialized();
    const def = this.variables[name];
    if (!def || !def.conditions || index < 0 || index >= def.conditions.length) {
      throw new Error(`Invalid condition index ${index} for variable ${name}`);
    }
    def.conditions[index] = condition;
    this.save();
  }

  deleteCondition(name: string, index: number): void {
    this.ensureInitialized();
    const def = this.variables[name];
    if (!def || !def.conditions || index < 0 || index >= def.conditions.length) {
      throw new Error(`Invalid condition index ${index} for variable ${name}`);
    }
    def.conditions.splice(index, 1);
    if (def.conditions.length === 0) {
      delete def.conditions;
    }
    this.save();
  }

  reorderConditions(name: string, fromIndex: number, toIndex: number): void {
    this.ensureInitialized();
    const def = this.variables[name];
    if (!def || !def.conditions) {
      throw new Error(`Variable ${name} has no conditions`);
    }
    if (fromIndex < 0 || fromIndex >= def.conditions.length || toIndex < 0 || toIndex >= def.conditions.length) {
      throw new Error(`Invalid indices for reorder: from=${fromIndex}, to=${toIndex}`);
    }
    const [item] = def.conditions.splice(fromIndex, 1);
    def.conditions.splice(toIndex, 0, item);
    this.save();
  }

  updateVariable(
    name: string,
    level: string,
    key: string | undefined,
    value: string,
  ): void {
    this.ensureInitialized();

    if (!this.variables[name]) {
      this.variables[name] = {};
    }

    const def = this.variables[name];

    if (level === "default") {
      def.default = value;
    } else {
      const queryKey = level === "by_location" ? "location" : level === "by_region" ? "region" : "locale";
      if (key) {
        if (!def.conditions) {
          def.conditions = [];
        }
        const existingIdx = def.conditions.findIndex(
          (c) => Object.keys(c.query).length === 1 && c.query[queryKey] === key,
        );
        if (existingIdx >= 0) {
          def.conditions[existingIdx].value = value;
        } else {
          def.conditions.push({ query: { [queryKey]: key }, value });
        }
      }
    }

    this.save();
  }

  deleteVariableEntry(
    name: string,
    level: string,
    key: string | undefined,
  ): boolean {
    this.ensureInitialized();

    const def = this.variables[name];
    if (!def) return false;

    if (level === "default") {
      delete def.default;
    } else {
      const queryKey = level === "by_location" ? "location" : level === "by_region" ? "region" : "locale";
      if (key && def.conditions) {
        const idx = def.conditions.findIndex(
          (c) => Object.keys(c.query).length === 1 && c.query[queryKey] === key,
        );
        if (idx >= 0) {
          def.conditions.splice(idx, 1);
          if (def.conditions.length === 0) {
            delete def.conditions;
          }
        }
      }
    }

    this.save();
    return true;
  }

  /** Remove an entire non-reserved variable definition from variables.yml. */
  deleteDefinition(name: string): void {
    this.ensureInitialized();
    if (isBrandVariable(name) || name.startsWith("reserved.")) {
      throw new Error(`Variable "${name}" is reserved and cannot be deleted`);
    }
    const def = this.variables[name];
    if (!def) {
      throw new Error(`Variable "${name}" does not exist`);
    }
    if (def.isReserved) {
      throw new Error(`Variable "${name}" is reserved and cannot be deleted`);
    }
    delete this.variables[name];
    this.save();
  }

  renameVariable(oldName: string, newName: string): void {
    this.ensureInitialized();
    if (isBrandVariable(oldName) || this.variables[oldName]?.isReserved) {
      throw new Error(`Variable "${oldName}" is protected and cannot be renamed`);
    }
    if (!this.variables[oldName]) {
      throw new Error(`Variable "${oldName}" does not exist`);
    }
    if (this.variables[newName]) {
      throw new Error(`Variable "${newName}" already exists`);
    }
    this.variables[newName] = this.variables[oldName];
    delete this.variables[oldName];
    this.save();
  }

  getLegalSettings(): { legal_terms_url: string; legal_privacy_url: string } {
    this.ensureInitialized();
    return {
      legal_terms_url: this.variables["reserved.legal_terms_url"]?.default ?? "",
      legal_privacy_url: this.variables["reserved.legal_privacy_url"]?.default ?? "",
    };
  }

  listConsentKeys(): string[] {
    this.ensureInitialized();
    const extras = Object.keys(this.variables)
      .filter((k) => k.startsWith("reserved.consent_"))
      .map((k) => k.slice("reserved.".length))
      .filter((k) => !isBuiltinConsentKey(k))
      .sort();
    return [...BUILTIN_CONSENT_KEYS, ...extras];
  }

  getConsentSettings(defaultLocale: string): Record<string, Record<string, string>> {
    this.ensureInitialized();
    const result: Record<string, Record<string, string>> = {};
    for (const key of this.listConsentKeys()) {
      result[key] = consentDefinitionToLocales(
        this.variables[`reserved.${key}`],
        defaultLocale,
      );
    }
    return result;
  }

  updateConsentSetting(
    key: string,
    locales: Record<string, string>,
    defaultLocale: string,
  ): void {
    this.ensureInitialized();
    if (!isValidConsentKey(key)) {
      throw new Error(`Invalid consent key "${key}"`);
    }
    const reservedKey = `reserved.${key}`;
    const globalKey = `global.${key}`;
    const shape = localesToConsentDefinition(locales, defaultLocale);
    this.variables[reservedKey] = {
      ...shape,
      isReserved: true,
    };
    this.variables[globalKey] = {
      ...shape,
      isReserved: true,
    };
    this.save();
  }

  updateLegalSetting(key: "legal_terms_url" | "legal_privacy_url", value: string): void {
    this.ensureInitialized();
    const reservedKey = `reserved.${key}`;
    const globalKey = `global.${key}`;
    if (!this.variables[reservedKey]) {
      this.variables[reservedKey] = {};
    }
    this.variables[reservedKey].default = value;
    this.variables[reservedKey].isReserved = true;
    // Keep global alias in sync (in-memory only; file only has reserved.* keys)
    if (!this.variables[globalKey]) {
      this.variables[globalKey] = {};
    }
    this.variables[globalKey].default = value;
    this.variables[globalKey].isReserved = true;
    this.save();
  }

  private save(): void {
    try {
      // Only persist non-aliased entries (no global.* that came from reserved.*)
      const toSave: Record<string, VariableDefinition> = {};
      for (const [key, def] of Object.entries(this.variables)) {
        if (key.startsWith("global.") && this.variables[`reserved.${key.slice("global.".length)}`]) {
          // Skip — this is an aliased entry, the source is the reserved.* key
          continue;
        }
        const { isReserved: _skip, ...rest } = def;
        toSave[key] = rest;
      }
      const content = yaml.dump(toSave, {
        lineWidth: -1,
        quotingType: '"',
        forceQuotes: true,
      });
      fs.writeFileSync(this.variablesPath, content, "utf-8");
      const stat = fs.statSync(this.variablesPath);
      this.lastModified = stat.mtimeMs;
      markFileAsModified(`${this.contentFolderName}/variables.yml`, undefined, undefined, this.contentRoot);
      log.info(`[VariableManager] Saved variables.yml for ${this.contentFolderName}`);
    } catch (err) {
      log.error({ err: err }, "[VariableManager] Failed to save variables.yml:");
      throw err;
    }
  }

  refresh(): void {
    this.load();
  }
}

const _managerCache = new Map<string, VariableManager>();

function normalizeContentRoot(contentRoot?: string): string {
  const root = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(root) ? root : path.join(process.cwd(), root);
}

export function getVariableManager(contentRoot?: string): VariableManager {
  const key = normalizeContentRoot(contentRoot);
  let manager = _managerCache.get(key);
  if (!manager) {
    manager = new VariableManager(key);
    _managerCache.set(key, manager);
  }
  return manager;
}

export function resetVariableManagerCache(): void {
  _managerCache.clear();
}

/** @deprecated Use getVariableManager(contentRoot) for multi-site correctness. */
export const variableManager = getVariableManager();
