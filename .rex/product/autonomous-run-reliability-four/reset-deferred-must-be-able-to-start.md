---
id: "1752251a-3d51-4542-904e-4768d10932f6"
type: "capability"
title: "--reset-deferred must be able to start the run it enables, and a refusal must exit non-zero"
slug: "reset-deferred-must-be-able-to-start"
statement: "When `ndx work --reset-deferred` resets deferred tasks to pending on a clean tree, it goes on to start the run it was asked for, and any path that declines to start the run exits non-zero."
criteria: [{"id":"c1","text":"When `--reset-deferred` is given on a clean working tree, the work command shall reset the deferred tasks to pending and start the requested run without a manual commit in between."},{"id":"c2","text":"If the working tree holds the user's own uncommitted changes, the pre-run commit gate shall refuse to start the autonomous run."},{"id":"c3","text":"When the pre-run commit gate refuses to start the run because of the user's own uncommitted changes, the work command shall exit with a non-zero code."},{"id":"c4","text":"If the work command declines to start the requested run for any reason, it shall exit with a non-zero code."},{"id":"c5","text":"The work command shall exit with code 0 only when work has run."}]
tags:
  - "hench"
  - "gh-365"
source: "GitHub issues #362-#365, filed from the wave-1 session 2026-09-11"
priority: "high"
---

GitHub #365. Severity: high — the resume path is unusable on its own and fails while reporting success.

FAILURE SCENARIO
`ndx work --epic=<id> --auto --loop --reset-deferred --yes .` on a clean tree resets the deferred tasks to pending, which WRITES those PRD files, and the pre-run commit gate then refuses to start because the tree is dirty — with the files the reset itself just wrote:

  Reset 3 task(s) to pending: …
  ⚠ Refusing to start an autonomous run with 4 uncommitted file(s), 18 line(s) changed…
  Stopped before running. Commit or discard your changes, then re-run.

Exit code 0. No task ran. Workaround was to commit the reset and re-run (a1370bd6).

This is exactly the situation --reset-deferred exists for — resuming after an external interruption — and it is the one case where the flag deadlocks against itself. The zero exit makes it worse: in a script or an unattended context it reads as success and the tasks stay deferred forever.

SOLUTION
Commit the reset as part of the reset (status transitions are already committed during a run), or exempt the reset's own PRD writes from the dirty-tree check — the gate already discounts hench runtime artifacts, so there is precedent. Either way, a refusal to run must exit non-zero.
