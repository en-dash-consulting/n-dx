---
id: "5f81ff21-a931-49e0-8e76-2189bd06210f"
level: "task"
title: "Address pattern issues (11 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-11T15:16:01.379Z"
completedAt: "2026-03-11T15:24:12.646Z"
resolutionType: "code-change"
resolutionDetail: "Zone pins for batch-types.ts/keywords.ts/verify.ts, cli-dev.test.js timeout, boundary-check viewer-prd-interaction assertion, fix command e2e tests; remaining findings acknowledged as structural observations"
acceptanceCriteria: []
description: "- batch-types.ts is physically in packages/rex/src/analyze/ but zone-classified under chunked-review — moving the file to packages/rex/src/cli/commands/ would align physical location with zone ownership and eliminate the masked boundary crossing.\n- cli-dev.test.js is listed in CLAUDE.md as a required test and is the sole gate for dev-mode startup coverage. If this file is skipped, flaked, or times out in CI, dev-mode regressions become undetectable. It should have an explicit timeout budget and a CI status check that alerts on skip (not just failure) to prevent silent coverage gaps.\n- The fix satellite zone is the smallest zone (4 files) producing a return edge into the domain engine — the structural remedy is simpler here than in chunked-review: inlining core/fix.ts into fix.ts would close the cycle and collapse the zone to 3 files without losing any behavior.\n- chunked-review and prd-fix-command are the two highest-risk CLI commands (dual-fragility governance, active bidirectional cycles with the domain engine) but neither has a corresponding e2e test file in rex-cli-e2e — adding e2e coverage for these commands would surface cycle-induced initialization failures that unit tests cannot detect.\n- keywords.ts and verify.ts share no internal imports and exist as a zone solely because they both import from and are imported by rex-prd-engine — absorbing both files directly into rex-prd-engine would eliminate the zone, break the bidirectional cycle, and improve the engine's self-contained cohesion without adding external coupling.\n- rex-e2e-config (cohesion 0) and rex-e2e (cohesion 1, 4 files) represent a split e2e test zone that should be a single cohesive zone — the two zones together cover the same CLI surface but are separated by community detection grouping package-root artifacts with unrelated test files; consolidation would produce one high-cohesion e2e zone and eliminate the cohesion-0 artifact.\n- Three of the four zones that depend on rex-prd-engine (chunked-review, prd-fix-command, rex-core-utilities) each produce a return edge back into the engine, forming a systemic multi-cycle pattern rather than isolated incidents — a single structural fix (strictly enforcing one-way dependency into the engine) would resolve all three cycles simultaneously.\n- Build infrastructure files (build.js, dev.js) are grouped into this zone alongside runtime components purely by directory proximity — their presence corrupts cohesion and coupling metrics for this zone and should be excluded from zone analysis via sourcevision config\n- boundary-check.test.ts is the sole automated enforcer for web-shared and crash/ sub-zone boundaries, but viewer-prd-interaction — the only other dual-fragility zone in the web package (cohesion 0.26, coupling 0.74) — has zero boundary assertions in this file. Extending boundary-check.test.ts to assert barrel access for viewer-prd-interaction hooks would bring governance parity with the crash zone.\n- All inbound consumers of web-viewer (web-server, web-dashboard-platform, use, web-unit) reach it from different architectural layers (server, UI platform, interaction, test) — this multi-layer fan-in confirms web-viewer has absorbed responsibilities that belong in more focused zones\n- web-viewer is the sole zone in the monorepo that functions as both a heavy consumer hub (39 imports from web-server) and a heavy provider hub (23+12+7+3 inbound from 4 zones) — dual-hub topology means a single API change can cascade in both directions simultaneously; no other zone has this exposure profile."
recommendationMeta: "[object Object]"
---

# Address pattern issues (11 findings)

🔴 [completed]

## Summary

- batch-types.ts is physically in packages/rex/src/analyze/ but zone-classified under chunked-review — moving the file to packages/rex/src/cli/commands/ would align physical location with zone ownership and eliminate the masked boundary crossing.
- cli-dev.test.js is listed in CLAUDE.md as a required test and is the sole gate for dev-mode startup coverage. If this file is skipped, flaked, or times out in CI, dev-mode regressions become undetectable. It should have an explicit timeout budget and a CI status check that alerts on skip (not just failure) to prevent silent coverage gaps.
- The fix satellite zone is the smallest zone (4 files) producing a return edge into the domain engine — the structural remedy is simpler here than in chunked-review: inlining core/fix.ts into fix.ts would close the cycle and collapse the zone to 3 files without losing any behavior.
- chunked-review and prd-fix-command are the two highest-risk CLI commands (dual-fragility governance, active bidirectional cycles with the domain engine) but neither has a corresponding e2e test file in rex-cli-e2e — adding e2e coverage for these commands would surface cycle-induced initialization failures that unit tests cannot detect.
- keywords.ts and verify.ts share no internal imports and exist as a zone solely because they both import from and are imported by rex-prd-engine — absorbing both files directly into rex-prd-engine would eliminate the zone, break the bidirectional cycle, and improve the engine's self-contained cohesion without adding external coupling.
- rex-e2e-config (cohesion 0) and rex-e2e (cohesion 1, 4 files) represent a split e2e test zone that should be a single cohesive zone — the two zones together cover the same CLI surface but are separated by community detection grouping package-root artifacts with unrelated test files; consolidation would produce one high-cohesion e2e zone and eliminate the cohesion-0 artifact.
- Three of the four zones that depend on rex-prd-engine (chunked-review, prd-fix-command, rex-core-utilities) each produce a return edge back into the engine, forming a systemic multi-cycle pattern rather than isolated incidents — a single structural fix (strictly enforcing one-way dependency into the engine) would resolve all three cycles simultaneously.
- Build infrastructure files (build.js, dev.js) are grouped into this zone alongside runtime components purely by directory proximity — their presence corrupts cohesion and coupling metrics for this zone and should be excluded from zone analysis via sourcevision config
- boundary-check.test.ts is the sole automated enforcer for web-shared and crash/ sub-zone boundaries, but viewer-prd-interaction — the only other dual-fragility zone in the web package (cohesion 0.26, coupling 0.74) — has zero boundary assertions in this file. Extending boundary-check.test.ts to assert barrel access for viewer-prd-interaction hooks would bring governance parity with the crash zone.
- All inbound consumers of web-viewer (web-server, web-dashboard-platform, use, web-unit) reach it from different architectural layers (server, UI platform, interaction, test) — this multi-layer fan-in confirms web-viewer has absorbed responsibilities that belong in more focused zones
- web-viewer is the sole zone in the monorepo that functions as both a heavy consumer hub (39 imports from web-server) and a heavy provider hub (23+12+7+3 inbound from 4 zones) — dual-hub topology means a single API change can cascade in both directions simultaneously; no other zone has this exposure profile.

## Info

- **Status:** completed
- **Priority:** critical
- **Level:** task
- **Started:** 2026-03-11T15:16:01.379Z
- **Completed:** 2026-03-11T15:24:12.646Z
- **Duration:** 8m
