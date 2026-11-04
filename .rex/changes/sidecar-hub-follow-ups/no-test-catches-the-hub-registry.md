---
id: "b147e397-606d-4194-b556-5324b87a8f49"
type: "task"
title: "No test catches the hub registry recording spend to the host project's ledger"
slug: "no-test-catches-the-hub-registry"
description: "Verdict: should-fix (medium), from the adversarial review of task 314d8fa3 (hub spend ledger).\n\nScenario: hubHostState (packages/web/src/server/routes-sidecar.ts, the createHubSidecarRegistry call) sets onTurnSpend: hubTurnSpendRecorder(ctx, opts.homeDir). Change that line back to sidecarTurnSpendRecorder(ctx), or drop it, and every test stays green. Hub spend would then land in the host project's ledger again, or go unrecorded, with no signal. tests/unit/server/hub-turn-spend.test.ts calls the recorder directly. routes-sidecar-hub.test.ts injects opts.hub.registryFor, which replaces the production registry options whole, so no hub route test ever runs the production onTurnSpend.\n\nReachable: any hub turn in production. This is a coverage gap, not a current failure.\n\nOptions:\n1. (recommended) Give registryFor the production defaults it replaces, e.g. registryFor(dir, { onTurnSpend }), or split a hubRegistryOptions(ctx, opts) that both hubHostState and the test seam use. Then add a route-level test: a hub turn through /api/sidecar/hub/sessions/:id/turns lands in <home>/hub/usage.jsonl and not in the project's usage ledger. Small seam change plus one test.\n2. Make the spawn injectable on createHubSidecarRegistry so the test uses the production registry. More invasive."
acceptanceCriteria:
  - "A hub-route test posts a turn through /api/sidecar/hub/sessions/:id/turns and finds its spend in <ndx home>/hub/usage.jsonl and no line in the host project's dashboard usage ledger"
  - "Reverting hubHostState's onTurnSpend to sidecarTurnSpendRecorder(ctx) makes that test fail"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
