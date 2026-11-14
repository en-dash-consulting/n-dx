---
id: "40b7cd84-8bcc-4175-8bd0-92b8ea8ea290"
type: "task"
title: "Requirement validation commands run without the test worker cap"
slug: "requirement-validation-commands-run"
summary: "When a task's requirements name a check command, hench runs it without the shared limit on test workers, so a test run started that way can still use every core."
description: "Adversarial review of 9861a7ad (verdict: should-fix, severity low).\n\nScenario: hench.testGate.maxWorkers = 2 and a PRD requirement with a validation command such as `pnpm vitest run src/foo.test.ts`. The API-provider loop's rex_update_status calls toolRexUpdateStatus, which runs the requirement through createCommandExecutor (packages/hench/src/tools/rex.ts:384, called at :79). That executor's env is `repoCommandEnv(projectDir)` without withTestMaxWorkers, so vitest starts with the default worker count. Every other test command hench runs is capped by 9861a7ad.\n\nReachable: API loops (claude-api, local, google) with requirements that carry validation commands. CLI loops don't use this path.\n\nFix (recommended): give createCommandExecutor an optional `testMaxWorkers` and pass `options.testMaxWorkers` at rex.ts:79 (UpdateStatusOptions already carries it). Wrap the env in withTestMaxWorkers. Cost: a few lines plus one probe case in tests/integration/test-worker-cap.test.ts. Risk: none, because the value only tightens."
acceptanceCriteria:
  - "With hench.testGate.maxWorkers set, a requirement validation command run during rex_update_status receives NDX_TEST_MAX_WORKERS with that value"
  - "With it unset, the requirement command's environment is unchanged"
  - "packages/hench/tests/integration/test-worker-cap.test.ts has a probe case for createCommandExecutor that fails if the cap is not passed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "validation-gate"
  - "wave-1"
source: "ndx-adversarial-review"
---
