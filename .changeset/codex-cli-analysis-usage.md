---
"@n-dx/llm-client": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

`n-dx plan` and analysis report Codex CLI token usage, including cached input and measured spend from retries.

Structured accounting preserves the exact final response text. Missing or malformed usage is distinguished from measured zero. Sourcevision cache tokens reach CLI and dashboard rollups, and failed completions retain measured spend.
