---
id: "cf5b4ccc-b418-41db-b2ad-a0c38097e8a9"
type: "change"
title: "Enforce execution and pair-review policy with safe refusal"
slug: "enforce-execution-and-pair-review"
intent: "Approved Codex hardening follow-up, 2026-11-24. Users retain personal or company-provided Claude/Codex login and explicit binary/model/provider pins and organizational restrictions. Ordinary CLI use requires no separate API account/key. Excludes new billing/accounts, general API-model expansion, new OS keystores and direct API adversarial review. Preserve completed first-stack repairs. One owner per numbered PR; linear handoff only after committed work, required fresh distinct review, declared validation and stable interfaces. See docs/coordination/codex-hardening-stack.md for matrix, evidence and reconciliation. No global auth/config writes or parallel writers in one checkout.\n\nPR 2 consumes PR 1 MCP identity. Pair reviewer implementation is in scope; selecting a new coordinator reviewer vendor is not. Keep existing safe secret-isolation posture; any widening of exported-key handling needs a separate explicit policy decision."
acceptanceCriteria:
  - "Requested filesystem/network/shell/Git/tool restrictions are enforced or refused before execution with an actionable capability reason."
  - "Executor, self-review and pair-review enforce the same intended boundary through fresh/resume/fork/cancel/restart paths; repository configuration cannot widen it."
  - "Real CLI boundary evidence and credential-shell semantics distinguish supported enforcement from argument acceptance; no must-fix or should-fix finding silently deferred."
touches:
  - "7e14ce05-95ad-4fa4-adc9-73d0c6742566"
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
  - "2c0a3e60-2840-4695-8aee-fb720b6f9a1e"
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "codex-hardening"
  - "approved"
  - "slot-2"
source: "ndx-capture"
blockedBy:
  - "1db22861-16c4-4361-92a5-692d63fc46c8"
---
