/**
 * Component Registry Validator
 * 
 * Validates component registry integrity:
 * - Schema files exist and are valid
 * - Examples reference valid variants
 * - Version numbering is consistent
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { COMPONENTS_ISSUE_CODES } from "./components.issueCodes";

const REGISTRY_PATH = path.join(process.cwd(), "4geeks-com", "component-registry");

interface SchemaData {
  name?: string;
  version?: string;
  section_defaults?: Record<string, unknown>;
  variants?: Record<string, unknown>;
  props?: Record<string, unknown>;
}

interface ExampleData {
  name?: string;
  variant?: string;
  yaml?: string;
}

export const componentsValidator: Validator = {
  name: "components",
  issueCodes: COMPONENTS_ISSUE_CODES,
  description: "Validates component registry schemas and examples",
  apiExposed: true,
  estimatedDuration: "medium",
  category: "components",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    if (!fs.existsSync(REGISTRY_PATH)) {
      warnings.push({
        type: "warning",
        code: "NO_COMPONENT_REGISTRY",
        message: "Component registry directory not found",
        suggestion: "Create 4geeks-com/component-registry directory",
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

    const componentTypes = fs.readdirSync(REGISTRY_PATH).filter((dir) => {
      const dirPath = path.join(REGISTRY_PATH, dir);
      return fs.statSync(dirPath).isDirectory();
    });

    let totalComponents = 0;
    let totalVersions = 0;
    let totalExamples = 0;

    for (const componentType of componentTypes) {
      const componentPath = path.join(REGISTRY_PATH, componentType);
      const versions = fs.readdirSync(componentPath).filter((dir) => {
        const versionPath = path.join(componentPath, dir);
        return fs.statSync(versionPath).isDirectory() && dir.startsWith("v");
      });

      if (versions.length === 0) {
        warnings.push({
          type: "warning",
          code: "NO_VERSIONS",
          message: `Component "${componentType}" has no versions`,
          file: componentPath,
          suggestion: "Add at least one version (e.g., v1.0)",
        });
        continue;
      }

      totalComponents++;

      for (const version of versions) {
        totalVersions++;
        const versionPath = path.join(componentPath, version);
        const schemaPath = path.join(versionPath, "schema.yml");

        if (!fs.existsSync(schemaPath)) {
          errors.push({
            type: "error",
            code: "MISSING_SCHEMA",
            message: `Missing schema.yml for ${componentType}/${version}`,
            file: versionPath,
            suggestion: "Create a schema.yml file defining the component's props",
          });
          continue;
        }

        let schemaData: SchemaData;
        try {
          const content = fs.readFileSync(schemaPath, "utf-8");
          schemaData = yaml.load(content) as SchemaData;
        } catch (err) {
          errors.push({
            type: "error",
            code: "INVALID_SCHEMA_YAML",
            message: `Invalid YAML in schema: ${err}`,
            file: schemaPath,
          });
          continue;
        }

        if (!schemaData.name) {
          warnings.push({
            type: "warning",
            code: "MISSING_SCHEMA_NAME",
            message: "Schema missing 'name' property",
            file: schemaPath,
          });
        }

        if (schemaData.section_defaults !== undefined) {
          if (typeof schemaData.section_defaults !== "object" || Array.isArray(schemaData.section_defaults)) {
            errors.push({
              type: "error",
              code: "INVALID_SECTION_DEFAULTS",
              message: `section_defaults must be an object in ${componentType}/${version}`,
              file: schemaPath,
              suggestion: "section_defaults should be a key-value map, e.g. section_defaults: { load: eager }",
            });
          } else {
            const loadValue = schemaData.section_defaults.load;
            if (loadValue !== undefined && loadValue !== "eager" && loadValue !== "lazy") {
              errors.push({
                type: "error",
                code: "INVALID_SECTION_DEFAULT",
                message: `Invalid section_defaults.load value "${loadValue}" in ${componentType}/${version}. Must be "eager" or "lazy"`,
                file: schemaPath,
                suggestion: 'Set section_defaults.load to "eager" or "lazy", or remove it to use the default position-based strategy',
              });
            }
          }
        }

        const examplesPath = path.join(versionPath, "examples");
        if (!fs.existsSync(examplesPath)) {
          warnings.push({
            type: "warning",
            code: "NO_EXAMPLES",
            message: `No examples directory for ${componentType}/${version}`,
            file: versionPath,
            suggestion: "Add example files to help users understand component usage",
          });
          continue;
        }

        const exampleFiles = fs.readdirSync(examplesPath).filter(
          (f) => f.endsWith(".yml") || f.endsWith(".yaml")
        );

        if (exampleFiles.length === 0) {
          warnings.push({
            type: "warning",
            code: "EMPTY_EXAMPLES",
            message: `Examples directory is empty for ${componentType}/${version}`,
            file: examplesPath,
          });
        }

        for (const exampleFile of exampleFiles) {
          totalExamples++;
          const examplePath = path.join(examplesPath, exampleFile);

          try {
            const content = fs.readFileSync(examplePath, "utf-8");
            const exampleData = yaml.load(content) as ExampleData;

            if (!exampleData.name) {
              warnings.push({
                type: "warning",
                code: "MISSING_EXAMPLE_NAME",
                message: "Example missing 'name' property",
                file: examplePath,
              });
            }

            if (schemaData.variants && exampleData.variant) {
              if (!Object.keys(schemaData.variants).includes(exampleData.variant)) {
                errors.push({
                  type: "error",
                  code: "INVALID_EXAMPLE_VARIANT",
                  message: `Example references unknown variant: "${exampleData.variant}"`,
                  file: examplePath,
                  suggestion: `Valid variants: ${Object.keys(schemaData.variants).join(", ")}`,
                });
              }
            }
          } catch (err) {
            errors.push({
              type: "error",
              code: "INVALID_EXAMPLE_YAML",
              message: `Invalid YAML in example: ${err}`,
              file: examplePath,
            });
          }
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
        totalComponents,
        totalVersions,
        totalExamples,
      },
    };
  },
};
