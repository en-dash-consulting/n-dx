---
"@n-dx/core": patch
---

`AGENTS.md` now tells Codex and other assistants that a task can carry saved run settings.

The Rex guidance that `ndx init` writes into your project lists a new bullet: `add_item` and `edit_item` accept a `run` block (model, provider, review, permission mode, test gate, turn and token budgets, notes for the agent). An object replaces the whole block and `null` removes it. Re-run `ndx init` to refresh an existing `AGENTS.md`.
