---
id: "eb1e2cbe-d12f-4e5d-8038-9aefb0136be4"
type: "task"
title: "Run explicit tasks and loops through the direct OpenAI API provider"
slug: "run-explicit-tasks-and-loops-through"
description: "Use the new codec in hench rather than spawning a CLI under the label API. Keep CLI API-key authentication as its own supported option.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Hench accepts the Codex/OpenAI direct API provider and runs explicit tasks, sequential loops/queues and supported review settings through the API."
  - "Task claims, tool guard, trust/config precedence, test gates, retry/interruption/recovery, budgets and run accounting match applicable Claude API workflows."
  - "CLI/API discovery, init templates, dashboard provider controls and error messages reflect real support."
  - "Disposable integration fixtures demonstrate task completion, tool refusal, cancellation and failure without production task mutations."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"PR7 task B ONLY. High correctness risk in actual task/queue loops, tool guards, claims, trust, review, recovery, budgets and accounting. Heavy Astra execution with disposable integration fixtures must demonstrate actual API-loop execution, rather than a CLI relabel or text completion. Sol6.1 medium coordination verified. Heavy gpt-6-astra execution and mandatory fresh gpt-6.2-astra Codex self-review: distinct model identities prevent work-session reuse, both listed by selected CLI. Preserve all existing pins. Current user authorization supersedes historical capture-only prose. No later task, PR8/9, subagents, nested reviews or new captures. Do not push or publish from the executor; coordinator owns authorized draft publication. Never merge or enable auto-merge. Scope executor/reviewer checks; DO NOT run pnpm test or scripts/run-all-tests.mjs internally. Hench owns mandatory OUTER affected gate and hostSlot. Read current root/affected AGENTS, .rex/workflow.md, TESTING.md, public/generated/gateway policies and .claude/skills/ndx-release-notes/SKILL.md. Required cli-dev/scheduler-startup tests, focused regressions, changed-package builds/typechecks and scoped @n-dx patch changesets. No generated-cache edits. Do not run ndx init or shared config mutations during work. Preserve failure evidence and credential boundaries; no CLI fallback for API product paths. Product API fixture mocks are allowed, but distinguish them from live account/API evidence. Fresh official function-calling/Responses docs verified 2026-11-17 at https://developers.openai.com/api/docs/guides/function-calling ; current API contract, not Chat Completions assumptions. Never print credentials or put production transcripts into fixtures. No confinement bypass. Do not directly finalize status or commit: write .hench-commit-msg.txt so Hench owns exact staging/claims/logs/status and atomic source/PRD completion with final bare N-DX-Item trailer. One task/invocation, maxTurns200, mandatory review and outer gate remain enabled."}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-7"
source: "ndx-capture"
blockedBy:
  - "1fcb43cc-2d0a-4f0e-af5e-4ef6aad90829"
---
