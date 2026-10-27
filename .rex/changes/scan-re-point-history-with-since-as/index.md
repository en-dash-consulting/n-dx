---
id: "967fa9df-2df6-4314-94d1-0410c457d720"
type: "change"
title: "Scan re-point history with --since-as-filter, and skip retired changes when computing building status"
slug: "scan-re-point-history-with-since-as"
intent: "Two P2 findings from the review of PR #584 (inline comments 4215572677 and 4215572686), both reproduced by the reviewer. Do both.\n\n1. History pruning (packages/rex/src/core/repoint-commits.ts, the patch-id scan). git log --since stops walking a path at a commit older than the cutoff, so a backdated commit hides a later matching squash: original authored Oct 3, its squash on main Oct 4, a backdated commit Oct 2, tip Oct 5 (all touching the same file) returns the squash unmatched. Use --since-as-filter (git 2.37+) so traversal continues and only the output is filtered. Regression with that fixture.\n2. Deleted ancestors (packages/rex/src/schema/v2-rules.ts, changingNodes / isBuildingChange). computeProductStatus passes a tombstone-aware index, so entries include descendants of deleted changes marked retired. A pending change under a deleted umbrella change currently counts as building and marks a met capability changing. Skip retired entries there, matching the edge and fix scans. Regression: a met capability and a deleted umbrella change containing a pending amending change reads met.\n\nTests for both; commit the work."
touches:
  - "4cd7c27a-13d3-4fd3-85b4-9f309a4237fd"
priority: "high"
---
