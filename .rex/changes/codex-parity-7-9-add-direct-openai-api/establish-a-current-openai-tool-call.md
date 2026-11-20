---
id: "1fcb43cc-2d0a-4f0e-af5e-4ef6aad90829"
type: "task"
title: "Establish a current OpenAI tool-call codec and truthful capabilities"
slug: "establish-a-current-openai-tool-call"
description: "Build the minimal provider request/event/tool-result contract required by an agent, using current official supported APIs rather than assuming a text Chat Completions provider is an agent loop.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Support current OpenAI tool-call request, response, streaming and error contracts for selected supported models, using Responses API where required."
  - "Round-trip tool calls/results through the existing vendor-neutral interfaces without claiming capabilities the implementation does not provide."
  - "Preserve authentication, trusted endpoints, usage/effort metadata and cancellation semantics; secrets never enter logs/tool children."
  - "Focused fixtures cover multi-step tool calls, tool failures, malformed responses and authentication failures."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"PR7 task A ONLY. High correctness risk in provider wire protocol, streamed event assembly, tool-result identity, authentication and cancellation. Heavy Astra execution with focused malformed/multistep/auth/error fixtures supplies explicit test oracles. Sol6.1 medium coordination verified. Heavy gpt-6-astra execution and mandatory fresh gpt-6.2-astra Codex self-review: distinct model identities prevent work-session reuse, both listed by selected CLI. Preserve all existing pins. Current user authorization supersedes historical capture-only prose. No later task, PR8/9, subagents, nested reviews or new captures. Do not push or publish from the executor; coordinator owns authorized draft publication. Never merge or enable auto-merge. Scope executor/reviewer checks; DO NOT run pnpm test or scripts/run-all-tests.mjs internally. Hench owns mandatory OUTER affected gate and hostSlot. Read current root/affected AGENTS, .rex/workflow.md, TESTING.md, public/generated/gateway policies and .claude/skills/ndx-release-notes/SKILL.md. Required cli-dev/scheduler-startup tests, focused regressions, changed-package builds/typechecks and scoped @n-dx patch changesets. No generated-cache edits. Do not run ndx init or shared config mutations during work. Preserve failure evidence and credential boundaries; no CLI fallback for API product paths. Product API fixture mocks are allowed, but distinguish them from live account/API evidence. Fresh official function-calling/Responses docs verified 2026-11-17 at https://developers.openai.com/api/docs/guides/function-calling ; current API contract, not Chat Completions assumptions. Never print credentials or put production transcripts into fixtures. No confinement bypass. Do not directly finalize status or commit: write .hench-commit-msg.txt so Hench owns exact staging/claims/logs/status and atomic source/PRD completion with final bare N-DX-Item trailer. One task/invocation, maxTurns200, mandatory review and outer gate remain enabled."}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-7"
source: "ndx-capture"
blockedBy:
  - "59ef46ac-3cae-43e7-89e0-c327f28ef32b"
---
