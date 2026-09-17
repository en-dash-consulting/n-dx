---
id: "ff7940bf-1dd2-4871-8e5a-53a4cac4fc10"
level: "task"
title: "Add regression tests verifying per-skill commit behavior and hench path isolation"
status: "completed"
priority: "high"
tags:
  - "skills"
  - "claude-code"
  - "commit"
  - "tests"
source: "smart-add"
startedAt: "2026-05-28T15:59:25.685Z"
completedAt: "2026-05-28T16:05:26.018Z"
endedAt: "2026-05-28T16:05:26.018Z"
resolutionType: "code-change"
resolutionDetail: "Added tests/e2e/skill-commit-isolation.test.js (28 structural tests) and tests/integration/skill-commit-behavior.test.js (14 behavioral git-fixture tests). All pass without network access or LLM calls."
acceptanceCriteria:
  - "One test per updated skill confirms a commit is produced after the skill modifies at least one file"
  - "One test per updated skill confirms no commit attempt is made when the skill produces no file changes"
  - "An integration test confirms the hench run loop does not double-commit after this change ships"
  - "All tests pass in CI without requiring network access or live LLM calls"
description: "Write tests using a temporary git repo fixture (no live LLM calls) that confirm: each updated skill produces exactly one commit when it modifies files, no commit is created when the skill's work produces no changes, and the hench run-loop commit pathway is unaffected. Tests should be co-located with existing skill integration tests and run in CI without network access."
---
