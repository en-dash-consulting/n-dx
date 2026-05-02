---
id: "ed7a9451-cccb-45a7-b028-62afb3714b0a"
level: "task"
title: "Address observation issues (15 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-11T04:33:32.070Z"
completedAt: "2026-03-11T04:42:34.428Z"
resolutionType: "acknowledgment"
resolutionDetail: "Gitignored execution-log.jsonl files (code change) and acknowledged all 15 observation findings after auditing each one: bidirectional couplings are community-detection artifacts or expected CLI dispatch patterns; fan-in hotspot on schema/index.ts is expected for a barrel file; hench-agent-monitor low cohesion/high coupling is a pure leaf consumer cluster; rex-fix-command metrics reflect thin CLI shim delegation; entry point counts are proportional to zone sizes; cross-tier imports verified as non-existent or type-only."
acceptanceCriteria: []
description: "- Bidirectional coupling: \"rex-fix-command\" ↔ \"rex-prd-engine\" (7+1 crossings) — consider extracting shared interface\n- Bidirectional coupling: \"web-application-core\" ↔ \"web-viewer-messaging-pipeline\" (22+16 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 24 files — high-impact module, changes may have wide ripple effects\n- High coupling (0.71) — 11 imports target \"web-application-core\"\n- Low cohesion (0.29) — files are loosely related, consider splitting this zone\n- Cohesion of 0.29 is below the 0.4 threshold, likely because the community-detection algorithm sees the four files as loosely connected within the broader viewer graph; semantically they are tightly related around hench observability.\n- Coupling of 0.71 exceeds the 0.6 warning threshold; the zone has no internal edges compared to its 11 outbound imports into web-viewer, making it a pure leaf consumer cluster — splitting it further would not reduce coupling.\n- High coupling (0.75) — 7 imports target \"rex-prd-engine\"\n- Low cohesion (0.25) — files are loosely related, consider splitting this zone\n- Coupling 0.75 reflects a thin command layer that delegates heavily to rex-unit — acceptable for a CLI shim, but the reverse edge (rex-unit → fix: 1 import) creates a bidirectional dependency that should be audited for circular risk.\n- Rex dogfoods its own PRD tooling by storing .rex/ state inside the package directory; this is architecturally intentional but the execution-log.jsonl committed to the repo should be gitignored to avoid noisy diffs.\n- 20 entry points — wide API surface, consider consolidating exports\n- web-unit imports web-application-core 7 times; since routes-data.ts is a server route handler, confirm these imports are type-only (stripped at compile time) and do not introduce a runtime dependency from server routing logic into viewer modules.\n- sourcevision (domain layer) imports this web-server zone once; domain packages should not depend on web-tier modules — verify this reference is a type-only import from shared-types.ts that can be relocated to a foundation-tier package if it grows.\n- 10 entry points — wide API surface, consider consolidating exports"
recommendationMeta: "[object Object]"
---

# Address observation issues (15 findings)

🟠 [completed]

## Summary

- Bidirectional coupling: "rex-fix-command" ↔ "rex-prd-engine" (7+1 crossings) — consider extracting shared interface
- Bidirectional coupling: "web-application-core" ↔ "web-viewer-messaging-pipeline" (22+16 crossings) — consider extracting shared interface
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 24 files — high-impact module, changes may have wide ripple effects
- High coupling (0.71) — 11 imports target "web-application-core"
- Low cohesion (0.29) — files are loosely related, consider splitting this zone
- Cohesion of 0.29 is below the 0.4 threshold, likely because the community-detection algorithm sees the four files as loosely connected within the broader viewer graph; semantically they are tightly related around hench observability.
- Coupling of 0.71 exceeds the 0.6 warning threshold; the zone has no internal edges compared to its 11 outbound imports into web-viewer, making it a pure leaf consumer cluster — splitting it further would not reduce coupling.
- High coupling (0.75) — 7 imports target "rex-prd-engine"
- Low cohesion (0.25) — files are loosely related, consider splitting this zone
- Coupling 0.75 reflects a thin command layer that delegates heavily to rex-unit — acceptable for a CLI shim, but the reverse edge (rex-unit → fix: 1 import) creates a bidirectional dependency that should be audited for circular risk.
- Rex dogfoods its own PRD tooling by storing .rex/ state inside the package directory; this is architecturally intentional but the execution-log.jsonl committed to the repo should be gitignored to avoid noisy diffs.
- 20 entry points — wide API surface, consider consolidating exports
- web-unit imports web-application-core 7 times; since routes-data.ts is a server route handler, confirm these imports are type-only (stripped at compile time) and do not introduce a runtime dependency from server routing logic into viewer modules.
- sourcevision (domain layer) imports this web-server zone once; domain packages should not depend on web-tier modules — verify this reference is a type-only import from shared-types.ts that can be relocated to a foundation-tier package if it grows.
- 10 entry points — wide API surface, consider consolidating exports

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-11T04:33:32.070Z
- **Completed:** 2026-03-11T04:42:34.428Z
- **Duration:** 9m
