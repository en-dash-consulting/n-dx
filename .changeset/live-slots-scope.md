---
"@n-dx/web": patch
---

The Live strip's agent-slots tile now covers the same runs as the run list beside it. Standalone, it counts runs judged `live` in every worktree of the repository, terminal-started ones included, against hench's configured limit. Served through the hub, it shows the hub admission gate's sessions, `maxSessions`, and its queue when anything is waiting. The tile's label says which: "this repository" or "this machine".
