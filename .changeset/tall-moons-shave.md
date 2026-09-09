---
"@n-dx/sourcevision": patch
---

Fix `analyze` promoting git worktree checkouts as sub-analyses.

Sub-analysis discovery walked into `.claude/worktrees/<name>/` and other in-repo
worktrees. Each is a full checkout carrying its own `.sourcevision/`, so every
live worktree injected a duplicate copy of the parent's zones — one observed run
returned 120 zones, 87 of them duplicates.

`findSubSvDirs()` now skips `.claude`, and additionally skips any directory that
`git worktree list --porcelain` reports as a registered worktree nested inside
the analysis root. Worktree resolution is best-effort: if git is unavailable or
the directory is not a repository, the scan behaves exactly as before. The root
itself is never skipped, so analyzing a project that is itself a worktree still
works.
