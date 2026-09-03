# Ask Agent prompts

Markdown templates for staff **Ask Agent / Solve with AI** clipboard prompts.

## Layout

Each `*.md` file:

1. YAML frontmatter (review metadata — **not** copied to the agent)
2. Body with `{{var}}` placeholders (this is what staff paste)

## Frontmatter (for humans and review AIs)

| Field | Purpose |
|-------|---------|
| `used_when` | UI trigger |
| `intention` | Desired outcome |
| `success_looks_like` | Acceptance for a good run |
| `failure_modes` | Anti-goals the body should block |
| `required` | Placeholder names |
| `max_chars` | Soft length budget (enforced in vitest) |
| `sections` | Headers that must appear in the body |

When reviewing quality, check: does the body match `used_when` / `intention`? Would following it achieve `success_looks_like`? Does it prevent `failure_modes`?

## Rendering

```ts
import { renderAskAgentPrompt } from "@shared/ask-agent-prompts";

renderAskAgentPrompt("organic-page2", {
  query: "…",
  url: "…",
  // …
});
```

Register templates first (`setAskAgentPromptSource` + `loadAllAskAgentPromptsFromDisk` from `@shared/ask-agent-prompts/load` in tests/Node, or Vite `?raw` bootstrap in the client). The package barrel is browser-safe; disk I/O is not re-exported from the index.

Standing MCP session conventions live in `mcp-server/agent-conventions.md` / `bootstrap_agent` — keep organic bodies lean.
