---
id: "bc1816c6-3449-4d0f-b48a-a87347104a58"
type: "task"
title: "Verify managed execution and Sidecar lifecycle boundaries"
slug: "verify-managed-execution-and-sidecar"
description: "Approved Codex hardening follow-up, 2026-11-24. Users retain personal or company-provided Claude/Codex login and explicit binary/model/provider pins and organizational restrictions. Ordinary CLI use requires no separate API account/key. Excludes new billing/accounts, general API-model expansion, new OS keystores and direct API adversarial review. Preserve completed first-stack repairs. One owner per numbered PR; linear handoff only after committed work, required fresh distinct review, declared validation and stable interfaces. See docs/coordination/codex-hardening-stack.md for matrix, evidence and reconciliation. No global auth/config writes or parallel writers in one checkout.\n\n"
acceptanceCriteria:
  - "Existing authorized company access exercises execution, required self/pair review where supported, worktree Sidecar and admitted hub across fresh/resume/fork/cancel/restart."
  - "Capture redacted real-account evidence separately from fixtures and confirm secret isolation, managed restrictions and operator broker cards persist."
  - "Keep fc02c0b7 and dependent criteria open without actual Azure proof unless user explicitly narrows scope; pass declared gates and distinct review."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "codex-hardening"
  - "approved"
  - "slot-5"
source: "ndx-capture"
blockedBy:
  - "fc02c0b7-84e9-4f2f-9bf0-62687ac0933b"
---
