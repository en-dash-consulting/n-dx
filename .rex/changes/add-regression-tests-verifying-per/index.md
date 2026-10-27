---
id: "ff7940bf-1dd2-4871-8e5a-53a4cac4fc10"
type: "change"
title: "Add regression tests verifying per-skill commit behavior and hench path isolation"
slug: "add-regression-tests-verifying-per"
intent: "Write tests using a temporary git repo fixture (no live LLM calls) that confirm: each updated skill produces exactly one commit when it modifies files, no commit is created when the skill's work produces no changes, and the hench run-loop commit pathway is unaffected. Tests should be co-located with existing skill integration tests and run in CI without network access."
acceptanceCriteria:
  - "One test per updated skill confirms a commit is produced after the skill modifies at least one file"
  - "One test per updated skill confirms no commit attempt is made when the skill produces no file changes"
  - "An integration test confirms the hench run loop does not double-commit after this change ships"
  - "All tests pass in CI without requiring network access or live LLM calls"
touches:
  - "efac37e0-dc05-4140-b0e1-dfb3e24b6f7e"
priority: "high"
tags:
  - "skills"
  - "claude-code"
  - "commit"
  - "tests"
source: "smart-add"
---
