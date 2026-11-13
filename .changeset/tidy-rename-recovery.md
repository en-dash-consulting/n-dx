---
"@n-dx/hench": patch
---

`n-dx work` recovery messages retain both rename endpoints and explain when automatic recovery commands are unavailable.

Action needed: Inspect both endpoints with `git status --short` and recover each rename together before rerunning `n-dx work`.

Rename groups require manual recovery of both endpoints together, preserving unrelated staged and working-tree changes. Completion and loop refusals no longer suggest source-only deletion commits or partial removal and stash commands. Ordinary file recovery keeps its existing scoped commands and pathspec files.
