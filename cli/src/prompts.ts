import * as p from "@clack/prompts";

export function canPrompt(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

class PromptCancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "PromptCancelled";
  }
}

function handleCancel(value: unknown): asserts value is Exclude<typeof value, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    throw new PromptCancelled();
  }
}

export async function askYesNo(question: string, defaultYes = false): Promise<boolean> {
  if (!canPrompt()) {
    throw new Error(`Non-interactive terminal: missing answer for: ${question}`);
  }
  const value = await p.confirm({
    message: question,
    initialValue: defaultYes,
  });
  handleCancel(value);
  return Boolean(value);
}

export async function askText(question: string, fallback?: string): Promise<string> {
  if (!canPrompt()) {
    throw new Error(`Non-interactive terminal: missing answer for: ${question}`);
  }
  const value = await p.text({
    message: question,
    placeholder: fallback,
    defaultValue: fallback,
  });
  handleCancel(value);
  const trimmed = String(value).trim();
  return trimmed || fallback || "";
}

export async function askAgentChoice(): Promise<"local" | "cloud"> {
  if (!canPrompt()) {
    throw new Error("Non-interactive terminal: missing --agent local|cloud");
  }
  const value = await p.select({
    message: "Which agent will help?",
    options: [
      {
        value: "local",
        label: "Local",
        hint: "Cursor / Claude Code — localhost + connection token",
      },
      {
        value: "cloud",
        label: "Cloud",
        hint: "Claude.ai / ChatGPT — public connector URL",
      },
    ],
    initialValue: "local",
  });
  handleCancel(value);
  return value === "cloud" ? "cloud" : "local";
}

export { PromptCancelled };
