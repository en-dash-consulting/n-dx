---
"@n-dx/core": patch
---

`ndx move <id> [dir]` acts on the directory it names

`handleMove` checked `process.cwd()` for `.rex` and then forwarded its
arguments unchanged, so the trailing `[dir]` its own help documents was never
used for the precondition. Run from anywhere that is not itself a project, the
command refused with `NDX_CLI_NOT_INITIALIZED` naming the current directory
even though the argument named a real one — the same defect fixed for
`ndx log`, which the log fix recorded as still open here.

Both handlers now share one `resolveTrailingDir` helper, which takes the
second positional rather than the last: with no directory given the last
positional is the item id or the event name, so `ndx move abc --parent=def`
would otherwise look for a project at `./abc`. Delegation to `rex` is
unchanged — its `move` and `log` cases already read the same shape.
