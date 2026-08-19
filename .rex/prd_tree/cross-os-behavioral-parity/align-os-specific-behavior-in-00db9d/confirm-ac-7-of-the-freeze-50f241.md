---
id: "50f24186-8c11-4eb2-bbca-9d83a731ab47"
level: "task"
title: "Confirm AC 7 of the freeze-verify-kill task: a POSIX CI run must actually execute the freeze policy green"
status: "in_progress"
priority: "medium"
tags:
  - "cross-os"
  - "process-lifecycle"
  - "llm-client"
  - "ci"
  - "verification"
source: "margin-audit-2026-08-19"
startedAt: "2026-08-19T16:32:56.191Z"
acceptanceCriteria:
  - "The branch carrying 14322618 is pushed and a full CI run completes on it — DONE 2026-08-19: required rebasing onto origin/main (2 new commits, 266 files) and force-pushing; branch now at 165da940, backup at backup/pre-main-rebase-windows-startup"
  - "The ubuntu-latest and macos-latest jobs both show the case passing, identified by name in the job log rather than inferred from a green total. The exact reporter string is \"exec timeout terminates the whole process tree — 'freeze-verify-kill (BETA)'\" — note the QUOTES around the policy name, verified against local output; grepping the unquoted form finds nothing"
  - "If that case did not run, the reason is found and fixed rather than assumed. Two candidate causes are already ruled out: run-all-tests.mjs discovers every package with a test script (llm-client included), and run-vitest-bind-aware.mjs applies exclusions only to the ROOT profile, so it cannot exclude a package integration test"
  - "Windows results are explicitly not counted as evidence, since the freeze parameter is inert there. Local Windows runs already pass all 6 cases — that proves the case is not filtered, and nothing about the freeze semantics"
  - "AC 7 on 71e44890 is recorded as satisfied with the CI run referenced, so the next reader does not have to re-establish whether it was ever proven"
description: "Closes the last open acceptance criterion of 71e44890-a3b3-4a24-aa15-4aefb94c8735 (Freeze-verify-kill: make the POSIX tree kill definitive for timeouts), which is marked completed but whose AC 7 reads:\n\n  \"Both branches are exercised on any host via injected seams, AND the POSIX path is\n   proven against real processes in CI — injected coverage alone is what let the\n   previous defect ship\"\n\nSTATUS 2026-08-19: AC 1 done. ACs 2-5 blocked on tooling, see BLOCKER below.\n\nTHE GAP IS NARROWER THAN IT LOOKS — checked, so nobody re-derives this:\n\nThe test already exists and is correctly wired. packages/llm-client/tests/integration/exec-timeout-tree-kill.test.ts (added by 14322618) runs describe.each over two policies, `{ freeze: undefined }` and `{ freeze: true }`, and passes `freeze` PER CALL rather than through the environment. So it does not depend on NDX_POSIX_FREEZE_KILL being set, and an ordinary CI run does enter the BETA freeze path against a real process tree. No CI configuration change is needed.\n\nCI does cover it: the ubuntu-latest and macos-latest jobs in .github/workflows/ci.yml both run `node scripts/run-all-tests.mjs packages`, llm-client's test script is plain `vitest run`, and its vitest config includes `tests/**/*.test.ts` — so tests/integration is in scope.\n\nVERIFIED LOCALLY: all 6 cases execute and pass on Windows, so the case is not being filtered out. That retires the risk behind AC 3 but proves nothing about freeze semantics, which are inert on Windows.\n\nBLOCKER — WHY THIS IS STILL OPEN: reading the CI run needs access this machine does not have. `gh` is not installed, no GH_TOKEN/GITHUB_TOKEN is set, and the repo is private so the Actions API cannot be queried unauthenticated. Local POSIX substitutes are also unavailable: WSL has only the docker-desktop utility distro and Docker's Linux daemon is not running. Unblock by any one of: (a) someone with CI access reads the run and reports it, (b) install `gh` or provide a token, (c) start Docker's Linux engine so the suite can run in a node:22 container — that is real POSIX evidence, though not literally \"in CI\".\n\nDO NOT ACCEPT A GREEN TOTAL AS PROOF. A passing overall run does not show that the freeze case executed rather than being skipped — a describe.each case that never ran leaves no trace in a summary line. Confirm it by name.\n\nCORRECTION to the original filing: it warned that run-vitest-bind-aware.mjs might exclude this suite. It cannot — that runner only takes exclusions for the ROOT profile, and this is a package test. Ruled out, not a live risk."
---
