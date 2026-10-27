---
id: "2cc75cd0-b22f-431a-a457-d82d895809fd"
type: "change"
title: "Robot Wrangler stack 9/9 · Per-task reviewer settings"
slug: "robot-wrangler-stack-9-9-per-task"
intent: "A task's saved run settings (the Prepare task modal and rex's `run` block) can already turn review on and pin a reviewer model. This adds the review mode and the reviewer vendor per task, so a single task can be pair-reviewed by a chosen vendor whatever the project default is.\n\nThis is PR 9, the last of the Robot Wrangler stack. It changes the PRD schema's `run` block and the shape of the `add_item` and `edit_item` MCP tools, so under the 0.10.0 soft freeze it needs a release-note entry.\n\nGoal: Each task can choose its own review mode and reviewer vendor."
acceptanceCriteria:
  - "A task's run block can carry reviewMode and reviewVendor, and ndx work honours them."
  - "The 0.10.0 release notes record the schema and MCP shape addition."
plannedRelease: "0.10.0"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-9"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
---
