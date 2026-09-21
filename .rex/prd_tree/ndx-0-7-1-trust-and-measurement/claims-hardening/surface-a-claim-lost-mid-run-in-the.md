---
id: "cc18ea08-e16b-40eb-9bd6-840e7120a907"
level: "task"
title: "Surface a claim lost mid-run in the Sessions tray"
status: "pending"
priority: "low"
tags:
  - "0.7.1"
  - "claims-hardening"
  - "wm-2049"
blockedBy:
  - "8257feec-266e-412a-9881-c0b93dc5d53c"
source: "caos work management: WM2049 (Surface a claim lost mid-run in the Sessions tray); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "Integration test: a renewal refusal marks the run record with a claim-lost event naming the new holder's worktree (additive optional field)."
  - "The server broadcasts the change on the existing hench:run-changed channel; the Sessions tray shows 'claim taken over by <worktree>' on that run."
  - "Run records without the field load unchanged."
  - "GET /api/rex/claims is unchanged."
description: "Since #376 a claim is renewed for the length of a run; if renewal is refused because another worktree took the task, the run continues by design but the task leaves the held set silently. The operator watching the Sessions tray should see that the run's task is now claimed elsewhere. Record the event on the run and broadcast it, and render it in the tray.\n\nImplementation notes: In packages/hench/src/process/task-claims.ts, when the renewal timer's refresh is refused, emit an event the run loop records on the run record as an optional `claimLost` entry ({at, taskId, holderWorktree}) in packages/hench/src/schema/v1.ts (additive; old records must validate). Make the web server's run watcher broadcast hench:run-changed for that update, and render 'claim taken over by <worktree>' on the run's row in the Sessions tray component in packages/web/src/viewer. Add the integration test to packages/hench/tests/integration/task-claims-selection.test.ts and a viewer unit test for the label. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-21T17:24:18.451Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
