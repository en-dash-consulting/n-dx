---
id: "52b2ecff-be44-4870-a115-d6a36489aed7"
type: "task"
title: "MemoryPanel and ConcurrencyPanel stay in the tree with tests and CSS after Live stopped mounting them"
slug: "memorypanel-and-concurrencypanel-stay"
description: "Verdict: should-fix (low). Task 71c475ec removed the Live side section and the barrel exports for MemoryPanel and ConcurrencyPanel. The strip already shows memory pressure and slots, which is why the section went. Deleting the component files was blocked by a permission prompt, so these are left behind: packages/web/src/viewer/components/memory-panel.ts, concurrency-panel.ts, tests/unit/viewer/memory-panel.test.ts, and about 94 .memory-*/.concurrency-* rule lines in src/viewer/styles/hench-runs.css. Nothing imports them, but the test keeps them type-checked and run, and diagnostic-panels-mounted.test.ts no longer guards them because they are no longer exported. Cost of leaving them: dead code that looks maintained. Fix (recommended): delete both components and memory-panel.test.ts, drop their CSS rules after checking nothing else uses those selectors, and remove them from the PANELS list in diagnostic-panels-mounted.test.ts. Alternative: fold the per-process memory, load average and pending-task detail into the strip tile details first, then delete. That costs more and needs a product decision."
acceptanceCriteria:
  - "packages/web/src/viewer/components/memory-panel.ts and concurrency-panel.ts no longer exist, and no file under packages/web/src or packages/web/tests imports them"
  - "hench-runs.css holds no .memory-panel or .concurrency-panel rules that no source file uses"
  - "pnpm --filter @n-dx/web typecheck and the web unit suite pass"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
