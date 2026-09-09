---
"@n-dx/hench": patch
---

Stop the pre-run gate blocking on hench's own lock when the project is not the
repository root.

`git status --porcelain` reports paths relative to the repository root, not to
the directory it was invoked from. A run in `sub/` therefore sees
`?? sub/.hench/locks/run.lock`, which does not start with `.hench/locks/`, so
the runtime-artifact exclusion missed it and an autonomous run refused to start
on a file hench had created moments earlier — then removed on exit, leaving
"1 uncommitted file(s), 0 line(s) changed" against a tree that read clean by the
time anyone looked. That is the bug the exclusion was added to fix; it simply
never applied outside the repo root, which is where every test had put the
project.

`excludeHenchRuntimeArtifacts` now takes the project directory and resolves the
project's position within the repo, applying that prefix to the patterns rather
than stripping it from each line. A sibling project's `other/.hench/runs/` stays
outside the match, since that is somebody else's uncommitted work. The parameter
is required, so both call sites — the pre-run gate and the rollback check — are
checked by the compiler rather than by review.

Both paths are canonicalised before being subtracted. `git rev-parse` resolves
symlinks and a project directory generally has not, so on macOS a path under
`/var` or `/tmp` returns as `/private/var/...` — and a symlinked home or
checkout does the same on any platform. Comparing the raw strings produced a
`..` relative path that fell back to the old root-relative behaviour, i.e. the
same bug, on developer machines only. This was caught by the new tests rather
than reasoned about.

Outside a repository, or with git unavailable, the prefix is empty and behaviour
is unchanged.
