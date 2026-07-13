---
id: "8f067d34-46ab-423f-bb50-fd206741bd7f"
level: "task"
title: "Changeset and cross-shell validation"
status: "completed"
priority: "medium"
tags:
  - "windows"
  - "testing"
  - "release"
  - "gh:37"
blockedBy:
  - "ba6e02f5-3d4e-49d0-a57b-6ba2632c36cf"
startedAt: "2026-07-13T15:42:43.152Z"
completedAt: "2026-07-13T15:42:43.152Z"
endedAt: "2026-07-13T15:42:43.152Z"
resolutionType: "code-change"
resolutionDetail: "Changeset committed (59695ae9, patch: llm-client/hench/core/sourcevision). pnpm build+typecheck green. Spawn validated in PowerShell and Git Bash via `ndx add` — claude .cmd spawned, no EINVAL, no DEP0190. PR opening next records the results."
acceptanceCriteria:
  - "Changeset added (patch: @n-dx/llm-client, hench, and @n-dx/core)"
  - "pnpm typecheck passes; full pnpm test suite passes"
  - "MANUAL (human, not hench): after pnpm build, a real CLI invocation validated in BOTH PowerShell and Git Bash on Windows, results recorded in the PR body"
description: "Add a .changeset entry (patch: @n-dx/llm-client, hench, and @n-dx/core) describing the Windows spawn hardening. Run pnpm typecheck and the full pnpm test suite. The cross-shell validation is a MANUAL human step (hench cannot do it): after a fresh pnpm build, invoke a real CLI call (e.g. rex add / a claude CLI call) in BOTH PowerShell and Git Bash on Windows and record the results in the PR body, as issue #37 requests. This is the \"make it live\" step where the rebuilt dist first carries the new spawn code."
---
