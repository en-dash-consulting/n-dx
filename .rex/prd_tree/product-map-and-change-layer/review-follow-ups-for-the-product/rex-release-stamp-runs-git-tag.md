---
id: "6374e3da-3086-43d4-9099-48e32a4d5fab"
level: "task"
title: "rex release stamp runs git tag --contains for every historical unstamped change, on every release"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "gatherReleaseInputs runs a bounded number of git commands for the released check, independent of the number of unstamped landed changes (test counts git invocations with 3+ such changes)"
  - "The released set it returns is unchanged on the existing release-stamp integration fixtures"
  - "The release-tag pattern stays defined only in change-landing.ts"
description: "Verdict: should-fix (low). Found by adversarial review of task 2f427fb8.\n\nScenario: a v2 project adopts the stamp with N historical changes that landed before any stamp existed (unstamped, landing already in an old release tag). gatherReleaseInputs (packages/rex/src/core/release-stamp.ts, the loop over `candidates`) calls firstReleaseContaining -> `git tag --contains <commit>` once per such landing commit. Those changes are never stamped (rule 3 leaves them to the tag fallback), so they stay candidates forever: each release pays N sequential `git tag --contains` walks, all inside the PRD lock, and N only grows. On a large history this can take minutes and hold the lock; the workflow fails open, so the symptom is a silently missing stamp rather than an error.\n\nReachable: `rex release stamp` from the Version Packages step once a project is on the v2 tree. Not reachable today (n-dx is on v1).\n\nOptions:\n1. (Recommended) In change-landing.ts, add a helper that answers \"which of these commits is in any release tag\" in one pass (e.g. list release tags once via the existing RELEASE_TAG pattern, then `git merge-base --is-ancestor` per commit only against the newest tag, or `git rev-list --tags` once), and use it from gatherReleaseInputs. Keeps the tag pattern in one module. Cost: one helper + test. Risk: low.\n2. Cache the released set keyed by the tag list in rexDir/.cache. Cost: more state; risk: stale cache."
lastModified: "2026-10-09T06:23:06.142Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
