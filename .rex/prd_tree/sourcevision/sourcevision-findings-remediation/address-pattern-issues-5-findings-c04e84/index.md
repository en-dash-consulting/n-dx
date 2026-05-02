---
id: "c04e8444-ae95-4f45-9979-9c8cd219caa8"
level: "task"
title: "Address pattern issues (5 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-11T14:16:40.053Z"
completedAt: "2026-03-11T14:21:41.843Z"
resolutionType: "code-change"
resolutionDetail: "Strengthened build-output-contract.test.ts with mount-point and source-HTML structural assertions. Updated CLAUDE.md web-shared baseline metrics (0.46→0.36 cohesion, 0.54→0.64 coupling) and documented that two-consumer rule and barrel import enforcement are now automated in boundary-check.test.ts. Three of five findings were stale (two-consumer rule already enforced, node-culler.ts doesn't exist, zone classification artifact)."
acceptanceCriteria: []
description: "- index.html references the Preact bundle via a path that is outside the module graph — build-output-contract.test.ts is the sole enforcement point for this contract, but if that test is skipped or scoped incorrectly, the viewer mount point is entirely unguarded.\n- boundary-check.test.ts enforces import directions and the messaging exemption but leaves the two-consumer rule for web-shared unenforced by automation — this is the most actively degrading policy in the codebase and warrants a dedicated count-based assertion.\n- 37 imports flowing from web-dashboard-platform into web-server (vs 3 reverse) establish this zone as the true composition root at runtime, inverting the documented layering where web-server should sit above the viewer hub.\n- The cohesion degradation from the CLAUDE.md baseline (0.46 → 0.36) is measurable and ongoing; the two-consumer rule is documented but not machine-enforced by boundary-check.test.ts, leaving the primary governance at PR review discretion only.\n- web-shared cohesion has degraded from 0.46 (documented in CLAUDE.md) to 0.36 while coupling increased from 0.54 to 0.64. The zone has 5 files now vs the 3 mentioned in the overview context — the discrepancy suggests recent file additions violated the two-consumer rule or added framework-specific utilities. Audit data-files.ts, view-id.ts, and node-culler.ts for single-consumer additions."
recommendationMeta: "[object Object]"
---

# Address pattern issues (5 findings)

🟠 [completed]

## Summary

- index.html references the Preact bundle via a path that is outside the module graph — build-output-contract.test.ts is the sole enforcement point for this contract, but if that test is skipped or scoped incorrectly, the viewer mount point is entirely unguarded.
- boundary-check.test.ts enforces import directions and the messaging exemption but leaves the two-consumer rule for web-shared unenforced by automation — this is the most actively degrading policy in the codebase and warrants a dedicated count-based assertion.
- 37 imports flowing from web-dashboard-platform into web-server (vs 3 reverse) establish this zone as the true composition root at runtime, inverting the documented layering where web-server should sit above the viewer hub.
- The cohesion degradation from the CLAUDE.md baseline (0.46 → 0.36) is measurable and ongoing; the two-consumer rule is documented but not machine-enforced by boundary-check.test.ts, leaving the primary governance at PR review discretion only.
- web-shared cohesion has degraded from 0.46 (documented in CLAUDE.md) to 0.36 while coupling increased from 0.54 to 0.64. The zone has 5 files now vs the 3 mentioned in the overview context — the discrepancy suggests recent file additions violated the two-consumer rule or added framework-specific utilities. Audit data-files.ts, view-id.ts, and node-culler.ts for single-consumer additions.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-11T14:16:40.053Z
- **Completed:** 2026-03-11T14:21:41.843Z
- **Duration:** 5m
