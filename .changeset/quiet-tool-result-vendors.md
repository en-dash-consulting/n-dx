---
"@n-dx/llm-client": patch
"@n-dx/web": patch
"@n-dx/hench": patch
---

The `Sidecar` transcript (experimental, off by default; enable with `web.sidecar`) preserves tool-result vendor semantics when output begins with `[error]`.

Canonical Claude successes without an error flag remain successful. Unflagged Codex output retains unknown status and is not marked failed from its text alone. Archived Claude results keep their prefix fallback, and explicit error flags retain precedence.
