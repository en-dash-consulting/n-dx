---
"@n-dx/llm-client": patch
"@n-dx/sourcevision": patch
"@n-dx/rex": patch
---

Jev reads its TypeSafe key from the per-user credential store when `TYPESAFE_API_KEY` is not exported, so MCP servers inside a hench run, the hub and a fresh shell find it without the key reaching any child process environment. `resolveJudgmentRoute` now takes `{ env, ndxHome }` options; the new `configuredJudgmentRoute` reports the route config asks for without a key.
