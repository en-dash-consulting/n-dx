---
id: "8e8ad8de-6cae-44b8-afe3-7f2d44ea5d73"
type: "task"
title: "Collect packaged-install hub lifecycle evidence across platforms"
slug: "collect-packaged-install-hub-lifecycle"
description: "Approved Codex hardening follow-up, 2026-11-24. Users retain personal or company-provided Claude/Codex login and explicit binary/model/provider pins and organizational restrictions. Ordinary CLI use requires no separate API account/key. Excludes new billing/accounts, general API-model expansion, new OS keystores and direct API adversarial review. Preserve completed first-stack repairs. One owner per numbered PR; linear handoff only after committed work, required fresh distinct review, declared validation and stable interfaces. See docs/coordination/codex-hardening-stack.md for matrix, evidence and reconciliation. No global auth/config writes or parallel writers in one checkout.\n\n"
acceptanceCriteria:
  - "For each advertised OS/version/install tuple, drive the installed production hub/Sidecar path with real CLI and browser evidence for allowed broker actions, denied repository reads/writes, approvals, Stop and restart."
  - "Record package/CLI versions, executable provenance and native enforcement results; mark unavailable runners unsupported or unverified rather than passed."
  - "Keep unproven support criteria open; complete scoped/required/affected gates and fresh distinct review before handoff."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "codex-hardening"
  - "approved"
  - "slot-4"
source: "ndx-capture"
blockedBy:
  - "2d86d1ce-55f0-4930-8804-f046785cc81c"
---
