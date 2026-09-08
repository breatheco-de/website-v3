# Discuss edge cases

Any edge cases worth discussing? Enumerate problems with each having: problem/situation, options, and your recommendation. All of it in plain English and elaborated to avoid confusions.

## How to answer

Write for a smart non-expert — prefer staff words (live, draft, publish, empty, fail, overwrite) over schema keys, file paths, and internal names unless the choice *is* about those.

### Required numbering (always)

- **Edge cases** must be numbered **1, 2, 3, …** in order (never unnumbered bullets or lettered cases).
- **Options** under each case must be lettered **a, b, c** (lowercase). Use exactly those letters — not “Option A”, not bullets alone, not 1/2/3 for options.
- **Recommendation** stays a short paragraph after the options (not a fourth lettered choice).

Example shape for each case:

```
1. **What if there is no draft yet?**

Problem / situation — …

- **a — Block the save:** … What happens: … What does not change: …
- **b — Last write wins:** …
- **c — Save as draft only:** …

**Recommendation:** b — …
```

For each non-obvious gap (failure modes, empty states, locales, permissions, dual write paths, migrations, rollback, staff vs public, MCP vs UI), include:

1. **Title** — short, human label (e.g. “What if there is no draft yet?”), not a code identifier. Prefixed with the case number as above.
2. **Problem / situation** — 2–4 sentences in plain English:
   - What situation can happen (or what we have not decided)
   - Who it affects (staff, public visitors, agents, both)
   - What goes wrong or stays ambiguous if we leave it unspecified
   - Do **not** open with file paths, API names, or merge rules; those belong in options or a short technical note only when needed to choose
3. **Options** — 2–3 concrete choices labeled **a**, **b**, **c**. For each: what the user/system does, and what happens as a result (including what does *not* change). Translate code knobs into human outcomes first.
4. **Recommendation** — pick one letter (**a** / **b** / **c**) and explain why in plain cause/effect. One short paragraph max.

Then ask me to choose, reject, or add an option (e.g. “1b, 2a, 3c”). Wait for my reply before treating related decisions as locked.

### How I reply (parse these)

- **`1a` / `2b` / `3c`** — pick that lettered option for that case.
- **`1 fr`** (or `2 fr`, `3 fr`, …) — **follow recommendation** for that case number (accept the recommended letter as-is).
- Combine freely: e.g. `1 fr, 2b, 3 fr`.
- If I reject or propose a new option, record that instead of assuming the recommendation.

## Scope

Skip trivia. Do not invent fake edge cases for typo/CSS/dependency work. Prefer a few high-leverage cases over a long laundry list.
