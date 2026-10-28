---
id: "3c9bb178-cf51-4543-9c90-61036b4d4f6f"
type: "task"
title: "No test covers the provenance paths createPacketSources builds, so a wrong layout-derived zones or runs label goes unnoticed"
slug: "no-test-covers-the-provenance-paths"
description: "Found by the adversarial review of aed63f9f. Verdict: should-fix (low).\n\npackages/web/src/server/sidecar/packet-sources.ts, createPacketSources: `sourcePaths` is now computed from resolveLayout. It is relative(projectDir, sourcevisionDir/zones.json) and `${relative(projectDir, henchDir/runs)}/`, with backslashes normalized. The only test, sidecar-packets.test.ts, uses a stub that hard-codes the labels, so no test checks the production values. Scenario: someone drops the trailing slash, the backslash normalization, or the relative() call (say an absolute path leaks in an ndx-mode layout). Packets then show a wrong or machine-specific source line, and every test stays green. createPacketSources has no caller yet (M2/M3 wire it), so nothing is wrong today.\n\nFix: add a unit test that calls createPacketSources with a temp-dir ServerContext and stub SpawnedReads. It should assert sourcePaths on a legacy layout ('.sourcevision/zones.json', '.hench/runs/') and on an ndx-container layout, which gives the container-relative paths. Cost: one small test. Risk: none."
acceptanceCriteria:
  - "A test calls createPacketSources and asserts sourcePaths equals { zones: '.sourcevision/zones.json', runs: '.hench/runs/' } on a legacy layout"
  - "The same test asserts the container-relative, forward-slash paths on an ndx-container layout"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
