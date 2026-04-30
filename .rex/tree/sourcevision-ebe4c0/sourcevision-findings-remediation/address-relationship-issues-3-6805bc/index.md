---
id: "6805bc75-ba25-4124-a5eb-c32e03cb4a4a"
level: "task"
title: "Address relationship issues (3 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-08T07:23:49.432Z"
completedAt: "2026-03-08T07:24:25.317Z"
acceptanceCriteria: []
description: "- Rex-runtime-data is decoupled from all source zones at the import-graph level, meaning static analysis tools (linters, bundlers, treeshakers) cannot detect or enforce its integrity contracts — data schema validation must be enforced at runtime (e.g., zod or JSON schema) rather than at type-check time.\n- The single reverse import (task-usage-analytics → web-dashboard) combined with 3 imports in the opposite direction creates a micro-cycle between these two zones. Extracting the shared symbol to a dedicated types file would break the cycle and make both zones strict DAG nodes.\n- Zone 'web-dashboard' (3 files: tick-timer utility) has a name collision with the conceptual 'web dashboard' application represented by web-viewer (367 files); renaming to 'viewer-polling-timer' or absorbing into web-viewer would eliminate the ambiguity"
recommendationMeta: "[object Object]"
---

# Address relationship issues (3 findings)

🟠 [completed]

## Summary

- Rex-runtime-data is decoupled from all source zones at the import-graph level, meaning static analysis tools (linters, bundlers, treeshakers) cannot detect or enforce its integrity contracts — data schema validation must be enforced at runtime (e.g., zod or JSON schema) rather than at type-check time.
- The single reverse import (task-usage-analytics → web-dashboard) combined with 3 imports in the opposite direction creates a micro-cycle between these two zones. Extracting the shared symbol to a dedicated types file would break the cycle and make both zones strict DAG nodes.
- Zone 'web-dashboard' (3 files: tick-timer utility) has a name collision with the conceptual 'web dashboard' application represented by web-viewer (367 files); renaming to 'viewer-polling-timer' or absorbing into web-viewer would eliminate the ambiguity

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-08T07:23:49.432Z
- **Completed:** 2026-03-08T07:24:25.317Z
- **Duration:** < 1m
