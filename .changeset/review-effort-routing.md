---
"@n-dx/core": patch
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

`n-dx config` explains that `agent.review` controls effort only, and Settings shows the actual reviewer separately from model tiers.

Choose the reviewer with `llm.<vendor>.reviewModel` or a task's saved `reviewTier` or `reviewModels`. Existing model precedence and effort rules remain unchanged; an `llm.routes.agent.review` entry has no effect and no longer appears as an active route override.
