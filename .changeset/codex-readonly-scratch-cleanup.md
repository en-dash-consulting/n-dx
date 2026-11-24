---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

`n-dx work` cleans populated read-only Codex temporary directories without replacing successful results, failures or cancellations with cleanup errors.

Cleanup repairs permissions only on owned directories, leaves symlink targets untouched and reports an actionable warning if removal cannot finish.
