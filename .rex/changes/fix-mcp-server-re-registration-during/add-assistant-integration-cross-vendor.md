---
id: "9474e0c0-dfca-486a-9b62-5b66fea5d235"
type: "task"
title: "Add assistant-integration cross-vendor contract integration test"
slug: "add-assistant-integration-cross-vendor"
description: "Add a new integration test file at tests/integration/assistant-integration.test.js that validates the cross-package assistant-integration contract. The test should: (1) import setupAssistantIntegrations and formatInitReport from packages/core/assistant-integration.js, (2) call setupAssistantIntegrations(tmpDir) in a temp directory with both vendors enabled and verify the result has entries for both 'claude' and 'codex' with expected shape (summary string, label string, skipped boolean, detail object), (3) call formatInitReport on the result and verify it returns an array of strings starting with 'Assistant surfaces:', (4) verify that disabling a vendor via { claude: false } produces a skipped result for claude but still provisions codex. This test exercises the cross-package boundary between core's orchestration layer and the vendor-specific integration modules (claude-integration.js, codex-integration.js). It satisfies the integration-coverage-policy ratio requirement (currently 5 integration tests for 36 e2e, needs 6). Follow existing patterns in tests/integration/ for setup/teardown."
acceptanceCriteria:
  - "Integration tests cover at least: rex smart-add, rex analyze, rex recommend, hench run (one iteration), and sourcevision analyze — all with vendor=google"
  - "Each test asserts that the Google adapter was invoked (not Claude or Codex) using a spy or mock"
  - "Tests run in CI without a real Google API key (adapter mocked at the llm-client boundary)"
  - "Existing Claude and Codex integration tests are unaffected by the new coverage"
priority: "high"
tags:
  - "google"
  - "testing"
  - "llm-client"
---
