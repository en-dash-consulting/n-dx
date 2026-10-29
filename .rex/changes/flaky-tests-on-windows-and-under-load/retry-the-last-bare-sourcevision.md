---
id: "11c9e658-ff8b-43a2-9d27-bd2d99155059"
type: "task"
title: "Retry the last bare .sourcevision removal in the sv analyze e2e test"
slug: "retry-the-last-bare-sourcevision"
description: "GitHub #611. The EBUSY in packages/sourcevision/tests/e2e/cli-analyze.test.ts was in afterEach after the win32-only \"reports the running file a terminated analyze left behind as interrupted\" test. That part is already fixed on main by b98137931 (2026-10-14), which gave afterEach's rm `maxRetries: 10, retryDelay: 100`; the issue was left open.\n\nWhat remains: the one bare removal left in the file, `await rm(svDir, { recursive: true })` (around line 271). It is in \"produces deterministic output\", not in the win32 test: it removes .sourcevision between two `sv analyze` runs. The child there ran through execFileSync and has exited, so this is the weaker case (antivirus or the indexer still holding a freshly written file), but it is the same EBUSY class and the same cheap fix.\n\nFix: give that rm `maxRetries: 10, retryDelay: 100` with a one-line comment. Also check the issue's second hypothesis: confirm from the source whether `sv analyze --fast` starts any child process that could outlive the parent's termination and hold the temp dir. Record the answer in the completion note; if it does, stop and say so rather than adding a tree kill.\n\nTest-only: change the test file(s) named here and nothing in product code. If the flake turns out to be a real product bug, stop and record that instead of fixing the product. These flakes do not reproduce on macOS, so the fix must be correct from the failure as recorded; where cheap, force the condition locally to show the old test fails and the new one passes."
acceptanceCriteria:
  - "Closes #611"
  - "No rm/rmSync in packages/sourcevision/tests/e2e/cli-analyze.test.ts runs without maxRetries/retryDelay"
  - "The completion note says whether sv analyze --fast spawns a child process that could outlive a terminated parent, with the file that shows it"
  - "No product file under packages/sourcevision/src changes"
  - "The file passes locally: npx vitest run --root packages/sourcevision tests/e2e/cli-analyze.test.ts"
priority: "medium"
tags:
  - "flaky-test"
  - "ci-reliability"
  - "issue-cleanup"
source: "ndx-capture"
---
