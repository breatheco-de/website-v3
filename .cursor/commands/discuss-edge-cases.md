# Discuss edge cases

Any edge cases worth discussing? Enumerate problems with each having: problem/situation, options, and your recommendation. All of it in plain English and elaborated to avoid confusions.

## How to answer

Write for a smart non-expert — prefer staff words (live, draft, publish, empty, fail, overwrite) over schema keys, file paths, and internal names unless the choice *is* about those.

For each non-obvious gap (failure modes, empty states, locales, permissions, dual write paths, migrations, rollback, staff vs public, MCP vs UI), use this shape:

1. **Title** — short, human label (e.g. “What if there is no draft yet?”), not a code identifier.
2. **Problem / situation** — 2–4 sentences in plain English:
   - What situation can happen (or what we have not decided)
   - Who it affects (staff, public visitors, agents, both)
   - What goes wrong or stays ambiguous if we leave it unspecified
   - Do **not** open with file paths, API names, or merge rules; those belong in options or a short technical note only when needed to choose
3. **Options** — 2–3 concrete choices. For each: what the user/system does, and what happens as a result (including what does *not* change). Translate code knobs into human outcomes first.
4. **Recommendation** — pick one and explain why in plain cause/effect. One short paragraph max.

Then ask me to choose, reject, or add an option. Wait for my reply before treating related decisions as locked.

## Scope

Skip trivia. Do not invent fake edge cases for typo/CSS/dependency work. Prefer a few high-leverage cases over a long laundry list.
