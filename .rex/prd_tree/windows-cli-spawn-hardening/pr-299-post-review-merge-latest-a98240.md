---
id: "a982403d-1c67-40aa-935a-db35def424e2"
level: "task"
title: "PR #299 post-review: merge latest main (Hal's #298 overlap) and review cleanup"
status: "completed"
priority: "medium"
tags:
  - "windows"
  - "pr-299"
  - "merge"
  - "review-cleanup"
startedAt: "2026-07-15T16:59:29.769Z"
completedAt: "2026-07-15T16:59:29.769Z"
endedAt: "2026-07-15T16:59:29.769Z"
resolutionType: "code-change"
resolutionDetail: "Done collaboratively in-session (not via hench — trivial chore-level edits; hench avoided due to live #303 rollback risk). Merge commit 98df3c59 + cleanup commit; CI-validated on the merged head."
acceptanceCriteria: []
description: "Merged origin/main (Hal's #298 + #295) into the branch after #299 went CONFLICTING (merge commit 98df3c59, no rebase). #298 independently implemented codex stdin delivery and Windows spawn-compat workarounds; reconciliation kept the spawn-hardening helpers as the canonical pattern: rewrote main's windows-spawn-compat.test.js to assert execFileSyncCli/win-spawn.js routing instead of the legacy execFileSync+shell:win32 pattern; removed a merge-hybrid shell:process.platform option from the pair-programming execFileSyncCli call (caught by the DEP0190 guard); unioned llm-gateway export caps (134→142, +isAuthError from main) and contract-test lists; dropped superseded NOT_FOUND_PATTERNS in cli-provider.ts in favor of diagnoseCliNotFound while keeping main's classifyAuthError + cleanResultMessage. Post-approval review cleanup (4-angle simplify pass): deleted unreferenced smoke fixtures claude.args/codex.args from repo root, reverted dogfood-only .hench/config.json changes (fullTestCommand, pnpm allowlist, 600s timeout) out of the PR, condensed the doubled stdin-rationale comment in codex-cli-adapter.ts buildSpawnConfig. Verified: build green, root spawn/policy/contract suites, llm-client, hench adapter suites; CI green on merged head (Build & Validate, Windows/macOS smoke, parity); live claude.cmd/codex.cmd spawn via spawnCli on Windows."
---
