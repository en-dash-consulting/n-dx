---
id: "db911d92-d716-4fa1-b2b8-8823daa82095"
type: "capability"
title: "hench init must gitignore .hench/locks/ or the first autonomous run self-blocks"
slug: "hench-init-must-gitignore-hench-locks"
statement: "hench init adds hench's generated state paths to the project's .gitignore, so the first autonomous run on a newly initialised project does not count its own lock directory as uncommitted operator changes."
criteria: [{"id":"c1","text":"When hench init runs, hench shall write .gitignore entries for .hench/locks/, .hench/runs/, .hench/usage-cursors/ and .hench-commit-msg.txt."},{"id":"c2","text":"When `ndx work --auto` starts on a project just set up with `ndx init`, the pre-run gate shall not refuse the run because of the .hench/locks/ directory that hench creates at startup."}]
source: "Discovered while verifying the review pass end-to-end (task 0deece15)"
priority: "high"
---

On a freshly `ndx init`-ed project, `ndx work --auto` refuses to start with "Refusing to start an autonomous run with 1 uncommitted file(s), 0 line(s) changed in the working tree" — and the tree reads clean to anyone who checks afterwards, so the message looks unreproducible.

Cause: hench creates .hench/locks/ at startup (process/limiter.ts, LOCKS_DIR in process/lifecycle.ts:28). The pre-run gate counts files via `git status --porcelain` (listDirtyPaths, shared.ts:849) and lines via `git diff HEAD --numstat` (change-magnitude.ts:72) — so one untracked directory reads as "1 file, 0 lines". The lock is cleaned up on exit, which is why the tree is clean by the time the operator looks. Caught mid-run as `?? .hench/locks/`.

rex init writes .gitignore entries for its own generated files (rex/src/cli/commands/init.ts:74). hench init writes none, so .hench/locks/, .hench/runs/ and .hench/usage-cursors/ are all left untracked. This repo never sees it because n-dx's own .gitignore already lists .hench/locks/ at line 6.

Fix: have hench init write the same class of entries rex init does (.hench/locks/, .hench/runs/, .hench/usage-cursors/, .hench-commit-msg.txt). Consider also making the gate ignore hench's own state dir, since a lock the run itself created should never count as operator dirt.
