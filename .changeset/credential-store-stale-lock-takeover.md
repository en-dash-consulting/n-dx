---
"@n-dx/llm-client": patch
---

Credential store: taking over a dead writer's lock no longer lets two writers in at once. Concurrent writers could drop an entry. Writers that judge the same lock stale now contend for one guard file, and the winner removes the lock only when it has not changed. An empty lock left by a writer killed mid-create is taken over after 5 s, instead of every later write timing out.
