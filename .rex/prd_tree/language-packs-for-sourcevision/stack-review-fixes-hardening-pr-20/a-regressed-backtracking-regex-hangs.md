---
id: "a7965dfd-7893-445c-9f2d-92baab036121"
level: "task"
title: "A regressed backtracking regex hangs the lang-kit suite instead of failing a named test"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lang-kit"
  - "pr-20"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With SPEC reverted to `\\s*,?\\s*`, the lang-kit unit suite fails within its budget and names the pathological-specifier test, rather than hanging"
  - "The helper is shared, so the uv-glob and pom.xml linearity tests can use it"
  - "Any clock the helper reads is listed in tests/wall-clock-assertion-inventory.md, and wall-clock-inventory-policy passes"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Also cover b0de7e5c's review finding (not captured separately): its comment-stripping, plugins/parent/modules and Gradle block-comment linearity tests pass with their fix reverted. Every linearity test added in PR 20 (python-requirements, uv globs, pom.xml, Maven interpolation, Gradle comments) must fail as a named assertion, not hang the suite, when its fix is reverted: count steps or input passes, or run the pathological case under a bounded budget the repo's wall-clock policy allows. Show the revert-fails check for each in the log, then restore the code."}
description: "Found by the adversarial review of c8bde891 (verdict: should-fix, medium).\n\nScenario: revert SPEC in packages/lang-kit/src/python-requirements.ts to `\\s*,?\\s*`. The test \"rejects a pathological specifier promptly\" (packages/lang-kit/tests/unit/python-requirements.test.ts) then blocks its worker inside a synchronous regex match. Vitest's per-test timeout is a timer, so it cannot interrupt the match. The suite hangs until CI's job timeout, and no test name or assertion is printed. The regression is still caught, but as an opaque hang. The sibling tasks for uv member globs and pom.xml reading will have the same testing problem.\n\nOptions:\n1. (Recommended) Add a small test helper that runs a function in a worker_thread and terminates it after a generous budget, scaled per TESTING.md's hang-guardrail rule (NDX_TEST_TIME_MULTIPLIER). Cost: about 20 lines, plus an entry in tests/wall-clock-assertion-inventory.md. Risk: worker start-up is slow on loaded runners, so the budget must be generous.\n2. Leave it as is and rely on the hang. Cost: none, but a CI run burns its whole timeout and fails without naming the test."
lastModified: "2026-10-17T10:50:16.707Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
