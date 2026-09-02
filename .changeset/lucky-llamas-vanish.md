---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

Fix Codex provider spawning codex exec --full-auto, which the Codex CLI removed entirely. compileCodexPolicyFlags now emits --sandbox workspace-write for the default execution policy instead of the removed flag.
  