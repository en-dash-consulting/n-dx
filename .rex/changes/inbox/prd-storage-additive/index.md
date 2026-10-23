---
id: "507f8046-9ea2-4d1d-b5d9-c60f69164525"
type: "change"
title: "PRD storage additive"
slug: "prd-storage-additive"
intent: "Three additions to PRD storage that change nothing for a tree that does not use them. A branch guard makes reshape, reorganize, prune, the migrate commands and import-bundle --replace refuse off the default branch without --allow-on-branch, because whole-tree rewrites made on feature branches have ridden into main inside unrelated pull requests. rex tree-diff --json diffs two trees (two commits, or a worktree against its anchor) into added, changed, completed, moved and removed items with their ancestors; the PRD delta route shipped in 0.7.0 and SourceVision's pull-request markdown both call it, which replaces SourceVision's read of the legacy prd.md file. rex ready marks an item ready when it has at least one automated or metric requirement and no open blocker, and an assignee field with ndx work --mine lets a person work only their items.\n\nPart of this is a live defect, not only an addition: on a folder-tree project today, SourceVision's pull-request markdown reads .rex/prd.md (packages/sourcevision/src/analyzers/branch-work-collector.ts), which no longer exists after migration, so its Completed Work section finds nothing. 0.7.1's slug-rule guards stop a build with a different slug rule from rewriting the tree; they do not stop a deliberate bulk rewrite on a feature branch, which is what the branch guard is for.\n\nGoal: Bulk PRD rewrites stop leaking into feature branches, pull-request summaries read the real PRD, and people can work their own items."
acceptanceCriteria:
  - "Each guarded command refuses on a feature branch in a test repository and proceeds with the flag; the refusal names the branch and the flag."
  - "SourceVision's PR markdown produces a Completed Work section on a folder-tree project; the delta route and the CLI agree on the same fixture."
  - "A tree with no ready or assignee fields selects tasks exactly as today (test)."
  - "ndx work --mine picks only items assigned to the current user."
plannedRelease: "0.8.0"
priority: "high"
tags:
  - "0.8.0"
  - "prd-storage-additive"
source: "caos work management: feature ndx 0.8.0 - PRD storage additive"
---
