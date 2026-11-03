---
"@n-dx/web": patch
---

The hub session keeps its ledger in `<ndx home>/hub/ledger.jsonl` (new `decision-needed` type) and carries it on every turn, so its notes survive checkpoints, restarts and a new hub session. "Open in worktree sidecar" on a snapshot worktree hands the hub's latest question to that worktree's session as a `handoff` ledger entry and opens its drawer, and the snapshot shows each worktree session's latest unfinished and decision notes.
