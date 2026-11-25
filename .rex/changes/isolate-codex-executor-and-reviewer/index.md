---
id: "1db22861-16c4-4361-92a5-692d63fc46c8"
type: "change"
title: "Isolate Codex executor and reviewer MCP by worktree"
slug: "isolate-codex-executor-and-reviewer"
intent: "Approved Codex hardening follow-up, 2026-11-24. Users retain personal or company-provided Claude/Codex login and explicit binary/model/provider pins and organizational restrictions. Ordinary CLI use requires no separate API account/key. Excludes new billing/accounts, general API-model expansion, new OS keystores and direct API adversarial review. Preserve completed first-stack repairs. One owner per numbered PR; linear handoff only after committed work, required fresh distinct review, declared validation and stable interfaces. See docs/coordination/codex-hardening-stack.md for matrix, evidence and reconciliation. No global auth/config writes or parallel writers in one checkout.\n\nPR 1 owns worktree MCP identity and its runtime launch interface; later policy and session work consumes that interface."
acceptanceCriteria:
  - "Executor and fresh reviewer use only the assigned canonical worktree Rex/SourceVision MCP bindings across fresh, resumed and forked launches."
  - "Two-worktree negative fixtures prove that reads, writes, claims and logs never target the sibling checkout; unrelated MCP configuration stays excluded."
  - "Commit scoped regressions, real selected-CLI evidence, required startup gates, affected gate and distinct review outcome before successor handoff."
touches:
  - "7e14ce05-95ad-4fa4-adc9-73d0c6742566"
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "codex-hardening"
  - "approved"
  - "slot-1"
source: "ndx-capture"
blockedBy:
  - "e1f1750a-083b-4e37-83df-ab92e2fd90de"
---
