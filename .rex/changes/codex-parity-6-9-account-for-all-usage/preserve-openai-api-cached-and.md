---
id: "bc6b57ed-338a-4d0d-b776-e2019a5de6fd"
type: "task"
title: "Preserve OpenAI API cached and streaming token usage"
slug: "preserve-openai-api-cached-and"
description: "Fix the audit-observed API parser/cache and streaming inclusion gaps separately from the future agent loop.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Preserve cached input and any supported cache-write categories without counting them twice inside total input."
  - "Request and retain final streaming usage; partial/missing usage gets honest diagnostic provenance."
  - "Blocking and streaming responses normalize to the same token contract and pricing inputs."
  - "Disposable mocked/API fixtures cover cached, uncached, partial, absent and interrupted streams; never require production task mutations."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"PR6 task C only. High correctness risk in monetary accounting, cached/uncached normalization, final streaming usage and interrupted/missing provenance. Heavy Astra execution is justified by stream/error semantics across blocking and streaming contracts. Disposable mocked API fixtures only; no direct API agent loop or live production calls. Official https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events was fetched by coordinator and documents include_usage plus possible missing final usage on interrupted streams. Sol medium coordination. Heavy Astra execution; mandatory Astra self-review through Hench. User explicitly approved resumed Astra self-review for PR6. Preserve all vendor pins, reviewOptional=false and skipTestGate=false. Current authorization supersedes capture-only historical prose. No later task execution, PR7-9 implementation or new captures. Do not spawn subagents or nested reviews. Scope executor/reviewer tests; DO NOT run pnpm test or scripts/run-all-tests.mjs inside executor/reviewer. Hench owns mandatory OUTER affected gate/hostSlot. Read affected AGENTS, gateways/public/generated policies and .claude/skills/ndx-release-notes/SKILL.md. Required cli-dev and scheduler-startup tests, meaningful regressions, changed builds/typechecks and scoped patch changesets. Preserve truthful sandbox failures, no confinement bypass/Claude or API fallback, no credential exposure. Disposable external fixtures only. Do not directly finalize status/commit: write .hench-commit-msg.txt for Hench atomic source/PRD completion, exact staging only. One task/invocation; maxTurns200 and budgets retained."}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-6"
source: "ndx-capture"
blockedBy:
  - "869bcab8-bc97-42e9-9eb6-4a72c95a49e0"
---
