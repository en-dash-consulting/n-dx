---
"@n-dx/core": patch
"@n-dx/rex": patch
---

Close the rex log follow-ups: `[dir]`, `--item`, `--format=json`, rotation race

`ndx log <event> <dir>` refused when the current directory was not a project,
although the help documents the trailing `[dir]` and `rex log` has always read
it. The orchestrator checked `process.cwd()` for `.rex` before delegating, so
the documented form failed exactly where it was needed — a run from outside
the project. It now resolves the directory from the second positional, which
is where `rex log` reads it too.

`ndx log --help` lists `--format=json`, which the command already forwarded.

The workflow step and the `ndx-work` skill now show
`ndx log <event> --item=<task-id> --detail="..."`; without `--item` an entry
written through the CLI route is not tied to the task.

Execution-log rotation took a stat and then a rename with nothing in between.
Every `rex log` / `ndx log` call is its own short-lived process, so two that
both saw an over-size log would both rename it: the first moved a megabyte of
history to `.1` and appended, then the second's rename overwrote that `.1`
with the single line the first had just written. The size is now re-read under
a lock, so the second writer sees the rotated file and does nothing. Appends
stay outside the lock, and a lock that cannot be taken appends without
rotating rather than failing.
