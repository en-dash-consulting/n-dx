---
id: "722f0341-7454-4ac9-bd16-cf97cd090e24"
type: "task"
title: "Carry worktree MCP isolation into distinct reviewer launches"
slug: "carry-worktree-mcp-isolation-into"
description: "Approved Codex hardening follow-up, 2026-11-24. Users retain personal or company-provided Claude/Codex login and explicit binary/model/provider pins and organizational restrictions. Ordinary CLI use requires no separate API account/key. Excludes new billing/accounts, general API-model expansion, new OS keystores and direct API adversarial review. Preserve completed first-stack repairs. One owner per numbered PR; linear handoff only after committed work, required fresh distinct review, declared validation and stable interfaces. See docs/coordination/codex-hardening-stack.md for matrix, evidence and reconciliation. No global auth/config writes or parallel writers in one checkout.\n\n"
acceptanceCriteria:
  - "A fresh distinct Codex self-review receives the same assigned canonical workspace and permitted MCP set as its executor."
  - "Regression fixtures cover resumed/forked executor history, reviewer launch and retry without borrowing sibling claims, logs or PRD roots."
  - "Missing/unsupported MCP isolation refuses clearly instead of inheriting anchor/global servers; required review cannot be silently skipped."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "codex-hardening"
  - "approved"
  - "slot-1"
source: "ndx-capture"
blockedBy:
  - "25270990-b5b0-413c-9719-6f70e9c3d38f"
---
