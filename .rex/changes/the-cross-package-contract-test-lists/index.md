---
id: "267d46e9-a993-4336-a8d1-1f2b5e29e6f0"
type: "change"
title: "The cross-package contract test lists findActionableWork on the web rex gateway"
slug: "the-cross-package-contract-test-lists"
intent: "CI on #1000 (run 42290922022) fails tests/integration/cross-package-contracts.test.js 'web rex-gateway source exports match contract test list' on Linux, macOS and Windows: task e07a0471 added findActionableWork to packages/web/src/server/rex-gateway.ts (line 36) so Ready to run uses rex's v2 selector, but the web rex-gateway list in the contract test (around line 1004, beside findNextWorkTask) was not updated. Add \"findActionableWork\" to that list and any matching GATEWAY_FUNCTIONS entry the test expects for the web gateway, then run tests/integration/cross-package-contracts.test.js and the architecture-policy suite. Change nothing else."
acceptanceCriteria:
  - "tests/integration/cross-package-contracts.test.js passes"
touches:
  - "2171d478-2d5b-4926-8e85-837f52c99abd"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":false}
source: "ndx-capture"
---
