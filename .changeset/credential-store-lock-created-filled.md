---
"@n-dx/llm-client": patch
---

Credential store: a live writer's lock is never taken over. The lock and the takeover guard are written to a temp file and hard-linked into place, so neither is ever seen empty, and a writer paused mid-create (sleep, SIGSTOP, swap) or a lagging clock on a network ndx home no longer costs a credential update. The guard records its holder's PID and is reclaimed only when that process is dead, never by age. The 5 s rule now applies only to an empty lock an older version left.
