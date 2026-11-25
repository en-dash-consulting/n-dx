---
id: "c06702da-6729-4f88-831f-cf016b95b984"
type: "task"
title: "Record native enforcement and secret-isolation evidence"
slug: "record-native-enforcement-and-secret"
description: "Approved Codex hardening follow-up, 2026-11-24. Users retain personal or company-provided Claude/Codex login and explicit binary/model/provider pins and organizational restrictions. Ordinary CLI use requires no separate API account/key. Excludes new billing/accounts, general API-model expansion, new OS keystores and direct API adversarial review. Preserve completed first-stack repairs. One owner per numbered PR; linear handoff only after committed work, required fresh distinct review, declared validation and stable interfaces. See docs/coordination/codex-hardening-stack.md for matrix, evidence and reconciliation. No global auth/config writes or parallel writers in one checkout.\n\n"
acceptanceCriteria:
  - "Disposable native CLI probes prove allowed/denied filesystem, network, shell/Git/tool and credential-canary behavior for execution and each supported reviewer path."
  - "Preserve policy through fresh/resume/fork/cancel/restart and record actual native outcomes separately from mocks, unsupported platforms and missing account access."
  - "Audit bd53209a against current behavior and document existing safe posture without silently choosing a key-exposure widening; any unresolved substantive policy choice stays open. Pass declared gates and mandatory distinct review."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "codex-hardening"
  - "approved"
  - "slot-2"
source: "ndx-capture"
blockedBy:
  - "04dc7d8a-253c-449f-8a9c-70fa5cfbb878"
---
