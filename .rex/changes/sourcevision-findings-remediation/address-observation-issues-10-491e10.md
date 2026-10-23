---
id: "491e1097-3e0a-4900-8cf3-fa36c42cafae"
type: "task"
title: "Address observation issues (10 findings)"
slug: "address-observation-issues-10-491e10"
description: "- High coupling (0.71) — 3 imports target \"web-dashboard\"\n- Cohesion of 0.29 is below the warning threshold — the two files in this zone (hook and detector) are more coupled to web-dashboard than to each other, suggesting a zone boundary mismatch.\n- Coupling of 0.71 exceeds the warning threshold; the crash recovery subsystem has high external dependency, which reduces its reusability and increases change risk.\n- use-crash-recovery.ts lacks a unit test; given that crash recovery is a reliability-critical code path, this gap should be addressed.\n- Bidirectional coupling: \"web-dashboard\" ↔ \"web-package-scaffold\" (3+9 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects\n- 9 entry points — wide API surface, consider consolidating exports\n- Bidirectional imports with both 'crash' and 'panel' zones create implicit circular dependencies at the zone level; these relationships should be reviewed to ensure directional ownership is clear.\n- analyze-panel.ts and proposal-editor.ts lack unit tests while the simpler smart-add-input and batch-import-panel components are tested — the more complex components should be prioritized for test coverage.\n- Viewer UI files are co-classified with build scripts due to shared import edges; zone pinning for elapsed-time.ts, route-state.ts, task-audit.ts, use-tick.ts, lazy-children.ts, and listener-lifecycle.ts is recommended to correct classification."
priority: "high"
source: "sourcevision"
---
