---
id: "3ca22dd0-c780-4dd9-8c6d-6b5d42fd6cc5"
level: "task"
title: "Behind the hub, never let the Live slots tile report fewer runs in use than the repository's live run list"
status: "pending"
priority: "medium"
tags:
  - "live"
  - "local-testing"
source: "follow-up to 94195450 (local testing of PR #496), 2026-10-01"
acceptanceCriteria:
  - "With a hub admission header reporting running 0 and one terminal-started run judged live in another worktree, /api/live reports slots.inUse = 1, scope machine, and max = the header's maxSessions (integration test)."
  - "With the header reporting more sessions than the repository has live runs, inUse = the header's running."
  - "available and level are recomputed from the reported inUse."
  - "Changeset for @n-dx/web (patch)."
description: "Behind the hub, the Live strip's agent-slots tile reports the hub admission gate's `running`, which counts only dashboard-started sessions (see the doc on `HubAdmissionHeader` in `packages/web/src/shared/hub-admission.ts`). A run started from a terminal in any worktree is live in the run list beside it but not counted, so the tile can read \"0 of 3 · this machine\" while a run executes. Standalone (`ndx start --here`) is already correct: it counts runs judged `live` across every worktree.\n\nFix in `handleLiveRoute` (`packages/web/src/server/routes-live.ts`, where `slots = admission ? hubSlots(admission) : snapshot.machine.slots`): when the hub's admission header is present, report in-use as the larger of the hub's `running` and the snapshot's repository-wide live-run count (`snapshot.machine.slots.inUse`, computed from verdicts), keep `max` = the hub's `maxSessions`, `queued` = the hub's queue, recompute `available` and `level` from the result, and keep `scope: \"machine\"`. This keeps the tile one number that is never below the run list. Do not change the header format or the proxy."
lastModified: "2026-10-01T23:30:43.554Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
