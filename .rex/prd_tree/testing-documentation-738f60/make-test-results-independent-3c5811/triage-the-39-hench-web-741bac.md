---
id: "741bacf1-0314-4bc3-8f50-400e8c673bfb"
level: "task"
title: "Triage the 39 hench/web failures now that the run no longer hides them"
status: "pending"
priority: "high"
tags:
  - "testing"
  - "ci"
  - "flakiness"
  - "hench"
  - "web"
  - "visibility"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "The first CI run after the masking fix is read, and it is recorded whether the hench/web failures reproduce on ubuntu or are Windows-specific"
  - "The 32 hench failures are triaged with causes recorded; a shared root cause is proven rather than assumed"
  - "The 7 web failures are triaged with causes recorded"
  - "Any Windows-specific failure is identified as such rather than treated as universal"
  - "No failure is resolved by re-hiding it — skips must cite a concrete reason"
description: "MASKING IS FIXED — that half of this task is done. What remains is triaging the failures it exposed.\n\nWHAT WAS FIXED. `pnpm test` was `run-vitest-bind-aware.mjs root && pnpm -r run test`, which hid failures two ways: `&&` meant a red root suite skipped every package, and `pnpm -r run` bails on the first failing package. Because hench and web depend on rex, they were ordered after it, so rex's load-sensitive tests failing meant neither ever executed — and their absence from the output read as \"nothing to report\" rather than \"never ran\".\n\n`pnpm -r --no-bail run test` was rejected as the fix: pnpm documents --no-bail as exiting 0 even when a script fails, which would have turned a red suite green. That is worse than the masking, since the old exit code was at least honest.\n\nReplaced with scripts/run-all-tests.mjs, which runs each suite independently, never short-circuits, prints a per-suite PASS/FAIL summary, and exits non-zero if any failed. It takes an optional scope (all | root | packages). The CI validate job now runs `node scripts/run-all-tests.mjs packages` instead of `pnpm -r run test`, so CI has the same visibility.\n\nFIRST COMPLETE PICTURE (Windows 11, local):\n  root (tests/**)     2070 passed, 0 failed\n  @n-dx/hench         2851 passed, 32 FAILED  (12 of 151 files)\n  @n-dx/llm-client    1213 passed, 0 failed\n  @n-dx/rex           4416 passed,  2 FAILED  (the known ambient-load set, task 676af18f)\n  @n-dx/sourcevision  1691 passed, 0 failed\n  @n-dx/web           2864 passed,  7 FAILED  (4 of 176 files)\n  => 14,705 passing, 41 failing across 6 suites. Before the fix `pnpm test` only ever\n     reached about 9,400 tests; hench's 2,883 and web's 2,909 never ran at all.\n\nREMAINING WORK — triage the 32 hench and 7 web failures. Established so far, and no further:\n- They are NOT color-related: each suite was run with FORCE_COLOR=3 COLORTERM=truecolor and with both unset, and the counts were byte-identical.\n- They PRE-DATE the color work: hench was re-run with that entire changeset stashed (git stash -u) and produced the same 32 failures across the same 12 files.\n- Their cause is otherwise UNINVESTIGATED. Do not assume a single root cause.\n\nKEY UNKNOWN — are they Windows-specific? Every measurement above was taken on Windows 11. Per the Cross-OS Behavioral Parity epic, the suite has only ever executed on ubuntu in CI, and CI was masking these packages anyway. So it is genuinely unknown whether main is red on ubuntu too. The first CI run after this change answers it, and that answer should be recorded here before triaging individual failures — if they are Windows-only, that reframes the work substantially."
---
