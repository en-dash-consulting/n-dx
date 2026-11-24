---
id: "aa1d7a60-2458-41d9-ba50-150619411558"
type: "task"
title: "Keep authentication-valid Codex model pins literal"
slug: "keep-authentication-valid-codex-model"
description: "Make old-model handling aware of API-key versus ChatGPT-authenticated availability. The audit resolved an explicit API gpt-5.4 pin to gpt-5.6-terra. Cross-reference completed catalog item 74f09a9f-fdf1-4b2a-a272-53bc202d0a91; do not reopen or duplicate it.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "API-supported IDs remain literal in configuration and execution, including intentional older pins."
  - "Unavailable ChatGPT-authenticated models produce actionable diagnostics and an explicit migration choice rather than silent substitution."
  - "Preserve llm, tier, hench, task execution and review pins; changing defaults never rewrites them."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"Model assignment: heavy / gpt-6-astra, authentication-sensitive pin preservation across normalization, precedence, execution and reviewer settings; effort advisory. Cross-reference completed catalog item 74f09a9f-fdf1-4b2a-a272-53bc202d0a91. Authorized current execution: implement only this task via actual ndx work in /private/tmp/ndx-wave1-restack. Preserve stack scope and all explicit model pins; do not capture new work or implement successors. Use disposable fixtures and a disposable CODEX_HOME for validation; never real auth/global config. Run applicable scoped tests, required tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js, affected package builds/typechecks. Mandatory fresh Codex Astra self-review and affected test gate remain enabled. autoCommit=false: stage only exact task-owned paths if permitted and write .hench-commit-msg.txt sentinel with bare N-DX-Item trailer; if staging denied, write sentinel and clearly report exact paths for coordinator staging before finalization. No effort flag is supported yet (PR6); desired effort is advisory, verify actual applied effort separately."}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-1"
source: "ndx-capture"
blockedBy:
  - "448ae4f4-fad9-4f8b-aadd-af94780a4ca8"
---
