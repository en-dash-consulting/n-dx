---
id: "d2cc6bff-e96a-467e-bbd6-37bcf5fdc915"
level: "task"
title: "Fix structural in config-validation-gauntlet: The gauntlet/ directory sits outside the established e2e/ and integration/ test "
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-18T15:04:36.706Z"
completedAt: "2026-04-18T15:10:02.108Z"
resolutionType: "code-change"
resolutionDetail: "Moved tests/gauntlet/ into tests/integration/, removed gauntlet npm script, updated zone pins."
acceptanceCriteria: []
description: "- The gauntlet/ directory sits outside the established e2e/ and integration/ test directory conventions, which may cause it to be excluded from standard test runs if glob patterns are not kept in sync."
recommendationMeta: "[object Object]"
---
