---
"@n-dx/llm-client": patch
---

Windows credential store writers no longer fail when another process is removing the lock: a lock file being deleted now counts as a held lock, and the writer retries within its wait budget.
