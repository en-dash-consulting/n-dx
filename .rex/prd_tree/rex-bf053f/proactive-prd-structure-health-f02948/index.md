---
id: "f0294876-d42d-497e-a3c6-c5abf7a374ed"
level: "feature"
title: "Proactive PRD structure health checks"
status: "completed"
priority: "medium"
tags:
  - "rex"
  - "quality"
blockedBy:
  - "9fa85475-a6ff-474a-bf4f-e1f531df7916"
startedAt: "2026-03-24T20:09:27.664Z"
completedAt: "2026-09-17T03:46:13.038Z"
endedAt: "2026-09-17T03:46:13.038Z"
acceptanceCriteria:
  - "rex add/analyze/plan warns when top-level epic count exceeds a configurable threshold (default: 15)"
  - "rex ci includes a structure health gate that fails when epic count, max depth, or avg children-per-container is out of bounds"
  - "Warnings suggest running /ndx-reshape or rex reorganize"
  - "Thresholds are configurable in .rex/config.json"
description: "The PRD grew to 70 top-level epics before anyone noticed the structure had degraded. The current `reorganize` command is reactive — it finds problems after they exist. Rex should proactively warn during writes (add, analyze, plan) when structural thresholds are crossed, so the PRD stays organized as it grows rather than requiring periodic manual cleanup."
lastModified: "2026-09-17T03:46:13.044Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add structure health gate to rex ci / ndx ci](./add-structure-health-gate-to-d587ad.md) | completed |
| [Define structure health thresholds and add to rex config schema](./define-structure-health-6ce9b7.md) | completed |
| [Implement structure health check function](./implement-structure-health-bf1fd0.md) | completed |
| [rex fix needs two runs to repair a misalignment nested under another completed parent](./rex-fix-needs-two-runs-to-bd8aaf.md) | completed |
| [rex status tells the operator to run rex fix for parents rex fix will not touch](./rex-status-tells-the-operator-bc725a.md) | completed |
| [Wire health warnings into rex add, analyze, and plan write paths](./wire-health-warnings-into-rex-3befc0.md) | completed |
