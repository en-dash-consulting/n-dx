---
id: "6512dd4c-adad-4e77-a136-6a743bc55e6f"
type: "task"
title: "Execute bounded failover for OpenAI API runs"
slug: "execute-bounded-failover-for-openai"
description: "Extend actual failover execution after the OpenAI API loop exists; a declared chain alone is not support.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "With failover enabled, retryable OpenAI API failures walk the supported configured model/vendor chain within finite budgets."
  - "Non-retryable errors are handled explicitly; exhausted failover restores original selection and original-error behavior."
  - "Every switch records the effective vendor/model, reason, usage and cost without leaking credentials."
  - "Disabled failover is a no-op; cross-vendor requests use each provider's correct message/tool format."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"PR7 Task C ONLY: bounded actual direct-API failover. High correctness risk in finite retries/model/vendor budgets, original selection/error restoration, reason and spend recording, and cross-vendor tool/history formats; heavy gpt-6-astra execution with mandatory fresh gpt-6.2-astra review is warranted. Testability comes from deterministic disposable synthetic API/failure-chain fixtures through the actual agent loop, not a declared chain or text completion alone. Preserve all model/reviewer/vendor pins; current user explicitly says one task at a time and skip intensive test gateways USING CLI FLAG --skip-test-gate. That latest instruction supersedes historical mandatory outer-gate prose; keep fresh mandatory review and scoped checks, required cli-dev/scheduler-startup, changed builds/typechecks and scoped patch changesets. Saved skipTestGate=false may remain; CLI --skip-test-gate intentionally overrides it. Never run pnpm test or scripts/run-all-tests.mjs internally. Do not unset truthful sandbox markers or weaken Codex workspace-write/never/network-disabled/credential-hiding controls. No subagents/nested reviews/new captures/PR8/9. Read current task/parent/full criteria, root and package AGENTS, workflow, public/generated/gateway/release-notes policies. Prior TaskB source checkpoints are now completed via run bcd9519d/commitf3d4e269; explicit queue and sequential loop, guards/cancellation/accounting tests exist. Maintain existing Claude behavior, disabled-failover no-op, nonretryable refusal, bounded exhausted original-error behavior, per-switch vendor/model/reason/usage/cost without secrets, correct tool formats, and restore selection. Fixtures must stay disposable without production PRD mutation. Current official Responses/function-calling guide fetched2026-11-17; no live API entitlement established. Implementation must use actual ndx work only. Hench owns claims/logs/status/final atomic commit: write .hench-commit-msg.txt with bare N-DX-Item trailer. Do not push/publish from executor; coordinator owns authorized draft against verifiedPR6. Never merge/auto-merge or execute PR8. Sol6.1 medium coordination, maxTurns200; actual selected Codex0.167.0-alpha.3.2/ChatGPT auth."}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-7"
source: "ndx-capture"
blockedBy:
  - "eb1e2cbe-d12f-4e5d-8038-9aefb0136be4"
---
