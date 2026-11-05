---
id: "92778152-9bb1-45cb-96ee-78733ea82659"
type: "change"
title: "hench check-runs --worktree refuses a mis-cased or 8.3 path to a real worktree"
slug: "hench-check-runs-worktree-refuses-a"
intent: "Out-of-scope finding from the adversarial review of bebe402c (queue planner counts runs across worktrees); pre-existing. Verdict: real, low severity, worth a cheap fix.\n\nScenario: on a case-insensitive filesystem (macOS default APFS, Windows), `hench check-runs --worktree=/USERS/me/repo/wt .` (or a Windows 8.3 short path such as C:\\Users\\RUNNER~1\\...) exits with \"No worktree of this repository contains ...\" although the path names a listed worktree.\n\nEvidence: packages/hench/src/cli/commands/check-runs.ts:86 `canonical()` uses `realpathSync`, which keeps the caller's case and short names, while `listWorktrees` (packages/llm-client/src/exec.ts:754 canonicalizeGitPath) uses `realpathSync.native`, which returns on-disk case and long names. narrowToWorktree (check-runs.ts:105) then compares the two strings and finds no match.\n\nReachable via the `hench check-runs --worktree=<path>` / `ndx hench check-runs` CLI.\n\nFix: use `realpathSync.native` in check-runs' canonical(), as packages/hench/src/cli/commands/plan-queue.ts now does (same defect fixed there in this review). Cost: one line plus a test that skips on case-sensitive filesystems. Risk: none known; .native is what the listed paths already use."
acceptanceCriteria:
  - "On a case-insensitive filesystem, hench check-runs --worktree=<upper-cased path of a listed worktree> audits that worktree instead of exiting with 'No worktree of this repository contains'"
  - "A check-runs test passes a differently cased worktree path and asserts the narrowed audit; it skips on a case-sensitive filesystem and fails against the current realpathSync canonical()"
touches:
  - "00db9d79-324d-4b64-acb7-e65deaa43b06"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
