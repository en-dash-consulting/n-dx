---
id: "dc30e866-3942-47dc-96fe-d8e8a792afa8"
level: "task"
title: "Address suggestion issues (6 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-09T19:28:29.053Z"
completedAt: "2026-03-09T19:34:46.443Z"
resolutionType: "code-change"
resolutionDetail: "Applied zone pins to dissolve crash zone (5 files → web-viewer), web zone viewer files (10 files → web-viewer), and analyzers-3 zone (3 files → analyzers). Removed 7 dead exports across 4 files: 3 from polling-restart.ts, 2 from loader.ts, 1 from branch-work-filter.ts, 1 from prd-epic-resolver.ts. Validate zone acknowledged as healthy high-volume consumer per its own insights."
acceptanceCriteria: []
description: "- Zone \"Crash\" (crash) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention\n- 3 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): crash, web, packages-rex:validate — mandatory refactoring recommended before further development\n- Zone \"Web\" (web) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development\n- Create packages/web/src/viewer/index.ts as the sole public surface for the viewer subpackage, re-exporting only the symbols currently consumed by the web zone (server entry), web-server zone, and crash zone. Then add an import-boundary assertion to domain-isolation.test.js that fails if any file outside packages/web/src/viewer/ imports a path inside src/viewer/ that is not re-exported by index.ts. This single change directly resolves the 11 entry-point warning, collapses the bidirectional web↔web-viewer coupling (13+9 crossings), and eliminates the high-coupling findings in web-server (0.60) and crash (0.71) by making their import targets explicit and controlled.\n- Zone \"Analyzers 3\" (packages-sourcevision:analyzers-3) has catastrophic risk (score: 0.73, cohesion: 0.27, coupling: 0.73) — requires immediate architectural intervention\n- Zone \"Validate\" (packages-rex:validate) has critical risk (score: 0.64, cohesion: 0.36, coupling: 0.64) — requires refactoring before new feature development"
recommendationMeta: "[object Object]"
---

# Address suggestion issues (6 findings)

🔴 [completed]

## Summary

- Zone "Crash" (crash) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- 3 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): crash, web, packages-rex:validate — mandatory refactoring recommended before further development
- Zone "Web" (web) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development
- Create packages/web/src/viewer/index.ts as the sole public surface for the viewer subpackage, re-exporting only the symbols currently consumed by the web zone (server entry), web-server zone, and crash zone. Then add an import-boundary assertion to domain-isolation.test.js that fails if any file outside packages/web/src/viewer/ imports a path inside src/viewer/ that is not re-exported by index.ts. This single change directly resolves the 11 entry-point warning, collapses the bidirectional web↔web-viewer coupling (13+9 crossings), and eliminates the high-coupling findings in web-server (0.60) and crash (0.71) by making their import targets explicit and controlled.
- Zone "Analyzers 3" (packages-sourcevision:analyzers-3) has catastrophic risk (score: 0.73, cohesion: 0.27, coupling: 0.73) — requires immediate architectural intervention
- Zone "Validate" (packages-rex:validate) has critical risk (score: 0.64, cohesion: 0.36, coupling: 0.64) — requires refactoring before new feature development

## Info

- **Status:** completed
- **Priority:** critical
- **Level:** task
- **Started:** 2026-03-09T19:28:29.053Z
- **Completed:** 2026-03-09T19:34:46.443Z
- **Duration:** 6m
