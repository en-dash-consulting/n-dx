---
id: "b19513b5-1573-4ba3-a5ad-b8c4a19e6616"
level: "task"
title: "Scale the web watcher-based integration waits with BUDGET_MULTIPLIER"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "test-determinism"
  - "pr-t"
source: "2026-09-23 H-lane test session (feat/071-h-glossary-and-plain-language-titles)"
acceptanceCriteria:
  - "Every vi.waitFor on a file-watcher event in packages/web/tests/integration derives its timeout from BUDGET_MULTIPLIER, including worktrees-route.test.ts and workspace-two-worktrees.test.ts."
  - "The web suite passes three consecutive full preflight runs on a loaded machine, documented in the PR."
  - "tests/unit/vitest-timeout-policy.test.js still passes."
description: "Two web integration tests wait a fixed time for a file-watcher event and fail under full-suite preflight load on macOS, while passing 5/5 in isolation (both observed 2026-09-23 on the H branch, which touches neither):\n\n- packages/web/tests/integration/worktrees-route.test.ts:317, 'a run file saved in another worktree pushes hench:run-changed without the Runs view' (added in #393): fixed 4s waitFor.\n- packages/web/tests/integration/workspace-two-worktrees.test.ts:102-124, 'editing B's PRD refreshes B's cache and broadcasts; A's cache is untouched' (from #369): fixed 5s waitFor calls.\n\nDerive every such wait from BUDGET_MULTIPLIER like the other load-sensitive tests, and sweep packages/web/tests/integration for other fixed vi.waitFor timeouts on watcher events. Test-only change, no changeset."
lastModified: "2026-09-24T00:27:19.563Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
