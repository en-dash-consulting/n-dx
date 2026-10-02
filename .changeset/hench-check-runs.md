---
"@n-dx/hench": patch
---

Add `hench check-runs` (also `ndx hench check-runs`) to audit runs recorded as running across every worktree of the repository, grouped by worktree with each run's verdict and reason. `--fix` ends orphaned runs (and unknown ones with `--include-unknown`) using the same status and error prefix as the dashboard's reconcile route; `--strict` exits 1 when any running record is not live; `--worktree=<path>` narrows to one worktree; `--format=json` is for scripts.
