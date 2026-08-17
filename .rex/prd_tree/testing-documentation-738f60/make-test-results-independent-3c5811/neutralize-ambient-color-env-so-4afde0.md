---
id: "4afde06c-532e-4d2e-966e-6006f4860278"
level: "task"
title: "Neutralize ambient color env so FORCE_COLOR does not fail 24 tests"
status: "pending"
priority: "high"
tags:
  - "testing"
  - "determinism"
  - "developer-experience"
  - "core"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "The full suite passes with FORCE_COLOR=3 and COLORTERM=truecolor set in the invoking shell"
  - "The full suite still passes with those variables unset"
  - "Color neutralization happens before the first supportsColor() read, accounting for the memoised _colorEnabled cache"
  - "Spawned CLI child processes inherit the neutralized color env, not just the vitest process"
  - "No existing assertion was relaxed to tolerate ANSI escapes; the plain-output contract is intact"
  - "At least one test still covers the colorized path, so forcing color remains a supported behavior"
description: "With `FORCE_COLOR=3` set in the invoking shell (common — it ships in many terminal/tool environments alongside `COLORTERM=truecolor`), the suite reports 24 failed tests across 8 files:\n\n  tests/unit/help.test.js, tests/e2e/cli-refresh.test.js (7), cli-arg-contracts.test.js (6),\n  cli-errors.test.js (5), cli-brand.test.js (2, incl. 2 failed snapshots),\n  cli-version.test.js, cli-init.test.js, cli-auth.test.js\n\nCause: `supportsColor()` in packages/core/cli.js:173 returns true whenever `FORCE_COLOR` is set and not \"0\", ahead of the `process.stdout.isTTY` check. Assertions comparing plain strings then see ANSI escapes — e.g. `expected 'See also: \\u001b[36mndx plan\\u001b[39m…' to be 'See also: ndx plan, ndx work'`. Measured directly: with FORCE_COLOR unset the same suite is 2019 passed / 0 of these failures; with it set, 24 fail.\n\nWhy this is worth fixing rather than documenting: GitHub runners do not set FORCE_COLOR, so CI is green and the breakage is invisible there. It surfaces only for a human running the suite locally, with no diagnostic pointing at their terminal — the failures look like real output-contract regressions. A developer's first encounter with the suite should not depend on their shell.\n\nFix: neutralize color detection for the test process AND for the processes tests spawn. A vitest `setupFiles` entry (or the existing tests/e2e/verify-build.js globalSetup) should force a known state — set `NO_COLOR=1` or `FORCE_COLOR=0` and delete `COLORTERM` — before any module reads it. Note two traps:\n1. `supportsColor()` results are MEMOISED (`_colorEnabled` in packages/core/help.js:39-45), so the env must be set before first read, not merely before the assertion.\n2. The e2e tests spawn real CLI child processes that inherit `process.env`; the neutralized values must be in the parent env (or in each spawn's env) or the children will still colorize. Several helpers already build `env: { ...process.env, … }`, so fixing the parent env covers them.\n\nDo NOT fix this by loosening the assertions to strip ANSI — that would discard the plain-output contract these tests exist to protect. Consider additionally one focused test that asserts color IS emitted when forced, so the capability stays covered."
---
