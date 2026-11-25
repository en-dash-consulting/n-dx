---
id: "9c0f7809-98cf-49be-a03a-3b1646c2e29a"
type: "change"
title: "Prove portable hub installation and executable admission"
slug: "prove-portable-hub-installation-and"
intent: "Approved Codex hardening follow-up, 2026-11-24. Users retain personal or company-provided Claude/Codex login and explicit binary/model/provider pins and organizational restrictions. Ordinary CLI use requires no separate API account/key. Excludes new billing/accounts, general API-model expansion, new OS keystores and direct API adversarial review. Preserve completed first-stack repairs. One owner per numbered PR; linear handoff only after committed work, required fresh distinct review, declared validation and stable interfaces. See docs/coordination/codex-hardening-stack.md for matrix, evidence and reconciliation. No global auth/config writes or parallel writers in one checkout.\n\n"
acceptanceCriteria:
  - "Packaged installations identify the selected CLI executable/version and preserve safe admitted hub behavior without source-tree or hardcoded machine paths."
  - "macOS/Linux/Windows have explicit supported/enforced/refused capability outcomes backed by native evidence; installation/version drift never silently broadens hub access."
  - "Broker-only confinement, operator cards, cancellation and restart survive supported installed layouts; unavailable OS/version evidence remains open."
touches:
  - "7e14ce05-95ad-4fa4-adc9-73d0c6742566"
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
  - "1710be37-554f-47bf-a9e0-609a6ab90768"
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "codex-hardening"
  - "approved"
  - "slot-4"
source: "ndx-capture"
blockedBy:
  - "7fe76a6f-78e4-4289-b7a5-4d41bc24d5fd"
---
