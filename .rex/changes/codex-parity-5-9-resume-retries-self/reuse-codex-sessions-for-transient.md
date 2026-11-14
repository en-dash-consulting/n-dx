---
id: "5ee99eba-3cf2-4e55-bfdb-790ec442e22c"
type: "task"
title: "Reuse Codex sessions for transient retries and self-review"
slug: "reuse-codex-sessions-for-transient"
description: "Replace the Claude-only gates only where the selected Codex CLI can safely honor resume. Keep batch and pair repair behavior and prior attempt state.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Correct Codex work session resumes for a transient retry and for self-review instead of a fresh context-only spawn."
  - "Worktree, branch, model and execution-policy identity changes invalidate reuse; every resumed spawn reapplies current policy and credential isolation."
  - "Bounded fallback avoids replaying completed work or recursively resuming a failed resume; retry budgets and review gates remain effective."
  - "Tests establish both argv and session continuity on a supported real CLI, reporting untested versions separately."
priority: "medium"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-5"
source: "ndx-capture"
blockedBy:
  - "12757fc1-b8c4-4708-945a-069398d311f7"
---
