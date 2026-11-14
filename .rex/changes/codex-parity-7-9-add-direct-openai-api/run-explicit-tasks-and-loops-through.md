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
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-7"
source: "ndx-capture"
blockedBy:
  - "1fcb43cc-2d0a-4f0e-af5e-4ef6aad90829"
---
