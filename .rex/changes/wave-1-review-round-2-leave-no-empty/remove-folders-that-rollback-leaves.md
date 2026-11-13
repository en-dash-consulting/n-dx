---
id: "6551dfdd-749a-4ca3-9484-4b5a76817100"
type: "task"
title: "Remove folders that rollback leaves empty"
slug: "remove-folders-that-rollback-leaves"
description: "PR #1004 review comment https://github.com/en-dash-consulting/n-dx/pull/1004#discussion_r4558509335. listUntrackedPaths in packages/hench/src/agent/analysis/review.ts now lists individual files, so git clean -fd removes the files and leaves their folders. Repro: the agent creates .rex/changes/new-ch/{index.md,state.yaml,t/index.md}, rollback is confirmed, and .rex/changes/new-ch/t/ survives empty; the rex v2 reader then warns 'Folder has no index.md; skipped with its contents' on every PRD read."
acceptanceCriteria:
  - "After a confirmed rollback of agent-created PRD folders, no folder that the removed files emptied remains."
  - "Folders that existed or held untracked files before the run are left alone."
  - "A test reproduces the nested new-change case and asserts no empty folder survives."
priority: "high"
source: "ndx-capture"
---
