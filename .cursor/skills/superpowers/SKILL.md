---
name: superpowers
description: Enforces high-quality agent behavior—planning, targeted codebase reads, verification loops, and minimal diffs. Use when implementing features, fixing bugs, refactoring, or when the user wants thorough, reliable changes rather than quick guesses.
---

# Superpowers (agent discipline)

## When to apply

Use this skill for any non-trivial coding task: multiple files, unclear behavior, production paths, or when mistakes would be costly. Skip for one-line typo fixes the user already pointed to.

## Planning

- State the goal in one sentence, then list assumptions and unknowns.
- If the change touches more than one module or behavior, outline steps **before** editing.
- Prefer one coherent approach over parallel experiments unless the user asks to compare options.

## Read before write

- **Locate first**: search the repo (semantic or exact) for symbols, routes, and similar patterns; do not invent file paths or APIs.
- **Read enough context**: open the files that own the behavior (definitions, callers, tests) before changing code.
- **Match local style**: imports, naming, error handling, and comment density should match surrounding code.

## Verification loops

After substantive edits:

1. Run the project’s usual checks (tests, lint, typecheck—whatever this repo uses) when available.
2. If something fails, fix root cause; avoid silencing errors without understanding them.
3. For UI or API changes, sanity-check behavior against the user’s scenario when tests do not cover it.

If checks are slow or unavailable, state what was **not** run and what risk remains.

## Diff hygiene

- Change only what the task requires; no drive-by refactors, formatting sweeps, or unrelated file edits.
- Prefer extending existing helpers over duplicating logic.
- Keep commits and explanations aligned with the actual diff (no “also cleaned up X” unless requested).

## Communication

- Be explicit about trade-offs and edge cases that matter to the user’s goal.
- When uncertain, inspect the code or ask a **narrow** question instead of guessing.

## Quick checklist

```
- [ ] Goal and scope are clear
- [ ] Relevant files located and read
- [ ] Edits match project conventions
- [ ] Verification run or gaps stated
- [ ] Diff is minimal and on-task
```
