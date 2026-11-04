---
id: "72d567bc-f501-4819-9a4b-90c58214bcd7"
type: "task"
title: "No test pins that a Sidecar ndx command is locked when the CLI cannot report its effects"
slug: "no-test-pins-that-a-sidecar-ndx"
description: "Verdict: should-fix (low). ndxSubcommandWritesSv (packages/web/src/server/routes-commands.ts) treats a subcommand with no declaration, or a failed `ndx help --effects` load, as a .sourcevision writer. The tests in routes-commands.test.ts (\"Sidecar commands\") only cover a declared writer (analyze) and a declared non-writer (status). If a later edit flips the fallback to `return false`, an approved `ndx analyze .` on an install whose effects read fails would run unlocked beside the dashboard's analyze/CI/refresh, and every test would stay green. Reachable via the Sidecar run_command card whenever the effects spawn errors. Fix: add one test that mocks execMock to fail the effects load (error set) and asserts startSidecarCommand(ctx, [\"ndx\",\"analyze\",\".\"]) is refused while sv-analyze holds the lock, and one for an undeclared subcommand. Cost: two small tests; no risk."
acceptanceCriteria:
  - "A test fails the effects load and asserts a Sidecar ndx analyze is refused while sv-analyze holds the .sourcevision write lock"
  - "A test asserts a Sidecar ndx subcommand with no effects declaration takes the lock"
  - "Both tests fail if ndxSubcommandWritesSv's fallback returns false"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
