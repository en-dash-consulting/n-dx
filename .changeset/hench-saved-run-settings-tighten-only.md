---
"@n-dx/hench": patch
---

A task's saved `run` block can only tighten a run: `permissionMode`, `skipTestGate`, `maxTurns`, `tokenBudget` and the review mode (`review`, `reviewMode`, ranked off < self < pair against `hench.review.mode`) are honoured when they are stricter than the operator's flags and config and ignored with a `saved-setting-widens` warning otherwise, so `ndx work --resolve` reports the key that really won. A saved `reviewOptional: true` relaxes only a review the task's own saved mode turned on, never one the operator configured. An absent or empty `guard.allowedGitSubcommands` grants the language baseline to the Claude CLI, never a blanket `Bash(git:*)`, and the policy fingerprint hashes it the same way. While a repository is not trusted, `applyRepoTrust` also drops `guard.env.allow` and reverts a tracked `claudePath` and `apiKeyEnv` unless `.n-dx.local.json` sets them.
