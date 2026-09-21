---
id: "3a6c133a-e7a5-4ba6-a842-7995f348e7d2"
level: "task"
title: "Close the issues fixed by #370 and triage #375 and #367"
status: "pending"
priority: "low"
tags:
  - "0.7.1"
  - "release-plumbing"
  - "wm-2037"
  - "non-code"
source: "caos work management: WM2037 (Close the issues fixed by #370 and triage #375 and #367); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "#362, #363, #364, #365 and #368 are closed with a comment naming the fixing commit in #370 and the test that covers each."
  - "#375 has either an assignee and a target release, or a comment recording that it waits for the single state writer planned for 0.9.0 and why that removes the bypass it exploits."
  - "#367 has either a Windows-host owner or a comment recording the decision to accept the fallback."
description: "Five autonomous-run bugs filed while running the 0.6.0 wave (#362 run polls a dead background task forever; #363 task completed with work left uncommitted; #364 epic auto-completes with deferred children; #365 --reset-deferred refuses the run it enabled; #368 cascade closes another person's work) were fixed by PR #370 but the issues were never closed. Two later issues are unowned: #375 (rex fix inverts timestamps it cannot repair; the only one with unfixed data-integrity risk, in a repair command rather than the run path) and #367 (Windows port relocation never uses its near window; it degrades to the 3117-3200 fallback rather than failing and needs a Windows host to reproduce).\n\nImplementation notes: Close GitHub issues #362, #363, #364, #365 and #368 on en-dash-consulting/n-dx, each with a comment pointing at the commit in PR #370 that fixed it and the regression test that covers it (find both with `git log --grep '#36N'` and the test names in #370's description). For #375, decide with the maintainer whether to fix `rex fix` now or defer until the single state writer lands in 0.9.0, and record the decision on the issue. For #367, decide whether a Windows host will be used to reproduce it or the 3117-3200 fallback is accepted, and record that. Non-code; no changeset."
lastModified: "2026-09-21T17:24:10.598Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
