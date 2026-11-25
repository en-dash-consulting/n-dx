---
id: "4fb6419e-6d59-4e91-836f-e759c79fe327"
type: "task"
title: "Exercise approved managed configuration without broadening trust"
slug: "exercise-approved-managed"
description: "Approved Codex hardening follow-up, 2026-11-24. Users retain personal or company-provided Claude/Codex login and explicit binary/model/provider pins and organizational restrictions. Ordinary CLI use requires no separate API account/key. Excludes new billing/accounts, general API-model expansion, new OS keystores and direct API adversarial review. Preserve completed first-stack repairs. One owner per numbered PR; linear handoff only after committed work, required fresh distinct review, declared validation and stable interfaces. See docs/coordination/codex-hardening-stack.md for matrix, evidence and reconciliation. No global auth/config writes or parallel writers in one checkout.\n\n"
acceptanceCriteria:
  - "Record a redacted concrete managed configuration: selected CLI/version, OS, managed profile/provider/deployment identifiers, auth mechanism and applicable organization restrictions."
  - "Production fresh/resumed turns preserve accepted selections; unsupported gateway OAuth/command auth or deployment forms refuse explicitly instead of falling back or executing arbitrary helpers."
  - "Reuse completed selected-provider isolation and catalog validation; no general opaque-model/API expansion, new account/key requirement or organizational restriction bypass."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "codex-hardening"
  - "approved"
  - "slot-5"
source: "ndx-capture"
blockedBy:
  - "9c0f7809-98cf-49be-a03a-3b1646c2e29a"
---
