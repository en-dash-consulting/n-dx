---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Stop an autonomous run that repeats the same tool call, and report its real counters while it runs (GH #362)

A run could spend eighty minutes and sixteen million cache-read tokens repeating one cycle — relaunch the test suite, sleep, block on a background task whose process had died, re-read the same unchanged diff — and nothing caught it. `lastActivityAt` advances on every tool call and polling is a tool call, so the heartbeat monitor saw maximal activity, while the run record still said 0 turns and 0 tokens, so the dashboard drew it as idle.

Both halves are fixed:

- **Livelock detection.** Identical tool calls — same name, same arguments, and the same result where the provider exposes one — counted inside a sliding window, with any file-mutating call clearing the count. Six repeats with nothing written in between stops the run and names the repeated call. A fix loop that edits between two identical test runs is unaffected. Tunable via `hench.livelockThreshold` (0 disables).
- **Truthful heartbeats.** The CLI loop's in-flight turn and token counters are now folded onto the run record on every heartbeat, so a running task is no longer reported as 0/0.
