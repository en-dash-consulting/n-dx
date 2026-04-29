---
id: "71e5ae15-08f4-4c57-ba63-b9df2edbe868"
level: "task"
title: "Deterministic Semantic Diff Command Execution"
status: "completed"
source: "smart-add"
startedAt: "2026-02-23T03:33:09.436Z"
completedAt: "2026-02-23T03:33:09.436Z"
acceptanceCriteria: []
description: "Make semantic diff extraction resilient to local Git config/tooling differences by forcing a stable, non-interactive command path.\n\n---\n\nExpose actionable failure details for semantic diff drift scenarios in both API and UI without losing usable cached output."
---

## Subtask: Enforce deterministic non-interactive flags for semantic diff git invocations

**ID:** `32ad60e5-8dc1-4f72-a0d4-c3adc80c630d`
**Status:** completed
**Priority:** critical

Prevent local external diff drivers, textconv filters, or interactive paging from changing semantic diff behavior so refresh results stay consistent across environments.

**Acceptance Criteria**

- Semantic diff extraction runs with `--no-ext-diff` and `--no-textconv` on every refresh path.
- Semantic diff command execution is non-interactive and does not invoke a pager or prompt for input.
- Integration test verifies identical semantic diff extraction behavior when local git config enables external diff/textconv.

---

## Subtask: Split semantic diff and name-status diff execution into independently classified stages

**ID:** `440381e9-8d67-40c7-8d89-07a18185e56c`
**Status:** completed
**Priority:** critical

Ensure a semantic diff failure does not get conflated with name-status collection so diagnostics and fallback decisions are accurate.

**Acceptance Criteria**

- Semantic diff and name-status diff run as separate stage executions with distinct status fields.
- A semantic diff failure with successful name-status diff returns a mixed-stage result instead of a single generic failure.
- Regression test covers semantic-stage failure while name-status stage succeeds and validates separate classification output.

---

## Subtask: Include exact failing semantic diff subcommand metadata in refresh diagnostics

**ID:** `43601fbb-db84-4506-b81f-5489d422bd56`
**Status:** completed
**Priority:** high

Give operators precise visibility into which git subcommand failed so they can quickly reproduce and fix local tooling drift issues.

**Acceptance Criteria**

- Refresh API error payload includes the failing semantic diff subcommand string and stage identifier.
- Payload preserves stderr/exit-code context in structured fields suitable for UI rendering.
- Sensitive values are redacted according to existing logging/error policies.

---
