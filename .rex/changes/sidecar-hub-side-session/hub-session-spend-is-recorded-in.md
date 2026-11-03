---
id: "314d8fa3-ea8c-4950-8a02-bd836a646b39"
type: "task"
title: "Hub session spend is recorded in whichever project happens to host it"
slug: "hub-session-spend-is-recorded-in"
description: "Verdict: should-fix (low), from the adversarial review of a23d8599.\n\nScenario: hubHostState (packages/web/src/server/routes-sidecar.ts) wires onTurnSpend to sidecarTurnSpendRecorder(ctx), which appends each hub turn to the host project's .n-dx-web-usage.jsonl. That project's LLM Utilization then shows the machine-wide hub session's spend as its own, and when the host changes (unregistered, died) the spend splits across projects. An operator budgeting per project is shown cost that project never incurred.\n\nReachable: any hub turn.\n\nOptions:\n1. (recommended) Record hub spend in a hub-level ledger under <ndx home>/hub/ (for example usage.jsonl), and have the hub home show it. Needs a reader.\n2. Keep the host project's ledger, but tag the line scope: \"hub\" so readers can separate it. Cheaper, and still misleading wherever a reader ignores the tag.\nDecision for the operator: where machine-wide spend should be visible."
acceptanceCriteria:
  - "A completed hub turn adds no line to the host project's dashboard usage ledger, or adds one that LLM Utilization reports apart from that project's own spend"
  - "The hub session's spend is readable from one place whichever project hosted each turn"
  - "A test asserts where a hub turn's spend is recorded"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
