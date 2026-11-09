---
"@n-dx/web": patch
---

The Sidecar transcript reads a tool call's Failed or Done state from the result's error flag. A failed Codex command now reads Failed, and a successful call whose output starts with `[error] ` reads Done. Older transcripts without the flag still fall back to the `[error] ` prefix.
