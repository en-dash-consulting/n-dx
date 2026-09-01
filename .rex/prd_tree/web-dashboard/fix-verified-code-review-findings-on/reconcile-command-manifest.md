---
id: "56a6860c-eb30-4f0a-bd3f-c3b9830e25e0"
level: "task"
title: "Reconcile command manifest descriptions and triggers with actual endpoints"
status: "completed"
priority: "medium"
startedAt: "2026-08-18T22:49:28.655Z"
completedAt: "2026-08-18T22:50:35.809Z"
endedAt: "2026-08-18T22:50:35.809Z"
acceptanceCriteria:
  - "plan and refresh row descriptions match what their triggers actually run (or the triggers are removed)"
  - "ci trigger presence and fix/reshape manifest entries are reconciled deliberately"
  - "analyze's statusEndpoint declaration matches the code path RunCell actually exercises"
description: "The plan row renders invocation 'n-dx plan' but its trigger posts /api/rex/analyze, which runs only rex analyze — skipping the sourcevision analyze step that ndx plan performs, so it reasons over whatever .sourcevision/ data is on disk. The refresh row says 'Refresh dashboard data and UI artifacts' while its trigger runs --data-only --live-server, which deliberately does not rebuild UI artifacts. Either narrow the two descriptions to match the triggers or drop the triggers. Also reconcile: ci has a working /api/commands/ci + status pair but no manifest trigger; fix and reshape are absent from the manifest entirely; and analyze declares a statusEndpoint that is never exercised because RunCell posts an empty body (command-reference.ts:89), which takes the synchronous 200 path — misleading declaration even if harmless."
---
