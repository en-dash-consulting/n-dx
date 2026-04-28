---
id: "10506b2b-1dc1-41d1-a793-2049c9e7e1c5"
level: "task"
title: "Refresh Command Surface and Execution Planning"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T19:36:19.014Z"
completedAt: "2026-02-21T19:36:19.014Z"
description: "Introduce a first-class `ndx refresh` command that turns user intent into a deterministic refresh plan across build and data steps."
---

## Subtask: Add `ndx refresh` command to CLI orchestration entrypoint

**ID:** `3dbc84be-e396-42b1-863f-13e8d9c03fd0`
**Status:** completed
**Priority:** critical

Expose a dedicated refresh command in the top-level CLI so dashboard refresh workflows are accessible without package-specific commands, reducing operator friction and script complexity.

**Acceptance Criteria**

- `ndx refresh --help` shows the command with supported flags `--ui-only`, `--data-only`, `--pr-markdown`, and `--no-build`.
- Running `ndx refresh` executes without unknown-command errors from a configured project root.
- Command exits with code `0` on successful completion and non-zero on any failed step.

---

## Subtask: Implement refresh plan builder for flag combinations and conflicts

**ID:** `cb64cbaf-2d12-4b0e-9efc-434bd8ffa21a`
**Status:** completed
**Priority:** critical

Translate flag combinations into explicit step plans so each invocation has predictable behavior and invalid combinations are rejected before work starts.

**Acceptance Criteria**

- `--ui-only` skips data refresh steps and executes only UI-related steps.
- `--data-only` skips UI build steps unless explicitly required by implementation constraints and reports that decision.
- `--pr-markdown` runs only PR markdown cache refresh path (plus required prerequisites) and skips unrelated steps.
- `--ui-only` with `--data-only` returns a validation error with actionable guidance.

---
