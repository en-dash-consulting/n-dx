---
id: "3b76c799-5c4b-47d3-9bc6-f5e17c901956"
level: "task"
title: "UI Build and Asset Refresh Orchestration"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T19:44:16.247Z"
completedAt: "2026-02-21T19:44:16.247Z"
description: "Ensure dashboard UI artifacts are rebuilt correctly, always covering `@n-dx/web` and conditionally rebuilding SourceVision assets when required."
---

## Subtask: Implement affected UI package resolver with `@n-dx/web` minimum coverage

**ID:** `fb9e1b70-7882-402d-96e6-9519252b38df`
**Status:** completed
**Priority:** high

Create build-step resolution that always includes `@n-dx/web` and includes SourceVision-related assets when refresh scope indicates they are needed, preventing stale dashboard views.

**Acceptance Criteria**

- Default `ndx refresh` includes build execution for `@n-dx/web`.
- When SourceVision UI assets are required, resolver includes the SourceVision asset build step in the plan.
- Plan output lists exactly which packages/assets will be built before execution.

---

## Subtask: Apply `--no-build` and `--ui-only` semantics to build pipeline execution

**ID:** `93497e87-0d7e-4d04-a1f6-6c02c4bdf2ab`
**Status:** completed
**Priority:** high

Respect user intent to skip build work or focus on UI work while keeping behavior explicit and safe for automation and local use.

**Acceptance Criteria**

- `ndx refresh --no-build` skips all build commands and reports build steps as skipped.
- `ndx refresh --ui-only` executes UI build/asset steps and does not run non-UI data refresh steps.
- When both `--ui-only --no-build` are provided, command performs no build actions and still prints a valid step summary.

---
