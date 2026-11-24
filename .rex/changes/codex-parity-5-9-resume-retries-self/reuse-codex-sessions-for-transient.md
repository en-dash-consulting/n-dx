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
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"PR5 task A only. High correctness risk: resuming the correct work session across transient retries/self-review, identity invalidation, policy and credential isolation, no completed-work replay or recursive failed resumes. Heavy Astra executor; mandatory fresh Astra medium self-review through Hench. Preserve all vendor pins, batch continuation and pair repair. Current authorization supersedes historical capture-only prose. No task B unfinished recovery until separately assigned; no PR6-9 implementation or new capture. Do not spawn subagents or nested reviews. Scope tests to changed behavior; DO NOT run pnpm test or scripts/run-all-tests.mjs inside executor/reviewer: Hench runs the mandatory OUTER affected gate. Read package AGENTS and gateway/public/generated policies and .claude/skills/ndx-release-notes/SKILL.md before patch changeset. Run scoped tests/builds/typechecks plus required cli-dev and scheduler-startup checks. Preserve truthful sandbox failures without bypassing confinement. Use disposable external fixtures for supported-CLI continuity evidence; keep workspace-write/approval never and credential hiding. Official guidance https://learn.chatgpt.com/docs/developer-commands verified by coordinator. Do not alter task status/commit directly: deliver .hench-commit-msg.txt for Hench atomic source/PRD completion; exact staging only. Retain reviewOptional=false/skipTestGate=false, hostSlot and retry budgets."}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-5"
source: "ndx-capture"
blockedBy:
  - "12757fc1-b8c4-4708-945a-069398d311f7"
---
