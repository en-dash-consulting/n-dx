---
id: "b3d58129-c66a-4a58-84ce-f4906b06b700"
level: "task"
title: "Address suggestion issues (3 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-07T17:21:15.560Z"
completedAt: "2026-03-07T17:26:22.252Z"
acceptanceCriteria: []
description: "- Move check-gateway-regex.mjs and check-gateway-test.mjs to the top-level scripts/ directory (which already exists as its own zone). This single change resolves three compounding issues simultaneously: it eliminates the cohesion-1 metric artifact in web-landing (finding 4), removes the gateway-filename namespace collision flagged in finding 6, and correctly co-locates the files with other governance/CI scripts where they semantically belong. No rename is required if the files are relocated to scripts/ — the naming ambiguity only exists because they share a directory with production landing assets.\n- Set the archetype of landing.ts to [entrypoint] in sourcevision metadata. Findings 3 and 5 independently identify the same misclassification: a file that bootstraps the landing page is currently typed as [service], which excludes it from entrypoint-based dead-code detection and bundle entry audits. The fix is a one-line archetype override — no code change required.\n- Zone \"Web Unit\" (web-unit) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention"
recommendationMeta: "[object Object]"
---

# Address suggestion issues (3 findings)

🔴 [completed]

## Summary

- Move check-gateway-regex.mjs and check-gateway-test.mjs to the top-level scripts/ directory (which already exists as its own zone). This single change resolves three compounding issues simultaneously: it eliminates the cohesion-1 metric artifact in web-landing (finding 4), removes the gateway-filename namespace collision flagged in finding 6, and correctly co-locates the files with other governance/CI scripts where they semantically belong. No rename is required if the files are relocated to scripts/ — the naming ambiguity only exists because they share a directory with production landing assets.
- Set the archetype of landing.ts to [entrypoint] in sourcevision metadata. Findings 3 and 5 independently identify the same misclassification: a file that bootstraps the landing page is currently typed as [service], which excludes it from entrypoint-based dead-code detection and bundle entry audits. The fix is a one-line archetype override — no code change required.
- Zone "Web Unit" (web-unit) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention

## Info

- **Status:** completed
- **Priority:** critical
- **Level:** task
- **Started:** 2026-03-07T17:21:15.560Z
- **Completed:** 2026-03-07T17:26:22.252Z
- **Duration:** 5m
