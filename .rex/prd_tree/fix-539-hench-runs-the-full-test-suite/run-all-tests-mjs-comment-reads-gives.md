---
id: "9ba04857-60e6-4f9c-97ba-844afee2b8a4"
level: "task"
title: "run-all-tests.mjs comment reads \"gives to give us\" after the execFileSyncCli change"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "scripts"
  - "539"
source: "ndx-adversarial-review"
startedAt: "2026-10-06T22:12:31.980Z"
completedAt: "2026-10-06T22:21:12.239Z"
endedAt: "2026-10-06T22:21:12.239Z"
resolutionType: "code-change"
resolutionDetail: "Fixed comment in scripts/run-all-tests.mjs to clearly explain spawn error handling. Changed 'gives us by throwing' to 'just as a throwing synchronous spawn would be.' Validated with vitest: tests/integration/run-all-tests-selection.test.js passes (7 tests)."
acceptanceCriteria:
  - "The comment above the spawn error handler in scripts/run-all-tests.mjs reads as a correct sentence describing why a spawn that never starts is a failed suite."
description: "Verdict: should-fix (low). It is cosmetic, but the comment explains why a failed spawn counts as a failed suite, and in its current form it does not parse.\n\n**Evidence.** `scripts/run-all-tests.mjs:101-102` reads \"A spawn that never starts is a failed suite, not an absent one — the behaviour `execFileSyncCli` gives to give us by throwing.\" The follow-up task e511ac94 left it half-rewritten while replacing `execFileSync`.\n\n**Fix.** Make it say what it means. The `child.on(\"error\")` handler below the comment records a spawn error as a failed suite, as a throwing sync call would have. For example: \"A spawn that never starts is a failed suite, not an absent one, just as a throwing synchronous spawn would be.\"\n\nNo behaviour change. Validation: `node_modules/.bin/vitest run tests/integration/run-all-tests-selection.test.js`. Do not run the full suite."
lastModified: "2026-10-06T22:21:12.681Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
