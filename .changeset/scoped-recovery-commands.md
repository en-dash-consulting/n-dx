---
"@n-dx/hench": patch
---

Refusals suggest only validated, path-scoped git commands

The uncommitted-work refusal, the loop refusal, and the `--reset-deferred`
skip message told the operator to "commit these paths" without saying how —
and any broad command they might reach for (`git add -A`, an unscoped
`git commit` or `git stash`) is exactly how an unrelated in-flight change
gets swept into a hench commit. Each message now prints commands scoped with
`--` to precisely the listed paths: `git add` for the paths still on disk,
`git rm --cached` for ones that were deleted (checked at print time), a
scoped `git commit`, and a scoped `git stash push` as the set-aside
alternative. The commands carry every path even where the displayed list
truncates. When `autoCommit` is off, the agent prompt's staging instruction is scoped the same way —
name each changed path, never stage the whole tree — and a policy test keeps
`git add -A` / `git add .` out of hench's code for good.
