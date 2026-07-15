---
"@n-dx/hench": patch
---

Deliver the Codex agent prompt via stdin instead of as a positional argv argument. The Codex CLI adapter previously passed the entire `SYSTEM:`/`TASK:` prompt (bounded at 400 KB) as the last `codex exec` argument, which exceeds the OS `ARG_MAX` for a single argv element and crashed real task briefs with `E2BIG` — a primary reason Codex runs were unusable. The adapter now appends `-` and writes the prompt to stdin, matching the Claude adapter and the `@n-dx/llm-client` Codex provider.
