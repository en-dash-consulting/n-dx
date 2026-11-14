---
id: "448ae4f4-fad9-4f8b-aadd-af94780a4ca8"
type: "task"
title: "Preserve operator Codex settings during ndx init"
slug: "preserve-operator-codex-settings"
description: "Update only n-dx-owned MCP definitions without replacing the whole project Codex config. Audit disposable fixture lost model=\"gpt-6.1-sol\" and an unrelated table.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Re-init retains intentional project model pins, unrelated tables and operator MCP entries while updating n-dx-owned definitions."
  - "Fresh init and repeated init are deterministic; unreadable or ambiguous config fails without data loss."
  - "Regression coverage uses a disposable existing config; Claude setup behavior stays unchanged."
priority: "high"
run: {"tier":"standard","models":{"codex":"gpt-6.1-sol"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"Model assignment: standard / gpt-6.1-sol, bounded config-preservation with disposable fixtures; desired medium effort advisory. Authorized current execution: implement only this task via actual ndx work in /private/tmp/ndx-wave1-restack. Preserve stack scope and all explicit model pins; do not capture new work or implement successors. Use disposable fixtures and a disposable CODEX_HOME for validation; never real auth/global config. Run applicable scoped tests, required tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js, affected package builds/typechecks. Mandatory fresh Codex Astra self-review and affected test gate remain enabled. autoCommit=false: stage only exact task-owned paths if permitted and write .hench-commit-msg.txt sentinel with bare N-DX-Item trailer; if staging denied, write sentinel and clearly report exact paths for coordinator staging before finalization. No effort flag is supported yet (PR6); desired effort is advisory, verify actual applied effort separately."}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-1"
source: "ndx-capture"
blockedBy:
  - "2337bb92-a7bc-4e91-a886-e727b1a182a3"
---
