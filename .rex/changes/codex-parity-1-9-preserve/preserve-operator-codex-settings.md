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
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-1"
source: "ndx-capture"
blockedBy:
  - "2337bb92-a7bc-4e91-a886-e727b1a182a3"
---
