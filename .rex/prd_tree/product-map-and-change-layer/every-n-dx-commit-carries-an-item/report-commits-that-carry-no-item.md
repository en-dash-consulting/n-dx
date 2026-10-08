---
id: "fbbf2cf6-5391-4f9a-aa32-a92f48bcaed2"
level: "task"
title: "Report commits that carry no item trailer"
status: "completed"
priority: "medium"
tags:
  - "pr-05"
  - "lane-hench"
  - "hench"
  - "core"
blockedBy:
  - "400e3b84-aa62-46d9-9a0d-861cdfbc981b"
source: "roadmap"
startedAt: "2026-10-08T19:54:51.931Z"
completedAt: "2026-10-08T21:29:58.021Z"
endedAt: "2026-10-08T21:29:58.021Z"
resolutionType: "code-change"
resolutionDetail: "rex backfill-commit-attribution is now a read-only trailer coverage report: commits reachable from the default branch, covered/uncovered by N-DX-Item or N-DX-Status, grouped by author and month with totals. --json and --ref=<branch> supported. Writes nothing (no PRD load, no trailer cache). Report logic in the new src/core/trailer-coverage.ts; the parser fixes from this branch carried over. 10 tests, rex integration tier green (56 files, 510 passed)."
acceptanceCriteria:
  - "Items referenced by N-DX-Status trailers on main have commits recorded"
  - "The backfill commit changes no titles or slugs"
description: "Re-scoped on 2026-10-08. v2 no longer stores a change's commits; it computes them from N-DX-Item trailers (computeChangeCommits in packages/rex/src/core/change-commits.ts). A backfill that writes v1 commits arrays into the tree therefore no longer fits and was unwound from this branch; what remains of the task is a report. rex backfill-commit-attribution becomes a read-only report of commits on the default branch that carry no N-DX-Item or N-DX-Status trailer, grouped by author and month, with totals, so the team can see how complete trailer coverage is before the 1.0.0 freeze. Keep the parser fixes already on this branch (read the whole log through core's git helper, accept every trailer per commit and both arrow forms). Acceptance criteria: the command writes nothing under .rex/; --json prints the same report as machine-readable; a test covers a commit with a trailer, one without, and one with two trailers; docs name the command as a report."
lastModified: "2026-10-08T21:29:58.585Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
