---
id: "67ba89bb-f9b8-43b6-94da-22571a781d0d"
type: "task"
title: "Recover Codex work or review sessions that ended unfinished"
slug: "recover-codex-work-or-review-sessions"
description: "An unfinished work session or reviewer that stopped without its required report needs a bounded continuation; do not treat a missing report as a successful review or parse arbitrary shell ampersands as proof.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Supported unfinished-work/review signals receive one bounded continuation of the correct session."
  - "Missing review reports cannot masquerade as successful review; failed continuation yields an actionable failure."
  - "Recovery never repeats already completed task mutations or commits, widens policy or bypasses the test/review gate."
  - "Cover work, reviewer, interruption/cancellation and repeat-wait failure cases with disposable fixtures and supported-CLI evidence."
priority: "medium"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"PR5 task B only. High correctness risk: supported unfinished-work/reviewer signals, bounded continuation, cancellation and missing-report gate correctness. Assign heavy Astra execution and mandatory Astra self-review. User explicitly approved Astra execution WITH resumed Astra self-review for this task to exercise PR5 behavior; this supersedes historical fresh-review requirement for B only. Preserve vendor pins and all task A changes, batch continuation and pair repair. Current authority supersedes capture-only prose. One bounded continuation only, no completed mutation/commit replay, no recursive waits, no policy widening. No PR6-9 implementation or new capture; no subagents/nested reviews. DO NOT run pnpm test or scripts/run-all-tests.mjs inside executor/reviewer; Hench performs mandatory OUTER affected gate. Use scoped tests/builds/typechecks and required cli-dev/scheduler-startup. Read package instructions, public/generated/gateway policies and release-notes skill before scoped patch changeset. Preserve sandbox failures and use disposable external fixtures for actual selected-CLI evidence, keeping workspace-write/approval never and credential isolation. Hench owns claim/log/status/atomic completion via .hench-commit-msg.txt; exact staging only. Retain reviewOptional=false/skipTestGate=false, budgets and hostSlot."}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-5"
source: "ndx-capture"
blockedBy:
  - "5ee99eba-3cf2-4e55-bfdb-790ec442e22c"
---
