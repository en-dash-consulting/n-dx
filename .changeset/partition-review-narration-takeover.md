---
"@n-dx/sourcevision": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

A fragmented zone partition is no longer frozen. Before a previous partition is reused or used as the Louvain seed, sourcevision checks its health: one where at least 40% of zones hold two files or fewer is rebuilt from scratch, and in the borderline band Jev decides. The rebuild happens once per input fingerprint and needs no `sv reset`. Background narration no longer loses work: a new `analyze` stops a still-running narrator and queues what it had not finished. `ndx status` and the dashboard overview report pending or failed narration, and `ndx plan` waits for narration before `rex analyze`.
