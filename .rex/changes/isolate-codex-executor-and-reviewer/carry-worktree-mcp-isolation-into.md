---
id: "722f0341-7454-4ac9-bd16-cf97cd090e24"
type: "task"
title: "Carry worktree MCP isolation into distinct reviewer launches"
slug: "carry-worktree-mcp-isolation-into"
description: "Approved Codex hardening follow-up, 2026-11-24. Users retain personal or company-provided Claude/Codex login and explicit binary/model/provider pins and organizational restrictions. Ordinary CLI use requires no separate API account/key. Excludes new billing/accounts, general API-model expansion, new OS keystores and direct API adversarial review. Preserve completed first-stack repairs. One owner per numbered PR; linear handoff only after committed work, required fresh distinct review, declared validation and stable interfaces. See docs/coordination/codex-hardening-stack.md for matrix, evidence and reconciliation. No global auth/config writes or parallel writers in one checkout.\n\n\n\nOwner launch packet (read in full before implementation): /Users/ryankeith/.codex/attachments/f19d1fd3-9682-44a2-951b-d782e8950394/Pasted text.txt. This is PR 1 only; implement this work unit only in this invocation. The owner established an ignored checkout-local .codex/config.toml bootstrap with canonical absolute Rex/SourceVision commands and disabled ambient unrelated servers; native app-server config/read and direct MCP calls verified it before launch. This bootstrap is preparatory, not the production per-run isolation solution. Do not change auth, global config or repository trust. Read the release-note skill before scoped patch changesets. No extra agents. Do not publish a PR or dispatch later work units from inside this run; the owner coordinates those after committed completion."
acceptanceCriteria:
  - "A fresh distinct Codex self-review receives the same assigned canonical workspace and permitted MCP set as its executor."
  - "Regression fixtures cover resumed/forked executor history, reviewer launch and retry without borrowing sibling claims, logs or PRD roots."
  - "Missing/unsupported MCP isolation refuses clearly instead of inheriting anchor/global servers; required review cannot be silently skipped."
  - "Pair review with Codex as reviewer receives the assigned canonical Rex/SourceVision binding, including retry and continuation refusal checks; this is MCP routing coverage and does not claim native tool-policy enforcement (PR 2)."
  - "Required fresh distinct gpt-6.2-astra self-review of the gpt-6-astra executor is evidenced by different actual session/report identity; preserve all saved settings and never downgrade mandatory review."
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
