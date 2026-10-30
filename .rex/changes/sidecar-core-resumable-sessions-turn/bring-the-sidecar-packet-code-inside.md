---
id: "aed63f9f-0142-49fa-8ba0-be62b6b5ada9"
type: "task"
title: "Bring the Sidecar packet code inside the layout and gateway policies"
slug: "bring-the-sidecar-packet-code-inside"
description: "Story 06 (afc0a661, run c197e172) built the lens packets in packages/web/src/server/sidecar/, but its test gate failed on two root policy tests. (1) tests/e2e/layout-literal-policy.test.js: packet-builders.ts spells '.sourcevision/zones.json' (lines 125 and 142) and '.hench/runs/' (line 331) by hand; build them from resolveLayout's sourcevisionDir and henchDir instead, as the test's message shows. (2) tests/integration/cross-package-contracts.test.js: web's rex-gateway now exports loadTrailerCommits and loadCommitFiles, which the contract test's GATEWAY_FUNCTIONS list and the auto-detection list do not name; add them, with the reason, as earlier entries do. Also fold in fc4ad798: packet-sources.ts hard-codes rex's cache dir as '.cache'; use PRD_CACHE_DIRNAME, which web's rex-gateway already re-exports. Do not add any file to the layout policy's ALLOWED list."
acceptanceCriteria:
  - "tests/e2e/layout-literal-policy.test.js passes with no new ALLOWED entry"
  - "tests/integration/cross-package-contracts.test.js passes, naming loadTrailerCommits and loadCommitFiles"
  - "packet-sources.ts builds the evidence cache dir from rex's exported constant, with no '.cache' string literal"
  - "the sidecar packet snapshot tests still pass unchanged"
priority: "high"
source: "ndx-capture"
---
