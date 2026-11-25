---
id: "0231fd52-2bcb-483f-bf77-bd89bb24d939"
type: "change"
title: "Verify concrete company-managed CLI configuration compatibility"
slug: "verify-concrete-company-managed-cli"
intent: "Approved Codex hardening follow-up, 2026-11-24. Users retain personal or company-provided Claude/Codex login and explicit binary/model/provider pins and organizational restrictions. Ordinary CLI use requires no separate API account/key. Excludes new billing/accounts, general API-model expansion, new OS keystores and direct API adversarial review. Preserve completed first-stack repairs. One owner per numbered PR; linear handoff only after committed work, required fresh distinct review, declared validation and stable interfaces. See docs/coordination/codex-hardening-stack.md for matrix, evidence and reconciliation. No global auth/config writes or parallel writers in one checkout.\n\nDo not generalize API model support or acquire accounts. Existing fc02c0b7 owns real Azure verification; mocks/local Responses fixtures prove protocol behavior only."
acceptanceCriteria:
  - "At least one concrete approved company-managed configuration preserves selected CLI, profile/model/provider/login and organizational restrictions, or refuses a named unsupported capability safely."
  - "Existing selected-provider forwarding is reused; the existing Azure-account criterion stays open until real account evidence satisfies it."
  - "Credentials stay out of argv/logs/fixtures and agent child shells; unrelated MCP/hooks/apps/plugins and unauthorized auth helpers never load."
touches:
  - "7e14ce05-95ad-4fa4-adc9-73d0c6742566"
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
  - "1710be37-554f-47bf-a9e0-609a6ab90768"
  - "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
  - "2c0a3e60-2840-4695-8aee-fb720b6f9a1e"
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
