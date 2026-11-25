---
id: "5992c343-1ce0-4745-bdd7-efe08c8e3b5a"
type: "task"
title: "Finish truthful capability UX and cross-feature acceptance handoff"
slug: "finish-truthful-capability-ux-and"
description: "Approved Codex hardening follow-up, 2026-11-24. Users retain personal or company-provided Claude/Codex login and explicit binary/model/provider pins and organizational restrictions. Ordinary CLI use requires no separate API account/key. Excludes new billing/accounts, general API-model expansion, new OS keystores and direct API adversarial review. Preserve completed first-stack repairs. One owner per numbered PR; linear handoff only after committed work, required fresh distinct review, declared validation and stable interfaces. See docs/coordination/codex-hardening-stack.md for matrix, evidence and reconciliation. No global auth/config writes or parallel writers in one checkout.\n\n"
acceptanceCriteria:
  - "Real browser/CLI evidence shows effective supported capability, binary/version, vendor/model/provider and actionable refusal/help states for selected personal and managed configurations."
  - "Audit integration matrix, all must-fix/should-fix dispositions, final exact heads and passing declared gates plus required fresh distinct review; failed/absent/skipped evidence remains explicit."
  - "No feature is advertised as supported solely from mocked argv or historical task status; retain any unresolved criterion open and obtain explicit user approval before narrowing scope."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "codex-hardening"
  - "approved"
  - "slot-6"
source: "ndx-capture"
blockedBy:
  - "97acf4e3-73db-474a-9ee4-8f79e4b88241"
  - "5e12c9b2-f2d7-4933-a04e-6cfa15992879"
---
