---
id: "eee22417-50e4-41a3-8749-cd55f3190d8a"
level: "task"
title: "Bypass commit message approval when ndx work runs with --auto or --loop"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "agent"
  - "cli"
source: "smart-add"
startedAt: "2026-04-23T03:15:37.947Z"
completedAt: "2026-04-23T03:25:03.702Z"
resolutionType: "code-change"
resolutionDetail: "Added `autonomous` flag to SharedLoopOptions/FinalizeRunOptions, computed as `auto || loop || epicByEpic` in run.ts, and propagated it through runOne → cliLoop/agentLoop → finalizeRun → performCommitPromptIfNeeded. The approval prompt is now bypassed when either `yes` or `autonomous` is set (same mechanism that already gates task autoselect). Exported performCommitPromptIfNeeded for direct unit testing; new integration test packages/hench/tests/integration/commit-prompt.test.ts covers three cases: autonomous bypass (commits using the proposed message, no prompt), interactive path (readline is invoked and user decision respected), and --yes bypass. All 2483 hench tests pass; typecheck clean across the monorepo. Two pre-existing zone-cohesion e2e failures (tick zone cohesion 0.44 < 0.5; stale `sync` entry in COHESION_EXCEPTIONS) are unrelated to this change — verified against git stash. No commit-config toggle was introduced; reused existing auto/loop flag state per AC #4."
acceptanceCriteria:
  - "ndx work --auto completes commits without prompting for commit message approval"
  - "ndx work --loop completes commits without prompting for commit message approval"
  - "ndx work (no auto/loop flags) still prompts for commit message approval as before"
  - "The bypass is driven by the same flag state that governs other autonomous behaviors, not a separate toggle"
  - "Unit or integration test covers both the bypass and the interactive path"
description: "The hench agent's commit workflow currently prompts the user to approve generated commit messages before finalizing a commit. In autonomous modes (--auto, --loop), there is no interactive user to respond, causing runs to hang or time out. Detect these flags at the point the commit-approval check is invoked and skip the prompt, falling back to the generated commit message without confirmation. Preserve the existing interactive behavior for normal (non-autonomous) runs."
---

# Bypass commit message approval when ndx work runs with --auto or --loop

🟠 [completed]

## Summary

The hench agent's commit workflow currently prompts the user to approve generated commit messages before finalizing a commit. In autonomous modes (--auto, --loop), there is no interactive user to respond, causing runs to hang or time out. Detect these flags at the point the commit-approval check is invoked and skip the prompt, falling back to the generated commit message without confirmation. Preserve the existing interactive behavior for normal (non-autonomous) runs.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** hench, agent, cli
- **Level:** task
- **Started:** 2026-04-23T03:15:37.947Z
- **Completed:** 2026-04-23T03:25:03.702Z
- **Duration:** 9m
