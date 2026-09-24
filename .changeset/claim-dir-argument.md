---
"@n-dx/core": patch
---

`ndx claim` accepts its directory argument from outside the project

`ndx claim list <dir>` and `ndx claim release <id> <dir>` checked for an
initialized project in the *current* directory before forwarding to rex, so
running them from outside the project — exactly what the completion-refusal
hint suggests — failed the init check even though rex resolves the directory
argument itself. The check now looks at the same directory rex will act on,
mirroring rex's own subcommand-aware slicing (`list [dir]` and
`release --all [dir]` take it second, `release <taskId> [dir]` third). A bare
`ndx claim list` in an uninitialized directory still refuses as before.
