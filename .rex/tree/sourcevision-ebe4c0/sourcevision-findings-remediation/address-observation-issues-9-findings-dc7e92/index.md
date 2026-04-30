---
id: "dc7e920d-da53-49b3-b5c6-65086e60754b"
level: "task"
title: "Address observation issues (9 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-07T03:23:01.494Z"
completedAt: "2026-03-07T03:50:28.105Z"
acceptanceCriteria: []
description: "- High coupling (0.71) — 3 imports target \"web-dashboard\"\n- Low cohesion (0.29) — files are loosely related, consider splitting this zone\n- The mutual three-import dependency between crash-recovery and web-dashboard creates a cycle at the zone level; restructure so crash-detector.ts is a pure utility imported by the viewer, with no reverse dependency from crash-recovery back into the dashboard.\n- Zone cohesion of 0.29 and coupling of 0.71 indicates the crash-recovery files are more tightly connected to external zones than to each other; consider whether crash-detector.ts and use-crash-recovery.ts belong in separate zones (utility vs. hook) or should be merged into the web-dashboard zone they depend on.\n- This zone conflates two unrelated concerns: web-viewer graph interaction tests and monorepo dev-analysis scripts. It is an algorithmic artifact, not a real architectural unit.\n- Bidirectional coupling: \"web-build-tooling\" ↔ \"web-dashboard\" (9+3 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects\n- tests/check-gateway-regex.mjs and tests/check-gateway-test.mjs are developer-utility scripts unrelated to the landing page; they should be re-homed to the developer-utilities zone to keep this zone semantically coherent.\n- Five viewer UI files (elapsed-time.ts, use-tick.ts, lazy-children.ts, listener-lifecycle.ts, task-audit.ts) are grouped with build infrastructure by the import graph but belong architecturally in the web-viewer zone per developer hints — setting explicit zone pins for these files would correct the misclassification."
recommendationMeta: "[object Object]"
---

# Address observation issues (9 findings)

🟠 [completed]

## Summary

- High coupling (0.71) — 3 imports target "web-dashboard"
- Low cohesion (0.29) — files are loosely related, consider splitting this zone
- The mutual three-import dependency between crash-recovery and web-dashboard creates a cycle at the zone level; restructure so crash-detector.ts is a pure utility imported by the viewer, with no reverse dependency from crash-recovery back into the dashboard.
- Zone cohesion of 0.29 and coupling of 0.71 indicates the crash-recovery files are more tightly connected to external zones than to each other; consider whether crash-detector.ts and use-crash-recovery.ts belong in separate zones (utility vs. hook) or should be merged into the web-dashboard zone they depend on.
- This zone conflates two unrelated concerns: web-viewer graph interaction tests and monorepo dev-analysis scripts. It is an algorithmic artifact, not a real architectural unit.
- Bidirectional coupling: "web-build-tooling" ↔ "web-dashboard" (9+3 crossings) — consider extracting shared interface
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects
- tests/check-gateway-regex.mjs and tests/check-gateway-test.mjs are developer-utility scripts unrelated to the landing page; they should be re-homed to the developer-utilities zone to keep this zone semantically coherent.
- Five viewer UI files (elapsed-time.ts, use-tick.ts, lazy-children.ts, listener-lifecycle.ts, task-audit.ts) are grouped with build infrastructure by the import graph but belong architecturally in the web-viewer zone per developer hints — setting explicit zone pins for these files would correct the misclassification.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-07T03:23:01.494Z
- **Completed:** 2026-03-07T03:50:28.105Z
- **Duration:** 27m
