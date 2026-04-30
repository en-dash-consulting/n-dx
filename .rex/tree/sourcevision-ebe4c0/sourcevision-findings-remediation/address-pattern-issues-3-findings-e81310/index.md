---
id: "e813108f-27c4-4196-abbc-5cd52f4269b7"
level: "task"
title: "Address pattern issues (3 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-10T04:29:25.088Z"
completedAt: "2026-03-10T04:36:33.932Z"
resolutionType: "code-change"
resolutionDetail: "Relocated crash-detector.ts from performance/ to crash/ subdirectory with barrel; added status hook+types to components barrel; created 20 unit tests for 3 sourcevision page components"
acceptanceCriteria: []
description: "- crash-detector.ts is placed under performance/ but serves crash recovery, not performance monitoring — the directory name creates a false affordance; relocating to a crash/ subdirectory and adding an index.ts barrel would align location with intent.\n- No internal barrel file exists to formalize the hook→component API surface; adding a status/index.ts would allow the hook and component to evolve independently without callers needing to track both module paths.\n- No unit or integration tests exist for any of the three page components; given that enrichment-thresholds.ts and suggestions.ts render dynamic analysis output, missing tests create an undetected regression surface for SourceVision output format changes."
recommendationMeta: "[object Object]"
---

# Address pattern issues (3 findings)

🟠 [completed]

## Summary

- crash-detector.ts is placed under performance/ but serves crash recovery, not performance monitoring — the directory name creates a false affordance; relocating to a crash/ subdirectory and adding an index.ts barrel would align location with intent.
- No internal barrel file exists to formalize the hook→component API surface; adding a status/index.ts would allow the hook and component to evolve independently without callers needing to track both module paths.
- No unit or integration tests exist for any of the three page components; given that enrichment-thresholds.ts and suggestions.ts render dynamic analysis output, missing tests create an undetected regression surface for SourceVision output format changes.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-10T04:29:25.088Z
- **Completed:** 2026-03-10T04:36:33.932Z
- **Duration:** 7m
