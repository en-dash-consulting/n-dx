---
id: "50f24186-8c11-4eb2-bbca-9d83a731ab47"
level: "task"
title: "Confirm AC 7 of the freeze-verify-kill task: a POSIX CI run must actually execute the freeze policy green"
status: "pending"
priority: "medium"
tags:
  - "cross-os"
  - "process-lifecycle"
  - "llm-client"
  - "ci"
  - "verification"
source: "margin-audit-2026-08-19"
acceptanceCriteria:
  - "The branch carrying 14322618 is pushed and a full CI run completes on it"
  - "The ubuntu-latest and macos-latest jobs both show the \"exec timeout terminates the whole process tree — freeze-verify-kill (BETA)\" case executing and passing, identified by name in the job log rather than inferred from a green total"
  - "If that case did not run, the reason is found (bind-aware exclusion, test filtering, package skipped) and fixed, rather than assumed to have run"
  - "Windows results are explicitly not counted as evidence, since the freeze parameter is inert there"
  - "AC 7 on 71e44890 is recorded as satisfied with the CI run referenced, so the next reader does not have to re-establish whether it was ever proven"
description: "Closes the last open acceptance criterion of 71e44890-a3b3-4a24-aa15-4aefb94c8735 (Freeze-verify-kill: make the POSIX tree kill definitive for timeouts), which is marked completed but whose AC 7 reads:\n\n  \"Both branches are exercised on any host via injected seams, AND the POSIX path is\n   proven against real processes in CI — injected coverage alone is what let the\n   previous defect ship\"\n\nTHE GAP IS NARROWER THAN IT LOOKS — checked 2026-08-19, so nobody re-derives this:\n\nThe test already exists and is correctly wired. packages/llm-client/tests/integration/exec-timeout-tree-kill.test.ts (added by 14322618) runs describe.each over two policies, `{ freeze: undefined }` and `{ freeze: true }`, and passes `freeze` PER CALL rather than through the environment. So it does not depend on NDX_POSIX_FREEZE_KILL being set, and an ordinary CI run does enter the BETA freeze path against a real process tree. No CI configuration change is needed.\n\nCI does cover it: the ubuntu-latest and macos-latest jobs in .github/workflows/ci.yml both run `node scripts/run-all-tests.mjs packages`, llm-client's test script is plain `vitest run`, and its vitest config includes `tests/**/*.test.ts` — so tests/integration is in scope.\n\nWHAT IS ACTUALLY MISSING: 14322618 has never run in CI, because it is unpushed. As of 2026-08-19 it sits in a long unpushed run on branch fix/windows-startup-and-setup. AC 7 says \"proven in CI\", and nothing has been proven until a POSIX job has executed it and reported green.\n\nSO THIS IS A VERIFY TASK, NOT A CODE TASK. Push, then read the run.\n\nWINDOWS GREEN IS NOT EVIDENCE. The freeze parameter is inert on Windows — there is no SIGSTOP, and the test's own comment says the second pass there only asserts that asking for freeze does not break the Windows path. Only the ubuntu and macOS jobs can satisfy AC 7.\n\nDO NOT ACCEPT A GREEN TOTAL AS PROOF. A passing overall run does not show that the `freeze-verify-kill (BETA)` case executed rather than being filtered or skipped — run-vitest-bind-aware.mjs excludes some suites, and a describe.each case that never ran leaves no trace in a summary line. Confirm that specific case by name in the job log."
---
