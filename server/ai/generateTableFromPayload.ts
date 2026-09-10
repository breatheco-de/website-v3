import { getLLMService } from "./LLMService";
import { decodeUtf8Base64, encodeUtf8Base64 } from "@shared/functionEncoding";

export interface TableColumnConfig {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "image" | "link" | "boolean";
  function?: string;
}

export interface TableConfig {
  columns: TableColumnConfig[];
  title?: string;
  description?: string;
}

export interface GenerateTableInput {
  sampleData: Record<string, unknown>[];
  availableKeys: string[];
  userPrompt: string;
  locale?: string;
}

export interface RefineTableInput {
  currentConfig: TableConfig;
  sampleData: Record<string, unknown>[];
  availableKeys: string[];
  userFeedback: string;
  locale?: string;
}

const SYSTEM_PROMPT = `You are a data table configuration assistant. Given a sample of data items and a user's description of what columns they want, produce a JSON configuration for a data table.

Rules:
- Available keys use dot notation for nested fields (e.g. "academy.name", "syllabus_version.duration_in_days").
- Map the user's natural language descriptions to the correct data keys by examining the sample data values.
- Infer the best column type based on the sample values: "text" for strings, "number" for numeric values, "date" for ISO date strings, "image" for URLs ending in image extensions, "link" for other URLs, "boolean" for true/false values.
- Use the user's desired labels for column headers. If the user doesn't specify labels, generate clean human-readable labels from the key names.
- Preserve the order the user specifies.
- If the user says something vague like "show all columns", include the most meaningful top-level and nested keys (skip internal IDs, slugs, and redundant fields).
- FUNCTION SUPPORT: Every column MUST have a "function" property. This is a JavaScript arrow function string that receives the entire row object and returns the display value.
  - The function signature is always: (row) => { ... }
  - For simple field access: (row) => row.field_name
  - For nested fields: (row) => row.academy?.name || ""
  - For combining fields: (row) => (row.kickoff_date || "") + " - " + (row.ending_date || "")
  - For formatting: (row) => row.duration_in_days + " days (" + row.duration_in_hours + "h)"
  - For computed values: (row) => row.price ? "$" + Number(row.price).toFixed(2) : "-"
  - For dates: (row) => row.created_at ? new Date(row.created_at).toLocaleDateString() : "-"
  - For conditionals: (row) => row.status === "active" ? "Active" : "Inactive"
  - Always handle null/undefined gracefully with optional chaining (?.) or fallback values (|| "").
  - The function must be a valid JavaScript arrow function as a plain string. Do NOT wrap it in quotes inside the JSON string value.
- The "key" field should reference the primary data field the column is based on (used for sorting).
- Include a "description" field with a brief, conversational summary of what you created. Mention the table purpose, highlight any special formatting or computed columns, and note anything interesting. Keep it to 1-2 sentences. Do NOT just list column names mechanically.
- Return ONLY valid JSON with this exact structure:
{
  "columns": [
    { "key": "field.path", "label": "Display Label", "type": "text|number|date|image|link|boolean", "function": "(row) => row.field || \\"\\""  }
  ],
  "title": "Optional Table Title",
  "description": "Brief natural summary of the table created"
}
Do not include any text outside the JSON object.`;

function encodeColumnsToBase64(config: TableConfig): TableConfig {
  return {
    ...config,
    columns: config.columns.map(col => ({
      ...col,
      function: col.function ? encodeUtf8Base64(col.function) : undefined,
    })),
  };
}

function decodeColumnsFromBase64(config: TableConfig): TableConfig {
  return {
    ...config,
    columns: config.columns.map(col => ({
      ...col,
      function: col.function ? decodeUtf8Base64(col.function) : undefined,
    })),
  };
}

function generateDefaultFunction(key: string): string {
  const parts = key.split(".");
  if (parts.length === 1) {
    return `(row) => row.${key} != null ? String(row.${key}) : ""`;
  }
  const chain = parts.join("?.");
  return `(row) => row.${chain} != null ? String(row.${chain}) : ""`;
}

function ensureColumnFunctions(config: TableConfig): TableConfig {
  return {
    ...config,
    columns: config.columns.map(col => ({
      ...col,
      function: col.function || generateDefaultFunction(col.key),
    })),
  };
}

function parseTableConfigResponse(content: string): TableConfig {
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  const parsed = JSON.parse(cleaned) as TableConfig;

  if (!parsed.columns || !Array.isArray(parsed.columns) || parsed.columns.length === 0) {
    throw new Error("AI returned invalid table config: missing columns array");
  }

  for (const col of parsed.columns) {
    if (!col.key || !col.label || !col.type) {
      throw new Error(`Invalid column config: ${JSON.stringify(col)}`);
    }
  }

  return ensureColumnFunctions(parsed);
}

export interface AnalyzeDataInput {
  sampleData: Record<string, unknown>[];
  availableKeys: string[];
  locale?: string;
}

export interface DataAnalysis {
  description: string;
  suggestedPrompts: string[];
}

