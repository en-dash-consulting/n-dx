---
id: "bbcf2eba-68d6-41af-8fb6-b4469218f9a4"
level: "task"
title: "Address observation issues (14 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-11T14:10:39.289Z"
completedAt: "2026-03-11T14:15:54.820Z"
resolutionType: "code-change"
resolutionDetail: "Split loe-display.test.ts to fix zone misclassification, added two-consumer rule enforcement test for web-shared, verified server-usage-scheduler upward imports are type-only. Remaining findings acknowledged as deliberate architectural choices (satellite zones, composition root entry points)."
acceptanceCriteria: []
description: "- High coupling (0.75) — 8 imports target \"rex-prd-engine\"\n- Low cohesion (0.25) — files are loosely related, consider splitting this zone\n- Cohesion of 0.25 and coupling of 0.75 indicate this is a thin feature satellite rather than a cohesive module — 8 imports flow into rex-unit with little internal binding.\n- loe-display.test.ts appears in this zone while its source file is in rex-unit — the test's import path pulled it into this cluster, which may cause misclassification in tooling.\n- Bidirectional coupling: \"chunked-review\" ↔ \"rex-prd-engine\" (8+2 crossings) — consider extracting shared interface\n- Bidirectional coupling: \"server-usage-scheduler\" ↔ \"web-dashboard-platform\" (3+37 crossings) — consider extracting shared interface\n- High coupling (0.75) — 7 imports target \"rex-prd-engine\"\n- Low cohesion (0.25) — files are loosely related, consider splitting this zone\n- Cohesion of 0.25 and coupling of 0.75 reflect a deliberately small, focused command — not a structural problem, but a candidate for absorption into rex-unit if the fix surface grows.\n- 9 entry points — wide API surface, consider consolidating exports\n- 10 entry points — wide API surface, consider consolidating exports\n- 14 entry points — wide API surface, consider consolidating exports\n- Cohesion of 0.36 is below the 0.4 warning threshold — the two exported utilities (data-files and view-id) share little internal relationship, making the zone feel artificially bundled.\n- Coupling of 0.64 exceeds the 0.6 warning threshold — five inbound import edges from web-viewer alone make this the highest-traffic foundation layer in the web package."
recommendationMeta: "[object Object]"
---

# Address observation issues (14 findings)

🟠 [completed]

## Summary

- High coupling (0.75) — 8 imports target "rex-prd-engine"
- Low cohesion (0.25) — files are loosely related, consider splitting this zone
- Cohesion of 0.25 and coupling of 0.75 indicate this is a thin feature satellite rather than a cohesive module — 8 imports flow into rex-unit with little internal binding.
- loe-display.test.ts appears in this zone while its source file is in rex-unit — the test's import path pulled it into this cluster, which may cause misclassification in tooling.
- Bidirectional coupling: "chunked-review" ↔ "rex-prd-engine" (8+2 crossings) — consider extracting shared interface
- Bidirectional coupling: "server-usage-scheduler" ↔ "web-dashboard-platform" (3+37 crossings) — consider extracting shared interface
- High coupling (0.75) — 7 imports target "rex-prd-engine"
- Low cohesion (0.25) — files are loosely related, consider splitting this zone
- Cohesion of 0.25 and coupling of 0.75 reflect a deliberately small, focused command — not a structural problem, but a candidate for absorption into rex-unit if the fix surface grows.
- 9 entry points — wide API surface, consider consolidating exports
- 10 entry points — wide API surface, consider consolidating exports
- 14 entry points — wide API surface, consider consolidating exports
- Cohesion of 0.36 is below the 0.4 warning threshold — the two exported utilities (data-files and view-id) share little internal relationship, making the zone feel artificially bundled.
- Coupling of 0.64 exceeds the 0.6 warning threshold — five inbound import edges from web-viewer alone make this the highest-traffic foundation layer in the web package.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-11T14:10:39.289Z
- **Completed:** 2026-03-11T14:15:54.820Z
- **Duration:** 5m
