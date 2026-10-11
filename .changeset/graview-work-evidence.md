---
"@n-dx/rex": patch
"@n-dx/graview": patch
"@n-dx/hench": patch
---

The v1-to-v2 migration plan marks a capability or constraint `met` when its v1 item completed, and the plan's data stage stamps `metAt` with the drafted spec's hash, as `appliedAt` already stamps a completed change: without it every migrated capability read proposed forever. `specHash` and `nodeSpec` join rex's public API. The Graview projection's proposed product layer stamps the same, so a completed feature's capability reads met, one with an open amending change reads changing, and the capability declaration drops its `metAt` datetime (rex's `metAt` is a spec hash, said through `intentStatus`).

A run record's commits carry how each was tied to the run (`attribution`: `start-head` on the live path), and `hench backfill-commits [dir]` fills `commits` on every record written without `startHead`, from the main branch's history: a subject naming the run id, then an `N-DX-Item` trailer naming the run's task, then the run's time window when no other run's holds the commit (the window proper before the `--pad`, and never a window longer than `--max-window`, so a run an audit ended weeks later claims nothing). Merge and `chore(prd)` commits are never attributed; a record that has commits is left alone, so the command is idempotent; `--dry-run` reports without writing. On n-dx's own history it ties 638 commits to 569 of 673 runs.
