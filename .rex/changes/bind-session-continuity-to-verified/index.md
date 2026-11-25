---
id: "7fe76a6f-78e4-4289-b7a5-4d41bc24d5fd"
type: "change"
title: "Bind session continuity to verified login and workspace identity"
slug: "bind-session-continuity-to-verified"
intent: "Approved Codex hardening follow-up, 2026-11-24. Users retain personal or company-provided Claude/Codex login and explicit binary/model/provider pins and organizational restrictions. Ordinary CLI use requires no separate API account/key. Excludes new billing/accounts, general API-model expansion, new OS keystores and direct API adversarial review. Preserve completed first-stack repairs. One owner per numbered PR; linear handoff only after committed work, required fresh distinct review, declared validation and stable interfaces. See docs/coordination/codex-hardening-stack.md for matrix, evidence and reconciliation. No global auth/config writes or parallel writers in one checkout.\n\n"
acceptanceCriteria:
  - "Identity fingerprints distinguish selected CLI/config/provider/login and workspace without persisting secrets; drift cannot silently resume another identity."
  - "Fresh/resume/fork/cancel/restart preserve policy, MCP bindings, session provenance and meaningful failure/continuation state."
  - "Reproduce and resolve or evidence current turn-scoped MCP result pairing under its existing item, without reopening completed retry/fork work."
touches:
  - "7e14ce05-95ad-4fa4-adc9-73d0c6742566"
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
  - "1710be37-554f-47bf-a9e0-609a6ab90768"
  - "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
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
