/**
 * Backgrounds Validator
 * 
 * Validates that all background values in YAML content files
 * are defined in the theme.json configuration.
 * 
 * Can be used:
 * - Preventively: Called from UI when saving to block invalid colors
 * - Reactively: Called via CLI to scan all content files
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { Validator, ValidationContext, ValidatorResult, ValidationIssue } from "../shared/types";
import { getAllDirectories } from "../../../server/content-types";
import { BACKGROUNDS_ISSUE_CODES } from "./backgrounds.issueCodes";

const THEME_PATH = path.join(process.cwd(), "4geeks-com", "theme.json");
const CONTENT_DIRS = getAllDirectories().map(dir => `4geeks-com/${dir}`);

interface ThemeColor {
  id: string;
  label: string;
  cssVar?: string;
  value?: string;
}

interface ThemeConfig {
  backgrounds: ThemeColor[];
  accents?: ThemeColor[];
  text?: ThemeColor[];
}

interface SectionWithBackground {
  type?: string;
  background?: string;
  [key: string]: unknown;
}

function loadTheme(): ThemeConfig | null {
  try {
    if (!fs.existsSync(THEME_PATH)) {
      return null;
    }
    const content = fs.readFileSync(THEME_PATH, "utf-8");
    return JSON.parse(content) as ThemeConfig;
  } catch {
    return null;
  }
}

function buildAllowedValues(theme: ThemeConfig): Set<string> {
  const allowed = new Set<string>();
  
  allowed.add("");
  
  for (const bg of theme.backgrounds) {
    allowed.add(bg.id);
    
    if (bg.cssVar) {
      allowed.add(`hsl(var(${bg.cssVar}))`);
    }
    if (bg.value) {
      allowed.add(bg.value);
    }
  }
  
  return allowed;
}

function extractBackgrounds(obj: unknown, results: { value: string; path: string }[], currentPath: string = ""): void {
  if (!obj || typeof obj !== "object") return;
  
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      extractBackgrounds(item, results, `${currentPath}[${index}]`);
    });
    return;
  }
  
  const record = obj as Record<string, unknown>;
  
  if ("background" in record && typeof record.background === "string" && record.background) {
    results.push({
      value: record.background,
      path: currentPath ? `${currentPath}.background` : "background",
    });
  }
  
  for (const [key, value] of Object.entries(record)) {
    if (key !== "background" && typeof value === "object" && value !== null) {
      extractBackgrounds(value, results, currentPath ? `${currentPath}.${key}` : key);
    }
  }
}

function scanYamlFile(filePath: string): SectionWithBackground[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = yaml.load(content) as Record<string, unknown>;
    
    const backgrounds: { value: string; path: string }[] = [];
    extractBackgrounds(parsed, backgrounds);
    
    return backgrounds.map(b => ({
      type: "extracted",
      background: b.value,
      _path: b.path,
    }));
  } catch {
    return [];
  }
}

function scanAllContentFiles(): { file: string; backgrounds: { value: string; path: string }[] }[] {
  const results: { file: string; backgrounds: { value: string; path: string }[] }[] = [];
  
  for (const dir of CONTENT_DIRS) {
    const fullDir = path.join(process.cwd(), dir);
    if (!fs.existsSync(fullDir)) continue;
    
    const walkDir = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
          try {
            const content = fs.readFileSync(fullPath, "utf-8");
            const parsed = yaml.load(content);
            const backgrounds: { value: string; path: string }[] = [];
            extractBackgrounds(parsed, backgrounds);
            
            if (backgrounds.length > 0) {
              results.push({
                file: fullPath,
                backgrounds,
              });
            }
          } catch {
          }
        }
      }
    };
    
    walkDir(fullDir);
  }
  
  return results;
}

export function validateBackground(value: string, theme: ThemeConfig): { valid: boolean; suggestion?: string } {
  if (!value || value === "") {
    return { valid: true };
  }
  
  const allowed = buildAllowedValues(theme);
  
  if (allowed.has(value)) {
    return { valid: true };
  }
  
  const cssValues = theme.backgrounds
    .filter(bg => bg.cssVar)
    .map(bg => `hsl(var(${bg.cssVar}))`);
  
  return {
    valid: false,
    suggestion: `Allowed values: ${cssValues.join(", ")}`,
  };
}

export const backgroundsValidator: Validator = {
  name: "backgrounds",
  issueCodes: BACKGROUNDS_ISSUE_CODES,
  description: "Validates background colors against theme.json definitions",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "content",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const theme = loadTheme();
    
    if (!theme) {
      warnings.push({
        type: "warning",
        code: "NO_THEME_CONFIG",
        message: "Theme configuration not found at 4geeks-com/theme.json",
        suggestion: "Create a theme.json file to define allowed background colors",
      });
      
      return {
        name: this.name,
        description: this.description,
        status: "warning",
        errors,
        warnings,
        duration: Date.now() - startTime,
      };
    }

    const allowed = buildAllowedValues(theme);
    const filesWithBackgrounds = scanAllContentFiles();
    
    let totalBackgrounds = 0;
    let invalidBackgrounds = 0;

    for (const { file, backgrounds } of filesWithBackgrounds) {
      for (const bg of backgrounds) {
        totalBackgrounds++;
        
        if (!allowed.has(bg.value)) {
          invalidBackgrounds++;
          const allowedList = Array.from(allowed)
            .filter(v => v !== "")
            .slice(0, 5)
            .join(", ");
          
          errors.push({
            type: "error",
            code: "INVALID_BACKGROUND",
            message: `Invalid background value: "${bg.value}" at ${bg.path}`,
            file,
            suggestion: `Use a theme-defined value. Examples: ${allowedList}`,
          });
        }
      }
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        totalBackgrounds,
        invalidBackgrounds,
        filesScanned: filesWithBackgrounds.length,
        allowedValues: Array.from(allowed).filter(v => v !== ""),
      },
    };
  },
};
