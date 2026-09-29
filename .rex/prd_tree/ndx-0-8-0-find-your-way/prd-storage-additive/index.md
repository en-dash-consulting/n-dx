---
id: "507f8046-9ea2-4d1d-b5d9-c60f69164525"
level: "feature"
title: "PRD storage additive"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "prd-storage-additive"
source: "caos work management: feature ndx 0.8.0 - PRD storage additive"
acceptanceCriteria:
  - "Each guarded command refuses on a feature branch in a test repository and proceeds with the flag; the refusal names the branch and the flag."
  - "SourceVision's PR markdown produces a Completed Work section on a folder-tree project; the delta route and the CLI agree on the same fixture."
  - "A tree with no ready or assignee fields selects tasks exactly as today (test)."
  - "ndx work --mine picks only items assigned to the current user."
description: "Three additions to PRD storage that change nothing for a tree that does not use them. A branch guard makes reshape, reorganize, prune, the migrate commands and import-bundle --replace refuse off the default branch without --allow-on-branch, because whole-tree rewrites made on feature branches have ridden into main inside unrelated pull requests. rex tree-diff --json diffs two trees (two commits, or a worktree against its anchor) into added, changed, completed, moved and removed items with their ancestors; the PRD delta route shipped in 0.7.0 and SourceVision's pull-request markdown both call it, which replaces SourceVision's read of the legacy prd.md file. rex ready marks an item ready when it has at least one automated or metric requirement and no open blocker, and an assignee field with ndx work --mine lets a person work only their items.\n\nPart of this is a live defect, not only an addition: on a folder-tree project today, SourceVision's pull-request markdown reads .rex/prd.md (packages/sourcevision/src/analyzers/branch-work-collector.ts), which no longer exists after migration, so its Completed Work section finds nothing. 0.7.1's slug-rule guards stop a build with a different slug rule from rewriting the tree; they do not stop a deliberate bulk rewrite on a feature branch, which is what the branch guard is for.\n\nGoal: Bulk PRD rewrites stop leaking into feature branches, pull-request summaries read the real PRD, and people can work their own items."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add an assignee field and ndx work --mine](./add-an-assignee-field-and-ndx-work-mine.md) | pending |
| [Add rex ready to mark items ready when they have an automated or metric requirement and no open blocker](./add-rex-ready-to-mark-items-ready-when.md) | completed |
| [Add rex tree-diff --json to diff two PRD trees](./add-rex-tree-diff-json-to-diff-two-prd.md) | completed |
| [Guard whole-tree rewrites reached through the rex MCP reorganize tool and the dashboard's bulk routes](./guard-whole-tree-rewrites-reached.md) | pending |
| [Point the PRD delta route and SourceVision's PR markdown at rex tree-diff and drop the legacy prd.md read](./point-the-prd-delta-route-and.md) | in_progress |
| [Refuse whole-tree PRD rewrites off the default branch without --allow-on-branch](./refuse-whole-tree-prd-rewrites-off-the.md) | completed |
| [Show where a long field changed in rex tree-diff's text output](./show-where-a-long-field-changed-in-rex.md) | pending |
