---
id: "db911d92-d716-4fa1-b2b8-8823daa82095"
level: "task"
title: "hench init must gitignore .hench/locks/ or the first autonomous run self-blocks"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "On a freshly `ndx init`-ed project, `ndx work --auto` refuses to start with \"Refusing to start an autonomous run with 1 uncommitted file(s), 0 line(s) changed in the working tree\" — and the tree reads clean to anyone who checks afterwards, so the message looks unreproducible.\n\nCause: hench creates .hench/locks/ at startup (process/limiter.ts, LOCKS_DIR in process/lifecycle.ts:28). The pre-run gate counts files via `git status --porcelain` (listDirtyPaths, shared.ts:849) and lines via `git diff HEAD --numstat` (change-magnitude.ts:72) — so one untracked directory reads as \"1 file, 0 lines\". The lock is cleaned up on exit, which is why the tree is clean by the time the operator looks. Caught mid-run as `?? .hench/locks/`.\n\nrex init writes .gitignore entries for its own generated files (rex/src/cli/commands/init.ts:74). hench init writes none, so .hench/locks/, .hench/runs/ and .hench/usage-cursors/ are all left untracked. This repo never sees it because n-dx's own .gitignore already lists .hench/locks/ at line 6.\n\nFix: have hench init write the same class of entries rex init does (.hench/locks/, .hench/runs/, .hench/usage-cursors/, .hench-commit-msg.txt). Consider also making the gate ignore hench's own state dir, since a lock the run itself created should never count as operator dirt.</description>\n<parameter name=\"source\">Discovered while verifying the review pass end-to-end (task 0deece15)"
lastModified: "2026-09-01T18:27:00.040Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
