---
id: "dde6d1c4-a1bd-4dfe-9af8-0ec057addf16"
level: "feature"
title: "Mandatory Pre-Commit Full Test Suite Gate"
status: "completed"
source: "smart-add"
startedAt: "2026-04-30T16:08:35.689Z"
completedAt: "2026-04-30T16:08:35.689Z"
endedAt: "2026-04-30T16:08:35.689Z"
acceptanceCriteria: []
description: "Introduce a distinct, mandatory step in the hench run lifecycle that executes the project's entire test suite before allowing a commit, regardless of whether failing tests are related to the current task. The gate is only bypassable via an explicit opt-out flag, and prompts the user when the test command is unknown or inaccessible."
---

# Mandatory Pre-Commit Full Test Suite Gate

 [completed]

## Summary

Introduce a distinct, mandatory step in the hench run lifecycle that executes the project's entire test suite before allowing a commit, regardless of whether failing tests are related to the current task. The gate is only bypassable via an explicit opt-out flag, and prompts the user when the test command is unknown or inaccessible.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add distinct full-test-suite gate step to hench run lifecycle before commit | task | completed | 2026-04-30 |
| Resolve test command via project config with interactive prompt fallback for unknown or inaccessible suites | task | completed | 2026-04-30 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-30T16:08:35.689Z
- **Completed:** 2026-04-30T16:08:35.689Z
- **Duration:** < 1m
