---
id: "fe3eb56e-a017-4e19-980d-d3590b632824"
level: "task"
title: "File and Format Detection"
status: "completed"
source: "llm"
startedAt: "2026-02-09T16:13:11.734Z"
completedAt: "2026-02-09T16:13:11.734Z"
acceptanceCriteria:
  - "cmdConfig in hench/cli/commands/config.ts is not flagged as unused"
  - "Validators in web/schema/validate.ts are not flagged as unused"
  - "Components in health-gauge.ts and logos.ts are not flagged as unused"
  - "No regression in detecting genuinely dead exports"
description: "Improve file handling and format detection capabilities\n\n---\n\nThe detectDeadExports() function in callgraph-findings.ts only checks the call graph for usage. Exports consumed via dynamic imports (await import()) or used only through import edges (not direct calls) are incorrectly flagged as dead. This produces false positives for CLI command registrations (cmdConfig) and validators used through import chains."
---

# File and Format Detection

 [completed]

## Summary

Improve file handling and format detection capabilities

---

The detectDeadExports() function in callgraph-findings.ts only checks the call graph for usage. Exports consumed via dynamic imports (await import()) or used only through import edges (not direct calls) are incorrectly flagged as dead. This produces false positives for CLI command registrations (cmdConfig) and validators used through import chains.

## Info

- **Status:** completed
- **Level:** task
- **Started:** 2026-02-09T16:13:11.734Z
- **Completed:** 2026-02-09T16:13:11.734Z
- **Duration:** < 1m