const ANALYZE_SYSTEM_PROMPT = `You are a data analyst assistant. Given a sample of data items and their available keys, provide:
1. A short, friendly description of what this data appears to be about (1-2 sentences max).
2. 3-4 suggested prompts the user could use to create a useful table from this data.

Rules:
- The description should be conversational and helpful, e.g. "This data contains a list of coding bootcamp cohorts with details like schedule, location, and language."
- Suggested prompts should be practical and varied - some simple, some more advanced.
- Each prompt should be a natural language instruction like "Show me a table with the name, start date, and location" or "Create a summary with course name and duration in days".
- Return ONLY valid JSON with this exact structure:
{
  "description": "Your friendly description here",
  "suggestedPrompts": ["prompt 1", "prompt 2", "prompt 3", "prompt 4"]
}
Do not include any text outside the JSON object.`;

export async function analyzeDataPayload(input: AnalyzeDataInput): Promise<DataAnalysis> {
  const llm = getLLMService();

  const samplePreview = JSON.stringify(input.sampleData.slice(0, 3), null, 2);
  const userPrompt = `Available data keys: ${JSON.stringify(input.availableKeys)}

Sample data (first 3 items):
${samplePreview}

Analyze this data and provide a friendly description and suggested prompts. Always respond in English.`;

  const result = await llm.adaptContent(
    ANALYZE_SYSTEM_PROMPT,
    userPrompt,
    {
      temperature: 0.4,
      maxTokens: 600,
    }
  );

  let cleaned = result.content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  const parsed = JSON.parse(cleaned) as DataAnalysis;
  if (!parsed.description || !parsed.suggestedPrompts || !Array.isArray(parsed.suggestedPrompts)) {
    throw new Error("AI returned invalid analysis format");
  }

  return parsed;
}

export async function generateTableFromPayload(input: GenerateTableInput): Promise<TableConfig> {
  const llm = getLLMService();

  const samplePreview = JSON.stringify(input.sampleData.slice(0, 3), null, 2);
  const langNote = input.locale === "es"
    ? "\nIMPORTANT: The page is in Spanish. Use Spanish for all column labels and the title."
    : "\nIMPORTANT: The page is in English. Use English for all column labels and the title.";

  const userPrompt = `Available data keys: ${JSON.stringify(input.availableKeys)}

Sample data (first 3 items):
${samplePreview}

User's request: "${input.userPrompt}"
${langNote}

Generate the table column configuration as JSON based on the user's request. Every column MUST include a "function" property with a JavaScript arrow function string. Pay close attention to any formatting instructions the user provides.`;

  const result = await llm.adaptContent(
    SYSTEM_PROMPT,
    userPrompt,
    {
      temperature: 0.3,
      maxTokens: 1500,
    }
  );

  const config = parseTableConfigResponse(result.content);
  return encodeColumnsToBase64(config);
}

const REFINE_SYSTEM_PROMPT = `You are a data table configuration assistant. The user has an existing table configuration and wants to make changes to it. Apply their requested changes and return the updated configuration.

Rules:
- Start from the current configuration provided and modify it according to the user's feedback.
- Available keys use dot notation for nested fields (e.g. "academy.name", "syllabus_version.duration_in_days").
- Every column MUST have a "function" property. This is a JavaScript arrow function string that receives the entire row object and returns the display value.
  - For simple field access: (row) => row.field_name
  - For nested fields: (row) => row.academy?.name || ""
  - For combining fields: (row) => (row.kickoff_date || "") + " - " + (row.ending_date || "")
  - For computed values: (row) => row.price ? "$" + Number(row.price).toFixed(2) : "-"
  - Always handle null/undefined gracefully.
- The "key" field references the primary data field (used for sorting).
- Include a "description" field with a brief, conversational summary of what changed. Describe the specific modifications you made in response to the user's feedback. Keep it to 1-2 sentences. Do NOT just list column names mechanically.
- Return ONLY valid JSON with this exact structure:
{
  "columns": [
    { "key": "field.path", "label": "Display Label", "type": "text|number|date|image|link|boolean", "function": "(row) => row.field || \\"\\""  }
  ],
  "title": "Optional Table Title",
  "description": "Brief natural summary of what was changed"
}
Do not include any text outside the JSON object.`;

export interface SessionContext {
  region?: string;
  country_code?: string;
  city?: string;
  language?: string;
  timezone?: string;
}

export interface GenerateFilterInput {
  sampleData: Record<string, unknown>[];
  availableKeys: string[];
  userPrompt: string;
  currentFilter?: string;
  locale?: string;
  sessionContext?: SessionContext;
}

export interface FilterResult {
  function: string;
  description: string;
}

