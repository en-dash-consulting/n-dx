---
id: "fbbf2cf6-5391-4f9a-aa32-a92f48bcaed2"
type: "change"
title: "Report commits that carry no item trailer"
slug: "report-commits-that-carry-no-item"
intent: "Re-scoped on 2026-10-08. v2 no longer stores a change's commits; it computes them from N-DX-Item trailers (computeChangeCommits in packages/rex/src/core/change-commits.ts). A backfill that writes v1 commits arrays into the tree therefore no longer fits and was unwound from this branch; what remains of the task is a report. rex backfill-commit-attribution becomes a read-only report of commits on the default branch that carry no N-DX-Item or N-DX-Status trailer, grouped by author and month, with totals, so the team can see how complete trailer coverage is before the 1.0.0 freeze. Keep the parser fixes already on this branch (read the whole log through core's git helper, accept every trailer per commit and both arrow forms). Acceptance criteria: the command writes nothing under .rex/; --json prints the same report as machine-readable; a test covers a commit with a trailer, one without, and one with two trailers; docs name the command as a report."
acceptanceCriteria:
  - "Items referenced by N-DX-Status trailers on main have commits recorded"
  - "The backfill commit changes no titles or slugs"
touches:
  - "298f7764-ed49-435a-8e4b-ada4c4c6f5a1"
priority: "medium"
tags:
  - "pr-05"
  - "lane-hench"
  - "hench"
  - "core"
source: "roadmap"
blockedBy:
  - "400e3b84-aa62-46d9-9a0d-861cdfbc981b"
---
