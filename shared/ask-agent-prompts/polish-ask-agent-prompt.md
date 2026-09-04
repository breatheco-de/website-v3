---
id: polish-ask-agent-prompt
version: 2
title: Polish an Ask Agent prompt
used_when: >
  Staff clicks Ask Agent (polish) on a Prompt Library card in AI Settings →
  Prompt Library.
intention: >
  Improve one Ask Agent markdown template in the app repo so it better matches
  its used_when / intention, stays lean (Goal/Target/Do/Tools/Don’t), and
  reduces failure_modes — without inventing a new prompt system.
success_looks_like: >
  Concrete edits to that one .md file (frontmatter and/or body); version bump if
  behavior changed; brief summary of what got sharper.
failure_modes:
  - Rewrites unrelated templates or app features
  - Makes the pasted body longer and vaguer
  - Removes required placeholders without updating frontmatter.required
  - Changes standing MCP bootstrap/conventions instead of this template
required:
  - target_id
  - target_title
  - target_path
  - target_used_when
  - target_intention
  - target_success
  - target_failure_modes
  - target_raw
  - max_chars
max_chars: 4500
sections:
  - Goal
  - Target
  - Do
  - Tools
  - Don’t
---

Goal: Polish one Ask Agent prompt template so staff paste clearer, more effective agent instructions.

Target:
- id: {{target_id}}
- title: {{target_title}}
- path: {{target_path}}
- max_chars budget for the body staff paste: {{max_chars}}

Review context (frontmatter — not pasted to end users):
- used_when: {{target_used_when}}
- intention: {{target_intention}}
- success_looks_like: {{target_success}}
- failure_modes:
{{target_failure_modes}}

Current template file (full markdown):
```markdown
{{target_raw}}
```

Do:
1. Judge the body against used_when, intention, success_looks_like, and failure_modes.
2. Edit only that file under shared/ask-agent-prompts/. Keep Goal / Target / Do / Tools / Don’t. Keep every placeholder listed in frontmatter.required (or update required if you intentionally change vars).
3. Prefer shorter, sharper instructions. Stay under max_chars for the rendered body when fixtures fill vars.
4. Bump frontmatter version if the prompt’s behavior changed. Summarize what you improved.

Tools: read/edit the markdown file in the app repo (this is not a CMS YAML content edit).

Don’t: change other templates unless required for consistency; rewrite MCP conventions/bootstrap; add walls of session boilerplate that belong in bootstrap_agent.
