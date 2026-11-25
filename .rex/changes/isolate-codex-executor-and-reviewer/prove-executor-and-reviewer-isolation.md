---
id: "5d599339-5a76-42db-a124-5d816c4161b8"
type: "task"
title: "Prove executor and reviewer isolation with two worktrees"
slug: "prove-executor-and-reviewer-isolation"
description: "Approved Codex hardening follow-up, 2026-11-24. Users retain personal or company-provided Claude/Codex login and explicit binary/model/provider pins and organizational restrictions. Ordinary CLI use requires no separate API account/key. Excludes new billing/accounts, general API-model expansion, new OS keystores and direct API adversarial review. Preserve completed first-stack repairs. One owner per numbered PR; linear handoff only after committed work, required fresh distinct review, declared validation and stable interfaces. See docs/coordination/codex-hardening-stack.md for matrix, evidence and reconciliation. No global auth/config writes or parallel writers in one checkout.\n\n"
acceptanceCriteria:
  - "A disposable two-worktree fixture drives real selected Codex CLI launches against the production executor/reviewer binding path; record executable path/version and exact base/head."
  - "Capture positive access to the assigned Rex/SourceVision roots and negative access/write/claim/log attempts against sibling sentinels; no real secrets appear in argv/logs/transcripts."
  - "Record scoped tests/builds/typechecks, cli-dev and scheduler-startup, affected gate, fresh distinct review report and stable handoff contract; unavailable native evidence keeps the criterion open."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "codex-hardening"
  - "approved"
  - "slot-1"
source: "ndx-capture"
blockedBy:
  - "722f0341-7454-4ac9-bd16-cf97cd090e24"
---
