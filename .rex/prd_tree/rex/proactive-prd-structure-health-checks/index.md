---
id: "f0294876-d42d-497e-a3c6-c5abf7a374ed"
level: "feature"
title: "Proactive PRD structure health checks"
status: "pending"
priority: "medium"
tags:
  - "rex"
  - "quality"
blockedBy:
  - "9fa85475-a6ff-474a-bf4f-e1f531df7916"
startedAt: "2026-03-24T20:09:27.664Z"
acceptanceCriteria:
  - "rex add/analyze/plan warns when top-level epic count exceeds a configurable threshold (default: 15)"
  - "rex ci includes a structure health gate that fails when epic count, max depth, or avg children-per-container is out of bounds"
  - "Warnings suggest running /ndx-reshape or rex reorganize"
  - "Thresholds are configurable in .rex/config.json"
description: "The PRD grew to 70 top-level epics before anyone noticed the structure had degraded. The current `reorganize` command is reactive — it finds problems after they exist. Rex should proactively warn during writes (add, analyze, plan) when structural thresholds are crossed, so the PRD stays organized as it grows rather than requiring periodic manual cleanup."
lastModified: "2026-09-12T09:10:24.674Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add structure health gate to rex ci / ndx ci](./add-structure-health-gate-to-rex-ci.md) | completed |
| [Define structure health thresholds and add to rex config schema](./define-structure-health-thresholds-and.md) | completed |
| [Implement structure health check function](./implement-structure-health-check.md) | completed |
| [rex fix needs two runs to repair a misalignment nested under another completed parent](./rex-fix-needs-two-runs-to-repair-a.md) | pending |
| [rex status tells the operator to run rex fix for parents rex fix will not touch](./rex-status-tells-the-operator-to-run.md) | pending |
| [Wire health warnings into rex add, analyze, and plan write paths](./wire-health-warnings-into-rex-add.md) | completed |
