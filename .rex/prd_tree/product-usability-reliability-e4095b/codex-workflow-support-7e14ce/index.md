---
id: "7e14ce05-95ad-4fa4-adc9-73d0c6742566"
level: "task"
title: "Codex Workflow Support"
status: "completed"
priority: "critical"
startedAt: "2026-07-07T17:30:14.123Z"
completedAt: "2026-07-10T04:30:36.079Z"
endedAt: "2026-07-10T04:30:36.079Z"
acceptanceCriteria: []
description: "Type: Bug/Story. Improve Codex support so N-DX is usable with Codex workflows.\n\nUser Story: As an N-DX user working with Codex, I want Codex workflows to function properly, so that N-DX supports the toolchain it claims or intends to support.\n\nAcceptance Criteria:\n- Given a user configures N-DX for Codex usage, when a supported Codex workflow is executed, then the workflow completes successfully.\n- Given Codex support is incomplete or unavailable, when the user attempts to use it, then the limitation is clearly surfaced.\n- Given Codex-related failures occur, when errors are displayed, then the user receives actionable information.\n\nNotes: Codex is considered largely unusable with N-DX today, making this a P0 usability blocker."
---

## Children

| Title | Status |
|-------|--------|
| [Make Codex quota/token retrieval work for codex login (session auth) users](./make-codex-quota-token-676ea2.md) | completed |
| [Reconcile Codex model-id catalogs and fix dead light-tier alias](./reconcile-codex-model-id-74f09a.md) | completed |
| [Wire Codex token accounting into event-pipeline close path](./wire-codex-token-accounting-7feabb.md) | completed |
