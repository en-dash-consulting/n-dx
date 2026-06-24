---
"@n-dx/llm-client": patch
---

Fix Codex CLI provider on Windows: pass prompt via stdin instead of argv. On Windows, `shell: true` routes through cmd.exe which splits unquoted multi-word arguments on spaces, causing Codex to receive a fragmented prompt. Passing `-` as the prompt argument and writing to `proc.stdin` bypasses cmd.exe argument parsing.
