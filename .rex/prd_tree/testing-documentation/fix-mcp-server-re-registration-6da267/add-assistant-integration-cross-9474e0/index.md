---
id: "9474e0c0-dfca-486a-9b62-5b66fea5d235"
level: "task"
title: "Add assistant-integration cross-vendor contract integration test"
status: "completed"
priority: "high"
startedAt: "2026-04-10T18:27:43.479Z"
completedAt: "2026-04-10T18:34:31.731Z"
acceptanceCriteria: []
description: "Add a new integration test file at tests/integration/assistant-integration.test.js that validates the cross-package assistant-integration contract. The test should: (1) import setupAssistantIntegrations and formatInitReport from packages/core/assistant-integration.js, (2) call setupAssistantIntegrations(tmpDir) in a temp directory with both vendors enabled and verify the result has entries for both 'claude' and 'codex' with expected shape (summary string, label string, skipped boolean, detail object), (3) call formatInitReport on the result and verify it returns an array of strings starting with 'Assistant surfaces:', (4) verify that disabling a vendor via { claude: false } produces a skipped result for claude but still provisions codex. This test exercises the cross-package boundary between core's orchestration layer and the vendor-specific integration modules (claude-integration.js, codex-integration.js). It satisfies the integration-coverage-policy ratio requirement (currently 5 integration tests for 36 e2e, needs 6). Follow existing patterns in tests/integration/ for setup/teardown."
---

# Add assistant-integration cross-vendor contract integration test

🟠 [completed]

## Summary

Add a new integration test file at tests/integration/assistant-integration.test.js that validates the cross-package assistant-integration contract. The test should: (1) import setupAssistantIntegrations and formatInitReport from packages/core/assistant-integration.js, (2) call setupAssistantIntegrations(tmpDir) in a temp directory with both vendors enabled and verify the result has entries for both 'claude' and 'codex' with expected shape (summary string, label string, skipped boolean, detail object), (3) call formatInitReport on the result and verify it returns an array of strings starting with 'Assistant surfaces:', (4) verify that disabling a vendor via { claude: false } produces a skipped result for claude but still provisions codex. This test exercises the cross-package boundary between core's orchestration layer and the vendor-specific integration modules (claude-integration.js, codex-integration.js). It satisfies the integration-coverage-policy ratio requirement (currently 5 integration tests for 36 e2e, needs 6). Follow existing patterns in tests/integration/ for setup/teardown.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-04-10T18:27:43.479Z
- **Completed:** 2026-04-10T18:34:31.731Z
- **Duration:** 6m
