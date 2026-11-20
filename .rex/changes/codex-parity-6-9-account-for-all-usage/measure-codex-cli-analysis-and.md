---
id: "6ea1141c-9080-44a8-8442-1d67846b8de0"
type: "task"
title: "Measure Codex CLI analysis and planning token usage"
slug: "measure-codex-cli-analysis-and"
description: "Use structured CLI usage without losing the final text consumed by rex/sourcevision. The audit fake CLI emitted turn.completed usage but createCodexCliClient returned only text.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Consume structured CLI usage while retaining the exact text result for analysis/plan callers."
  - "Preserve cached/uncached distinctions and prevent double counting replayed or cumulative counters."
  - "Unavailable or malformed usage is explicitly distinguishable from measured zero; retries and failures do not erase measured spend."
  - "Rex/sourcevision ledgers, dashboard rollups and budget consumers receive measured usage; include fake-binary and real supported-CLI evidence."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"PR6 task A only. High correctness risk: spend/accounting across structured CLI events, replay/cumulative dedupe, cached versus uncached tokens, retries/failures and Rex/sourcevision/dashboard/budget consumers. Heavy Astra execution with mandatory fresh Astra self-review through Hench; Sol medium coordination. Preserve vendor pins and exact result text. Current authorization supersedes historical capture-only prose. No tasks B-D until separately assigned; no PR7 API-agent loop, PR8 policy or PR9 implementation/new capture. Do not spawn subagents or nested reviews. Scope executor/reviewer validation: DO NOT run pnpm test or scripts/run-all-tests.mjs; Hench owns mandatory OUTER affected gate. Read affected AGENTS.md, gateways/public/generated policies and .claude/skills/ndx-release-notes/SKILL.md. Run meaningful scoped tests/builds/typechecks plus required cli-dev and scheduler-startup suites. Keep truthful sandbox failures; no bypass or credential exposure. Disposable external fixtures only; distinguish synthetic fixtures from real selected-CLI usage evidence. Coordinator reverified selected CLI0.167.0-alpha.3.2 and ChatGPT sign-in; official https://learn.chatgpt.com/docs/non-interactive-mode and https://developers.openai.com/api/docs/guides/reasoning fetched 2026-11-16. Keep workspace-write/approval never and credential hiding. No direct task-status/commit finalization: write .hench-commit-msg.txt for Hench atomic source/PRD commit with exact staging. Retain reviewOptional=false/skipTestGate=false, hostSlot, maxTurns200 and retry budgets."}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-6"
source: "ndx-capture"
blockedBy:
  - "a1e20ed5-e3cd-489e-8978-5bd2f46a52ea"
---
