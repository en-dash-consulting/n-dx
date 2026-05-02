---
id: "626d40cf-4513-4cb1-a767-0aabd05a5f7c"
level: "feature"
title: "Graceful Cancellation with Rollback Prompt on Ctrl+C"
status: "completed"
source: "smart-add"
startedAt: "2026-04-20T19:32:34.057Z"
completedAt: "2026-04-20T19:32:34.057Z"
acceptanceCriteria: []
description: "Extend the existing run-failure rollback flow to also trigger when the user cancels a hench run via Ctrl+C (SIGINT). Currently Ctrl+C exits abruptly, leaving the PRD task in an in-progress state and any partial file changes uncommitted. This feature brings parity between the failure-path rollback UX and the user-initiated cancellation path."
---

## Children

| Title | Status |
|-------|--------|
| [Intercept SIGINT during hench run loop and transition to graceful cancellation state](./intercept-sigint-during-hench-f00023/index.md) | completed |
| [Show rollback prompt on Ctrl+C cancellation and reset PRD task status](./show-rollback-prompt-on-ctrl-c-6dc861/index.md) | completed |
