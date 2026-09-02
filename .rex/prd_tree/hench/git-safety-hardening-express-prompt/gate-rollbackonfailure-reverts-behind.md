---
id: "5aa0a3ab-46ba-4299-afec-ce8fec53bba7"
level: "task"
title: "Gate rollbackOnFailure reverts behind an express prompt in interactive runs"
status: "completed"
priority: "high"
startedAt: "2026-07-15T14:29:39.724Z"
completedAt: "2026-07-15T16:24:27.432Z"
endedAt: "2026-07-15T16:24:27.432Z"
acceptanceCriteria: []
description: "hench.rollbackOnFailure defaults to true and, on a failed run, silently runs 'git reset HEAD .', 'git checkout .', and 'git clean -fd' (revertChanges in packages/hench/src/agent/analysis/review.ts:102-110, invoked by performRollbackIfNeeded in packages/hench/src/agent/lifecycle/shared.ts:901-920). This is a destructive git action taken with no express user prompt, which runs counter to the safety goal. In an interactive (TTY, non-autonomous) run, require an explicit confirmation before performing the revert; autonomous/--yes runs keep current behavior (or honor a config opt-out). Do not change what files are reverted — only add the prompt gate.\n\n## Acceptance Criteria\n- Interactive failed run with rollbackOnFailure=true prompts 'Revert N uncommitted file(s)? [y/N]' (default No) before running any reset/checkout/clean.\n- Declining leaves the working tree untouched and reports that changes were preserved.\n- Autonomous (--auto/--loop/--epic-by-epic) and --yes runs are unchanged (auto-revert or honor a config flag such as hench.rollbackOnFailure / a new promptBeforeRollback).\n- Non-TTY non-autonomous runs do not hang waiting on stdin — fall back to the documented default.\n- Regression test covers: interactive decline preserves files; interactive accept reverts; autonomous path unchanged."
---
