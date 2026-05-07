---
id: "0e8681dc-e39d-4f02-9aba-7972cbda15a3"
level: "task"
title: "Fix code in packages-web:integration: search-overlay.ts is missing from the PANEL_FILES constant in boundary-check.tes (+1 more)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T01:01:20.813Z"
completedAt: "2026-04-14T01:03:50.078Z"
acceptanceCriteria: []
description: "- search-overlay.ts is missing from the PANEL_FILES constant in boundary-check.test.ts (lines 257-263). The barrel-import assertion protects five other panel components but not search-overlay, meaning direct imports from components/search-overlay.ts silently pass CI. Add 'search-overlay' to the PANEL_FILES list to close the gap.\n- Replace the manually maintained PANEL_FILES array in boundary-check.test.ts with a runtime glob over the components/ directory (e.g. all files matching *-panel.ts or *-controls.ts). This closes the gap where new panel files (like search-overlay.ts) are added without updating the constant, and makes the barrel-import enforcement self-maintaining."
__parentAcceptanceCriteria: []
__parentCompletedAt: "2026-04-14T01:03:50.293Z"
__parentDescription: "- search-overlay.ts is missing from the PANEL_FILES constant in boundary-check.test.ts (lines 257-263). The barrel-import assertion protects five other panel components but not search-overlay, meaning direct imports from components/search-overlay.ts silently pass CI. Add 'search-overlay' to the PANEL_FILES list to close the gap.\n- Replace the manually maintained PANEL_FILES array in boundary-check.test.ts with a runtime glob over the components/ directory (e.g. all files matching *-panel.ts or *-controls.ts). This closes the gap where new panel files (like search-overlay.ts) are added without updating the constant, and makes the barrel-import enforcement self-maintaining."
__parentId: "76ab3e87-ff97-40b3-94be-084cc92256fe"
__parentLevel: "feature"
__parentPriority: "high"
__parentRecommendationMeta: "[object Object]"
__parentSource: "sourcevision"
__parentStartedAt: "2026-04-14T01:03:50.293Z"
__parentStatus: "completed"
__parentTitle: "Fix code in packages-web:integration (2 findings)"
recommendationMeta: "[object Object]"
---
