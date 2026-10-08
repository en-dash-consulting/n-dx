---
id: "03866a98-34d9-4c3e-a876-d42d7d8edaff"
level: "task"
title: "computeLandings re-resolves the ref, re-checks shallowness and re-reads both caches for every change"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "pr-11"
source: "ndx-adversarial-review"
completedAt: "2026-10-08T20:05:12.142Z"
resolutionType: "code-change"
resolutionDetail: "Fixed by task ae3c8475 (commit b2b021a43, merged in #584): computeLandings resolves the ref, checks shallowness and loads both caches once per call, not per change. ae3c8475's description names this capture; it was not marked at the time. Closed in the PR 11 cleanup, 2026-10-08."
acceptanceCriteria:
  - "computeLandings over N changes spawns git a constant number of times, independent of N (test counting spawns or stubbing exec)"
  - "computeLanding and computeLandings return identical results for the same tree and repository (test)"
description: "Scenario: a tree with 300 changes. computeLandings calls computeLanding once per change. Each call runs resolveMainRef three times (git rev-parse), assertFullHistory twice, and reads and JSON-parses the whole trailer-commits cache and the commit-landing cache. That adds up to about 1500 git spawns and 600 full-cache parses for one call, which makes it slow on a real repository.\n\nEvidence: packages/rex/src/core/change-landing.ts, computeLandings loop → computeLanding → loadTrailerCommits + loadLandings.\n\nReachable: no caller yet. It will be slow once rex health or a dashboard view calls it.\n\nVerdict: should-fix, low priority.\n\nFix: in computeLandings, resolve the ref once, load the trailer commits and landings once, and pass both into a pure per-change function, keeping computeLanding as a thin wrapper. It is cheap and carries no behaviour change.\n\nDone in the combined task 'Register change-landing with the v2 isolation test, report open changes as not landed, and load landing inputs once' (2026-10-08, Ryan)."
lastModified: "2026-10-08T20:05:12.991Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
