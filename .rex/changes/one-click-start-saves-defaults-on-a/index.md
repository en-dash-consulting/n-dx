---
id: "960b4afa-2518-464b-9a8e-8c3cad6e2fc9"
type: "change"
title: "One-click Start saves defaults on a task even when the execute is then refused, so a task that never ran gains settings"
slug: "one-click-start-saves-defaults-on-a"
intent: "Adversarial review of 2b40afeaf (severity: medium, verdict: must-fix). Failure: a task with no saved run block; executions paused via the throttle controls (or the task already executing). Primary click → GET /api/hench/prep (refusals come only from 'ndx work --resolve', which knows nothing of the server's pause or active executions) → PUT /api/hench/prep saves defaults → POST /api/hench/execute answers 503 (paused) or 409 (already being executed). The task keeps a frozen run block, the worktree has an uncommitted .rex change that the next run's planning commit sweeps in, and the error auto-clears after 4s. Contradicts the component doc ('a task that never ran does not gain settings'). Evidence: packages/web/src/viewer/components/start-task-button.ts:209-246; packages/web/src/server/routes-hench.ts:2175-2186 (pause/active/claim gates after task lookup). Reachable from every Start Working mount; throttle pause is a dashboard control. Options: (A) client rolls the save back with PUT {run:null} on a refused execute — cheap, but a second PRD write and its own conflict path; (B, recommended) client sends the defaults block + read version with the execute, and the server saves it only after every execute gate passes, right before spawning, using the same save path and version check as PUT /api/hench/prep."
acceptanceCriteria:
  - "A one-click start refused by the server (paused 503, already-executing 409, claimed 409, blocked 409) leaves the task's run block and the working tree unchanged"
  - "A one-click start that is accepted (spawned or queued 202) saves the defaults on the task before the run reads them"
  - "A version conflict on the deferred save refuses the start with the same 'someone else saved settings' message as today"
  - "Tests cover a refused execute after a would-be save (no PUT, no run block) and the accepted path on the server route"
touches:
  - "2171d478-2d5b-4926-8e85-837f52c99abd"
priority: "medium"
discoveredFrom: {"item":"2323d387-7513-4edb-b76f-613a3f00919a"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
