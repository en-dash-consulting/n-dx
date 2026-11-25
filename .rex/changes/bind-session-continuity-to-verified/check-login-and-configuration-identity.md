---
id: "262fd7de-b9da-4954-9cc8-bd159e25e3de"
type: "task"
title: "Check login and configuration identity before session reuse"
slug: "check-login-and-configuration-identity"
description: "Approved Codex hardening follow-up, 2026-11-24. Users retain personal or company-provided Claude/Codex login and explicit binary/model/provider pins and organizational restrictions. Ordinary CLI use requires no separate API account/key. Excludes new billing/accounts, general API-model expansion, new OS keystores and direct API adversarial review. Preserve completed first-stack repairs. One owner per numbered PR; linear handoff only after committed work, required fresh distinct review, declared validation and stable interfaces. See docs/coordination/codex-hardening-stack.md for matrix, evidence and reconciliation. No global auth/config writes or parallel writers in one checkout.\n\n"
acceptanceCriteria:
  - "Trace production login/config/provider/workspace provenance and add nonsecret identity fingerprint tests for login change, selected binary/version change and config drift."
  - "Fresh/resume/fork safely refuse or start an explicitly explained fresh session when prior identity cannot be verified; never substitute provider/model/auth."
  - "Identity evidence and persisted metadata contain no credentials, broker headers, raw auth files or sensitive company identifiers."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "codex-hardening"
  - "approved"
  - "slot-3"
source: "ndx-capture"
blockedBy:
  - "cf5b4ccc-b418-41db-b2ad-a0c38097e8a9"
---