const FILTER_SYSTEM_PROMPT = `You are a data filtering assistant. Given sample data items and a user's description, produce a JavaScript arrow function that filters an array of data rows.

Rules:
- The function receives TWO arguments: the full array of rows and a session context object.
- Signature: (rows, ctx) => rows.filter(row => ...)
- The ctx (session context) object has these fields from the visitor's browser session:
  - ctx.region: visitor's detected region, one of "usa-canada", "latam", "europe", or "online"
  - ctx.country_code: visitor's country code in lowercase (e.g. "us", "mx", "es", "co")
  - ctx.city: visitor's city name (e.g. "Miami", "Madrid", "Mexico City")
  - ctx.language: page language, "en" or "es"
  - ctx.timezone: visitor's timezone (e.g. "America/New_York", "Europe/Madrid")
- When the user asks to filter "by region", "by visitor location", "for their region", etc., use the ctx parameter to create dynamic region-aware filters.
- Available data keys use dot notation for nested fields (e.g. "academy.name", "syllabus_version.status").
- Use optional chaining (?.) for nested access to prevent crashes on null/undefined.
- Always handle null/undefined values gracefully — if ctx fields are undefined, return all rows as fallback.
- The function should be a single arrow function expression.
- Common patterns:
  - Filter by field value: (rows, ctx) => rows.filter(row => row.status === "ACTIVE")
  - Filter by nested field: (rows, ctx) => rows.filter(row => row.academy?.country?.code === "US")
  - Filter by visitor region: (rows, ctx) => rows.filter(row => { if (!ctx.region) return true; if (ctx.region === "latam") return row.academy?.slug === "online"; if (ctx.region === "europe") return row.academy?.country?.code === "es"; return row.academy?.slug?.includes("usa") || row.academy?.slug === "online"; })
  - Filter by visitor country: (rows, ctx) => rows.filter(row => !ctx.country_code || row.academy?.country?.code === ctx.country_code)
  - Filter by date range: (rows, ctx) => rows.filter(row => row.kickoff_date && new Date(row.kickoff_date) > new Date())
  - Exclude specific values: (rows, ctx) => rows.filter(row => !["test", "demo"].includes(row.academy?.slug))
- Include a "description" field with a brief summary of what the filter does, in 1 sentence.
- Return ONLY valid JSON:
{
  "function": "(rows, ctx) => rows.filter(row => ...)",
  "description": "Brief description of the filter"
}
Do not include any text outside the JSON object.`;

export async function generateGlobalFilter(input: GenerateFilterInput): Promise<FilterResult> {
  const llm = getLLMService();

  const samplePreview = JSON.stringify(input.sampleData.slice(0, 3), null, 2);
  const langNote = input.locale === "es"
    ? "\nIMPORTANT: Respond in Spanish for the description."
    : "\nIMPORTANT: Respond in English for the description.";

  const currentFilterNote = input.currentFilter
    ? `\nCurrent filter function: ${decodeUtf8Base64(input.currentFilter)}\nModify or replace this filter based on the user's request.`
    : "";

  const sessionNote = input.sessionContext
    ? `\nCurrent visitor session context (ctx): ${JSON.stringify(input.sessionContext)}\nThe filter function receives this as the second argument "ctx". Use it when the user asks for region-based, location-based, or visitor-specific filtering.`
    : "";

  const userPrompt = `Available data keys: ${JSON.stringify(input.availableKeys)}

Sample data (first 3 items):
${samplePreview}
${currentFilterNote}
${sessionNote}

User's request: "${input.userPrompt}"
${langNote}

Generate a JavaScript arrow function that filters the data array according to the user's request. The function signature is (rows, ctx) => ... where ctx contains the visitor's session context.`;

  const result = await llm.adaptContent(
    FILTER_SYSTEM_PROMPT,
    userPrompt,
    {
      temperature: 0.3,
      maxTokens: 800,
    }
  );

  let cleaned = result.content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  const parsed = JSON.parse(cleaned) as FilterResult;
  if (!parsed.function || typeof parsed.function !== "string") {
    throw new Error("AI returned invalid filter: missing function");
  }

  return {
    function: Buffer.from(parsed.function).toString("base64"),
    description: parsed.description || "",
  };
}

export async function refineTableConfig(input: RefineTableInput): Promise<TableConfig> {
  const llm = getLLMService();

  const decodedConfig = decodeColumnsFromBase64(input.currentConfig);

  const samplePreview = JSON.stringify(input.sampleData.slice(0, 3), null, 2);
  const langNote = input.locale === "es"
    ? "\nIMPORTANT: The page is in Spanish. Use Spanish for all column labels and the title."
    : "\nIMPORTANT: The page is in English. Use English for all column labels and the title.";

  const userPrompt = `Current table configuration:
${JSON.stringify(decodedConfig, null, 2)}

Available data keys: ${JSON.stringify(input.availableKeys)}

Sample data (first 3 items):
${samplePreview}

User's requested changes: "${input.userFeedback}"
${langNote}

Apply the user's requested changes to the current configuration and return the updated JSON. Every column MUST include a "function" property with a JavaScript arrow function string.`;

  const result = await llm.adaptContent(
    REFINE_SYSTEM_PROMPT,
    userPrompt,
    {
      temperature: 0.3,
      maxTokens: 1500,
    }
  );

  const config = parseTableConfigResponse(result.content);
  return encodeColumnsToBase64(config);
}
