---
id: "0e8681dc-e39d-4f02-9aba-7972cbda15a3"
type: "task"
title: "Fix code in packages-web:integration: search-overlay.ts is missing from the PANEL_FILES constant in boundary-check.tes (+1 more)"
slug: "fix-code-in-packages-web-integration"
description: "- search-overlay.ts is missing from the PANEL_FILES constant in boundary-check.test.ts (lines 257-263). The barrel-import assertion protects five other panel components but not search-overlay, meaning direct imports from components/search-overlay.ts silently pass CI. Add 'search-overlay' to the PANEL_FILES list to close the gap.\n- Replace the manually maintained PANEL_FILES array in boundary-check.test.ts with a runtime glob over the components/ directory (e.g. all files matching *-panel.ts or *-controls.ts). This closes the gap where new panel files (like search-overlay.ts) are added without updating the constant, and makes the barrel-import enforcement self-maintaining."
priority: "high"
source: "sourcevision"
---
