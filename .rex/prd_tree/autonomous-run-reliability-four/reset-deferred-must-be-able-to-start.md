---
id: "1752251a-3d51-4542-904e-4768d10932f6"
level: "task"
title: "--reset-deferred must be able to start the run it enables, and a refusal must exit non-zero"
status: "pending"
priority: "high"
tags:
  - "hench"
  - "gh-365"
source: "GitHub issues #362-#365, filed from the wave-1 session 2026-09-11"
acceptanceCriteria:
  - "`--reset-deferred` on a clean tree resets the tasks AND starts the run, with no manual commit in between."
  - "A genuine dirty-tree refusal (user's own uncommitted work) still refuses — and exits non-zero."
  - "Every path that declines to start the requested run exits non-zero; exit 0 means work ran."
  - "Integration test covers reset-then-run on a clean tree and reset-then-refuse on a genuinely dirty one."
description: "GitHub #365. Severity: high — the resume path is unusable on its own and fails while reporting success.\n\nFAILURE SCENARIO\n`ndx work --epic=<id> --auto --loop --reset-deferred --yes .` on a clean tree resets the deferred tasks to pending, which WRITES those PRD files, and the pre-run commit gate then refuses to start because the tree is dirty — with the files the reset itself just wrote:\n\n  Reset 3 task(s) to pending: …\n  ⚠ Refusing to start an autonomous run with 4 uncommitted file(s), 18 line(s) changed…\n  Stopped before running. Commit or discard your changes, then re-run.\n\nExit code 0. No task ran. Workaround was to commit the reset and re-run (a1370bd6).\n\nThis is exactly the situation --reset-deferred exists for — resuming after an external interruption — and it is the one case where the flag deadlocks against itself. The zero exit makes it worse: in a script or an unattended context it reads as success and the tasks stay deferred forever.\n\nSOLUTION\nCommit the reset as part of the reset (status transitions are already committed during a run), or exempt the reset's own PRD writes from the dirty-tree check — the gate already discounts hench runtime artifacts, so there is precedent. Either way, a refusal to run must exit non-zero."
lastModified: "2026-09-11T18:56:20.712Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
