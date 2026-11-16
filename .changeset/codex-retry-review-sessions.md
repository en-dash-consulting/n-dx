---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

`n-dx work` reuses eligible Codex work sessions for transient retries and self-review while preserving prior attempt context.

Reuse requires a supported selected CLI and matching checkout, model, execution policy and credential identity. Failed retry continuations stop without replaying the work; unsupported or changed identities use a fresh context with the existing retry notice. Review with a different model starts fresh. Batch continuation and pair repair retain their existing behavior.
