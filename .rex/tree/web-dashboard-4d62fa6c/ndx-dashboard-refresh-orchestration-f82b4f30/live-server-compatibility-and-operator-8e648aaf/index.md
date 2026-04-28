---
id: "8e648aaf-f12f-4854-ba1c-33030bc3f968"
level: "task"
title: "Live Server Compatibility and Operator Feedback"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T19:54:35.554Z"
completedAt: "2026-02-21T19:54:35.554Z"
description: "Make refresh behavior compatible with active `ndx start` sessions by attempting live reload signaling and clearly documenting restart requirements when hot update is not possible."
---

## Subtask: Implement running-server detection and live reload signaling during refresh

**ID:** `b0aee523-5299-49dc-a0c7-38510cd8d709`
**Status:** completed
**Priority:** high

Detect active dashboard server context and send reload notifications where supported so users do not need to manually restart after routine refresh operations.

**Acceptance Criteria**

- When `ndx start` server is running and reload signaling is supported, `ndx refresh` emits a live-reload signal after successful refresh steps.
- Command output indicates whether live reload was attempted and whether it succeeded.
- When no server is running, refresh completes without reload errors.

---

## Subtask: Add stepwise status reporting and restart fallback guidance

**ID:** `c529260e-8337-47fc-a512-b1af304b8f78`
**Status:** completed
**Priority:** medium

Provide clear per-step status output and explicit fallback instructions when a full restart is required, reducing ambiguity for operators and CI logs.

**Acceptance Criteria**

- Each refresh step prints status transitions (started, succeeded, failed, skipped) with step names.
- When hot reload is unavailable, output includes a restart-required message with the exact restart command.
- User-facing docs include a `ndx refresh` section describing flags, live reload behavior, and restart fallback conditions.

---
