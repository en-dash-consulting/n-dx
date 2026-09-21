---
id: "7dcba8e2-05e4-42bd-9172-4e146c692916"
level: "feature"
title: "Cap total spawns per task and retry via --resume"
status: "completed"
priority: "medium"
tags:
  - "hench"
  - "retries"
  - "sessions"
source: "ndx-capture"
startedAt: "2026-08-31T15:29:49.035Z"
completedAt: "2026-08-31T15:36:54.032Z"
endedAt: "2026-08-31T15:36:54.032Z"
acceptanceCriteria:
  - "Plan-mode re-spawns decrement the same retry budget as failure retries"
  - "A hard cap on total spawns per task is enforced and configurable; hitting it fails the run loudly with the spawn count in the run record"
  - "Transient CLI failures retry with --resume <sessionId> instead of a cold spawn on providers that support it"
  - "Resumed retries do not re-send the cold-restart retry notice or instruct re-inspection of prior work"
  - "Run records include the spawn count per task so ndx usage can report retry overhead"
description: "Retry multiplication: up to 4 retry re-spawns × up to 3 plan-mode re-spawns per attempt — up to 12 cold spawns per run, with plan re-spawns not counted against the retry budget, and the outer tracker allowing the same task 3 whole runs (audit H2; cli-loop.ts:1273-1425, run.ts:1579-1585). Count plan-mode re-spawns against the retry budget, enforce a hard cap on total spawns per task, and retry transient failures with claude --resume <sessionId> instead of a cold restart (design §08.4) — the resumed session already knows what it did, so the retry notice's grow-the-prompt 're-inspect prior work' instruction and its cost disappear."
lastModified: "2026-08-31T15:36:54.037Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
