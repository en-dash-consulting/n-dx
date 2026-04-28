---
id: "20bbdb7b-1643-4e14-86de-babe1d145f5e"
level: "task"
title: "Actionable UI diagnostics and retry guidance"
status: "completed"
source: "smart-add"
startedAt: "2026-02-23T01:39:38.087Z"
completedAt: "2026-02-23T01:39:38.087Z"
description: "Improve operator recovery by surfacing exact failure context and tailored next actions based on failure category."
---

## Subtask: Render semantic-diff failure diagnostics in PR Markdown UI banner and details panel

**ID:** `39a4e702-15cd-4a03-8e5f-650736e941b1`
**Status:** completed
**Priority:** high

Show structured failure data in the PR Markdown tab while continuing to display stale cached output, so users can diagnose issues without losing context.

**Acceptance Criteria**

- UI displays a degraded-state banner when API reports semantic-diff failure
- Details panel shows failing git subcommand and stderr excerpt from API response
- Cached markdown remains visible and copyable while diagnostics are displayed
- UI displays semantic-stage-specific remediation guidance distinct from name-status failures.
- UI shows fallback state that explicitly indicates cached PR markdown was preserved.
- End-to-end test validates API diagnostics are rendered with failing subcommand details and stage-appropriate remediation text.

---

## Subtask: Classify retry guidance for fetch failures versus local history failures

**ID:** `52d8d372-1a64-4119-b590-9b4472e3016a`
**Status:** completed
**Priority:** high

Differentiate remediation paths so users receive relevant retry instructions depending on whether failure stems from remote fetch/credentials or local branch/history state.

**Acceptance Criteria**

- Failure classifier maps known fetch-related stderr patterns to fetch retry guidance
- Failure classifier maps local-history stderr patterns to local remediation guidance
- UI and API both expose the resolved guidance category and command suggestions for each classification path

---
