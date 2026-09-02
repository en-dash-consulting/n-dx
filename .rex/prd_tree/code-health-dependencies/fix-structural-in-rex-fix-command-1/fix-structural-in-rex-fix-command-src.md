---
id: "b2b4436a-6956-4c00-afac-86d379da88d9"
level: "task"
title: "Fix structural in rex-fix-command: src/core/fix.ts is separated from the src/fix/ entry point by an artificial dire"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-19T02:41:23.354Z"
completedAt: "2026-04-19T02:44:53.838Z"
resolutionType: "code-change"
resolutionDetail: "Renamed tests/unit/core/fix.test.ts → tests/unit/fix/index.test.ts. All 3344 tests pass."
acceptanceCriteria: []
description: "- src/core/fix.ts is separated from the src/fix/ entry point by an artificial directory boundary, lowering cohesion to 0.33 without reflecting a meaningful architectural split"
recommendationMeta: "[object Object]"
---
