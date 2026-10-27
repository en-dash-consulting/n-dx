---
id: "3d1acefe-4738-4259-888d-6900b3a3bccc"
type: "change"
title: "No test pins the v2 change-layer flag at the rex reshape and rex add consolidation call sites"
slug: "no-test-pins-the-v2-change-layer-flag"
intent: "Found by the adversarial review of b22d3a8a (commit 84224ba36). Verdict: should-fix.\n\nScenario: revert `{ changeLayer: v2 }` in cli/commands/reshape.ts (both applyReshape calls), or `{ changeLayer: isChangeLayerStore(store) }` in cli/commands/add-reshape.ts applyMergePhase. Every rex test stays green, yet `rex reshape --accept` and `rex add`'s hash-suffix consolidation on a v2 tree go back to dropping the absorbed change's touches and aliases. The new tests in tests/integration/v2-mcp-tools.test.ts call core applyReshape with the flag set directly, so they protect the core path only.\n\nReachable: `rex add` on a v2 tree (resolveStore returns ChangeLayerStore) runs runScopedConsolidationPass; `rex reshape --accept` on v2.\n\nOptions:\n1. (Recommended) An integration test that runs runScopedConsolidationPass on a copy of the v2 fixture holding two hash-suffix duplicate changes (no LLM needed for the merge proposal; stub the rename pass if it fires) and asserts the survivor carries the absorbed change's touches and aliases. Cost: small.\n2. A cmdReshape test with spawnClaude mocked (as reshape-hash-suffix-parent.test.ts does) on a v2 fixture. Larger, covers the CLI path end to end."
acceptanceCriteria:
  - "A test running the rex add consolidation pass on a copy of the v2 fixture fails if add-reshape.ts stops passing changeLayer to applyReshape"
  - "A test of rex reshape --accept on a copy of the v2 fixture (LLM mocked) fails if reshape.ts stops passing changeLayer: v2 to applyReshape"
touches:
  - "40cb95a7-c1d5-4fd0-8041-74c7a928215f"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-33"
  - "lane-rex-store"
  - "review-2026-10-12"
source: "ndx-adversarial-review"
---
