---
id: "4a299c78-272b-4ff8-92b2-3e9ced88b46b"
level: "task"
title: "Add review mode and reviewer vendor to the Prepare task modal"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-9"
blockedBy:
  - "f620332f-3247-4feb-9d05-251e5ac4f7fc"
  - "716b508b-63e4-4bb3-b83a-80f107065f82"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "The modal shows Review and Reviewer vendor with their resolved default and source."
  - "Saving writes reviewMode and reviewVendor to the task's run block, and the copied command line includes the flags."
  - "Pair is disabled while pairSupported is false."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "In the Prepare task modal (`packages/web/src/viewer/components/prepare-task-modal.ts`, with its state in `prepare-task-model.ts`), add:\n- a Review field: Off / Self / Pair, with Pair disabled while the server reports `pairSupported` false;\n- a Reviewer vendor field (claude or codex, disabled when it matches the executor).\n\nBoth show the resolved default and its source from `GET /api/hench/prep/:taskId`, as the modal's other fields do. They save into the task's run block through `PUT /api/hench/prep/:taskId` (`routes-hench-prep.ts`). The copied `ndx work` command line includes the equivalent `--review-mode` / `--reviewer` flags when changed."
lastModified: "2026-10-10T23:41:44.714Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
