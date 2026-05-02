---
id: "76ab3e87-ff97-40b3-94be-084cc92256fe"
level: "feature"
title: "Fix code in packages-web:integration (2 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T01:03:50.293Z"
completedAt: "2026-04-14T01:03:50.293Z"
acceptanceCriteria: []
description: "- search-overlay.ts is missing from the PANEL_FILES constant in boundary-check.test.ts (lines 257-263). The barrel-import assertion protects five other panel components but not search-overlay, meaning direct imports from components/search-overlay.ts silently pass CI. Add 'search-overlay' to the PANEL_FILES list to close the gap.\n- Replace the manually maintained PANEL_FILES array in boundary-check.test.ts with a runtime glob over the components/ directory (e.g. all files matching *-panel.ts or *-controls.ts). This closes the gap where new panel files (like search-overlay.ts) are added without updating the constant, and makes the barrel-import enforcement self-maintaining."
recommendationMeta: "[object Object]"
---

# Fix code in packages-web:integration (2 findings)

🟠 [completed]

## Summary

- search-overlay.ts is missing from the PANEL_FILES constant in boundary-check.test.ts (lines 257-263). The barrel-import assertion protects five other panel components but not search-overlay, meaning direct imports from components/search-overlay.ts silently pass CI. Add 'search-overlay' to the PANEL_FILES list to close the gap.
- Replace the manually maintained PANEL_FILES array in boundary-check.test.ts with a runtime glob over the components/ directory (e.g. all files matching *-panel.ts or *-controls.ts). This closes the gap where new panel files (like search-overlay.ts) are added without updating the constant, and makes the barrel-import enforcement self-maintaining.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Fix code in packages-web:integration: search-overlay.ts is missing from the PANEL_FILES constant in boundary-check.tes (+1 more) | task | completed | 2026-04-14 |

## Info

- **Status:** completed
- **Priority:** high
- **Level:** feature
- **Started:** 2026-04-14T01:03:50.293Z
- **Completed:** 2026-04-14T01:03:50.293Z
- **Duration:** < 1m
