---
id: "31305bd0-32ee-46b0-b5dd-c686b869076d"
type: "change"
title: "Start a branch rollback deletes a concurrent successful PRD capture"
slug: "start-a-branch-rollback-deletes-a"
intent: "Finding 1, PR #1016. packages/web/src/server/routes-rex/branch-start.ts:306 releases the assignment PRD transaction before git add/commit, and rollBack():336-338 resets/checks out/cleans the complete changes/ and product/ roots. A writer can save a new change successfully during a slow pre-commit hook; if the hook then fails, rollback deletes that saved change. Reproduced against 1316e0bf1: hold a failing pre-commit hook with a signal file, create a change with withPrdModelTransaction/addChangeNode after the hook starts, verify it is present, release the hook to exit 1, observe HTTP 500, main checked out clean, and the new change absent. Evidence: /private/tmp/ndx-review-rollback-race.mjs and .log. Recommend serializing the full branch mutation with the shared PRD-write lock and limiting rollback to operation-owned changes. A snapshot of a formerly clean checkout is not ownership of every later write. Alternative: detect concurrent changes and leave a recoverable branch/state instead of destructive cleanup; document the choice. This is the largest fix and needs real concurrent-writer coverage.\n\nOwning PR: https://github.com/en-dash-consulting/n-dx/pull/1016\nReviewed head: 1316e0bf157fea68902d327ba9bdc1fdafe04214\n\nApproved by Ryan on 2026-11-09 after the nine-PR stack review. This is remediation, not permission to merge, publish, restack, or change unrelated code. Execute only in a dedicated worktree based on the owning PR head; the coordination branch contains capture metadata only. One item per ndx work execution. Use Codex CLI and Codex self-review, never fall back to Claude; keep the affected test gate enabled. The coordinator integrates fixes into the owning PR and performs one bottom-up restack after remediation; individual workers must not restack or force-push the stack."
acceptanceCriteria:
  - "A deterministic regression reproduces a successful PRD capture during a branch-start commit failure and verifies that the capture remains in the PRD and on disk after the failure."
  - "The shared PRD transaction/locking contract serializes or safely refuses other writers for the entire assignment, commit and rollback operation; no nested-lock deadlock is introduced."
  - "Rollback removes only operation-owned writes and does not run broad destructive cleanup against another writer's changes."
  - "Successful clean starts, dirty/live-run create-only starts, and safe failure recovery remain covered; scoped web tests and required root checks pass; add scoped patch changesets."
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "critical"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"skipTestGate":false}
tags:
  - "pr-stack-review"
  - "codex-remediation"
  - "finding-1"
  - "pr-1016"
source: "ndx-adversarial-review"
---
