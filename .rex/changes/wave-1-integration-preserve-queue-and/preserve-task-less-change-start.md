---
id: "99df935b-e894-41c2-983b-7df37ccbdfb3"
type: "task"
title: "Preserve task-less-change Start through the shared settings helper"
slug: "preserve-task-less-change-start"
summary: "Let a change without child tasks start correctly while keeping safe settings saves and the existing task workflow."
description: "Approved Wave1 integration task for PR #1002, after queue integration. Port original stack isRunnableUnit eligibility and specific change-with-tasks refusal into main's shared packages/web/src/server/task-run-settings.ts writeTaskRun helper. Cover both PUT prep-save and one-click execute saveRun; keep one transactional path/version checks/cache/broadcast behavior, defaults and saved pins. Do not revive obsolete inline routes-hench-prep writes. Preserve P1 labels and v1 behavior. Preserve/regenerate prompt baselines from a clean committed prompt source tree rather than hand-merging; use node scripts/prompt-census.mjs --write and prompt-census test. During cumulative Wave1 integration reconcile existing PRD identities and moved/completed states without duplicates/lost history; verify raw v2 structure. Existing finding6, Wave2, paused followups excluded. All new semantic code/tests through actual ndx work; manual conflict resolution, derived regeneration and status comments allowed by runbook. No merges; keep at most2 work/gates acrossvendors."
acceptanceCriteria:
  - "The shared settings write helper accepts runnable task-less v2 changes and refuses changes containing tasks with an actionable message; v1 tasks/subtasks still work."
  - "Prepare-task save and one-click execute saveRun both use that helper and preserve transaction, version conflict, claim/refusal/workspace and cached-default behavior."
  - "Regression coverage includes a task-less change saving project defaults then starting, a change with tasks refusal, and original main/stack saved-run cases."
  - "Prompt baselines are generated from clean committed source and pass census checks; raw v2 identity/state scans are clean on the integrated tree, preserving canonical completed/moved nodes."
  - "Pass scoped web/type/gateway checks, mandatory startup tests, nonoptional Codex self-review and enabled affected gate; scoped patch changesets and atomic code/PRD completion with item trailer."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false}
tags:
  - "wave-1-integration"
  - "approved"
  - "pr-1002"
source: "ndx-capture"
blockedBy:
  - "b2d58519-a069-4b03-9aef-3cc5753b1055"
---
