---
id: "b19513b5-1573-4ba3-a5ad-b8c4a19e6616"
level: "task"
title: "Scale the web watcher-based integration waits with BUDGET_MULTIPLIER"
status: "completed"
priority: "medium"
tags:
  - "0.7.1"
  - "test-determinism"
  - "pr-t"
source: "2026-09-23 H-lane test session (feat/071-h-glossary-and-plain-language-titles)"
startedAt: "2026-09-25T05:32:10.766Z"
completedAt: "2026-09-25T05:39:34.145Z"
endedAt: "2026-09-25T05:39:34.145Z"
resolutionType: "code-change"
resolutionDetail: "Scaled the two fixed vi.waitFor timeouts (4s in worktrees-route.test.ts:317, 5s x5 in workspace-two-worktrees.test.ts) by BUDGET_MULTIPLIER; bumped each affected it()'s own vitest-level timeout above the accumulated internal wait budget so a genuine hang surfaces as vi.waitFor's own error rather than vitest's opaque one. Swept the rest of packages/web/tests/integration: no other vi.waitFor calls exist outside these two files."
acceptanceCriteria:
  - "Every vi.waitFor on a file-watcher event in packages/web/tests/integration derives its timeout from BUDGET_MULTIPLIER, including worktrees-route.test.ts and workspace-two-worktrees.test.ts."
  - "The web suite passes three consecutive full preflight runs on a loaded machine, documented in the PR."
  - "tests/unit/vitest-timeout-policy.test.js still passes."
description: "Two web integration tests wait a fixed time for a file-watcher event and fail under full-suite preflight load on macOS, while passing 5/5 in isolation (both observed 2026-09-23 on the H branch, which touches neither):\n\n- packages/web/tests/integration/worktrees-route.test.ts:317, 'a run file saved in another worktree pushes hench:run-changed without the Runs view' (added in #393): fixed 4s waitFor.\n- packages/web/tests/integration/workspace-two-worktrees.test.ts:102-124, 'editing B's PRD refreshes B's cache and broadcasts; A's cache is untouched' (from #369): fixed 5s waitFor calls.\n\nDerive every such wait from BUDGET_MULTIPLIER like the other load-sensitive tests, and sweep packages/web/tests/integration for other fixed vi.waitFor timeouts on watcher events. Test-only change, no changeset."
lastModified: "2026-09-25T05:39:34.514Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
