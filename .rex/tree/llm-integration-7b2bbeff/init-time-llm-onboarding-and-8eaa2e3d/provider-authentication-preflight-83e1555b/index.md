---
id: "83e1555b-7eae-43d8-917e-459268669243"
level: "task"
title: "Provider authentication preflight during init"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T03:18:25.981Z"
completedAt: "2026-02-21T03:18:25.981Z"
description: "After provider selection, validate that the current terminal session is authenticated for that provider and guide users to the correct login command when needed."
---

## Subtask: Implement provider-specific auth status checks

**ID:** `11dad515-a937-4462-ab85-597a08b80777`
**Status:** completed
**Priority:** critical

Run a provider-specific preflight command after selection to determine whether the current shell session is authorized for the selected LLM.

**Acceptance Criteria**

- Selecting `codex` triggers the codex auth check command
- Selecting `claude` triggers the claude auth check command
- Check result is handled as pass/fail with deterministic branching and no uncaught errors

---

## Subtask: Prompt provider-specific login command on auth failure

**ID:** `756aef91-2145-4616-afad-0d01553b428b`
**Status:** completed
**Priority:** critical

When preflight fails, show clear remediation with the exact login command for the chosen provider so users can complete setup immediately.

**Acceptance Criteria**

- If codex auth check fails, init prints codex login instruction
- If claude auth check fails, init prints claude login instruction
- Prompt message includes next-step guidance and does not continue silently

---

## Subtask: Add integration tests for authenticated and unauthenticated init flows

**ID:** `da1d7f6e-e654-4923-b0ca-2d665aa538f2`
**Status:** completed
**Priority:** high

Cover both provider branches with mocked auth outcomes to prevent regressions in setup logic and ensure login prompting behavior remains reliable.

**Acceptance Criteria**

- Test suite includes pass/fail auth scenarios for both `codex` and `claude`
- Authenticated flow completes init without login prompt
- Unauthenticated flow emits expected provider-specific login prompt text

---
