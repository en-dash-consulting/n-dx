---
id: "bbefb3ae-d581-41ce-b5a7-410b7640532a"
type: "task"
title: "The queue plan says each lane after the first needs its own worktree"
slug: "the-queue-plan-says-each-lane-after"
description: "Review finding F4 (https://github.com/en-dash-consulting/n-dx/pull/907#discussion_r4469225543), option (b). laneCommand in packages/hench/src/cli/commands/plan-queue.ts emits '<cli> work --task=... --auto .' for every lane, so two lanes pasted into one checkout collide: the second hits performPreRunCommitGateIfNeeded's dirty-tree refusal (non-TTY), or its prompt defaults to committing lane 1's half-done edits (TTY), or with --allow-dirty lane 1's completion gate refuses on lane 2's edits. Say plainly that every lane after the first runs in its own worktree, in the text output, the JSON and the Live 'Ready next' panel. Emitting worktree-scoped commands (option a) is a separate low-priority change."
acceptanceCriteria:
  - "With two or more lanes, the plan summary and each later lane's text block say the lane must run in its own worktree, and lane 1 runs here (tested)"
  - "The JSON adds a per-lane field marking a lane that needs its own worktree, with the plan's existing fields unchanged (tested)"
  - "The Live 'Ready next' panel shows that note on every lane after the first (viewer test)"
  - "A one-lane plan's text and JSON are unchanged apart from the new field being false (tested)"
priority: "high"
---
