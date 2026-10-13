---
id: "244cbf2b-4043-4021-bcdb-c26daabb3424"
level: "task"
title: "Layer 2 · Quiet green runs: silent passed-only, hench output quiet under vitest, fixture warning"
status: "pending"
priority: "high"
source: "ndx-capture"
acceptanceCriteria:
  - "A failing test still shows its console output in CI"
  - "The hench and rex suite logs shrink by an order of magnitude on a green run"
description: "silent: 'passed-only' in all six vitest configs. Hench output module treats process.env.VITEST as quiet so task briefs and turn headers stop reaching stdout from integration tests. Fix the fixture that triggers the prd.md-alongside-prd_tree warning 210 times per run."
lastModified: "2026-10-12T14:51:44.877Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
