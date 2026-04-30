---
id: "39caaaed-9d69-4e6a-91bd-6327deffd318"
level: "task"
title: "Address anti-pattern issues (12 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-08T07:02:27.647Z"
completedAt: "2026-03-08T07:14:19.862Z"
acceptanceCriteria: []
description: "- The analysis/ failure-recovery quadrant (adaptive, review, spin, stuck) has no shared interface or abstract contract — each state is a concrete module called directly by the agent loop. This makes the loop a fan-in point coupled to all four implementations; adding a new recovery state requires modifying the loop rather than registering a new implementation, violating the open-closed principle at the one layer where extensibility matters most.\n- landing.ts has no dedicated build target visible in zone metadata; if it shares the viewer's tsconfig or esbuild config, landing page code may be bundled into the viewer artifact, and viewer code changes could silently break the landing page compilation\n- Recorded zone insight incorrectly states rex-gateway.ts is hosted in mcp-route-layer when it is actually in web-dashboard; the integration seam zone (mcp-route-layer) should own both gateways it bridges — moving rex-gateway.ts here would make the dual-package import surface auditable from a single zone\n- Authoritative design documents (prd-steward-vision.md) and time-stamped analysis snapshots (2026-03-03-refresh-*.md) are structural peers in a flat docs/ directory with no convention distinguishing them — readers cannot determine whether a given file represents current policy or a historical artifact, creating silent authority ambiguity that grows as the doc count increases.\n- Architecture policy enforcement is deferred to e2e tests only; no build-time import-graph check (e.g. dependency-cruiser, eslint-plugin-import) enforces the spawn-only rule during typecheck or unit-test CI steps, leaving a window where cross-layer imports can land undetected if e2e is skipped.\n- archive.json grows without bound — unlike execution-log.jsonl which uses file rotation, dismissed PRD items have no retention policy or size cap. Long-running projects with repeated rex analyze cycles will accumulate all-time dismissed items, creating latent parse-time and disk-usage risk with no automated remediation path.\n- task-usage.ts (zone entry point) has no unit test while both supporting files do; entry-point logic (aggregation, data routing) should be the first surface tested, not the last — add a unit test for task-usage.ts before the zone's public API surface grows\n- Four viewer UI files (elapsed-time.ts, use-tick.ts, route-state.ts, task-audit.ts) are zone-members of web-build-infrastructure despite being functionally unrelated to build tooling. Any zone-scoped policy applied here — linting rules, ownership, CI gates — would silently govern UI code under a build-infrastructure label, producing incorrect policy application with no visible error signal.\n- Zone contains 3 viewer files that the project zone hints explicitly place in web-viewer; the micro-zone contradicts the zone hint policy rather than refining it — dissolving this zone by merging into web-viewer eliminates the fragmentation and aligns the zone map with stated intent\n- rex-gateway.ts is classified inside web-dashboard while its structurally equivalent peer domain-gateway.ts is classified inside mcp-route-layer; gateways should be co-located in the zone that owns the integration boundary (mcp-route-layer) to make the full cross-package import surface auditable in one place\n- God function: registerMcpTools in packages/sourcevision/src/cli/mcp.ts calls 36 unique functions — consider decomposing into smaller, focused functions\n- God function: <module> in scripts/hench-callgraph-analysis.mjs calls 33 unique functions — consider decomposing into smaller, focused functions"
recommendationMeta: "[object Object]"
---

# Address anti-pattern issues (12 findings)

🟠 [completed]

## Summary

- The analysis/ failure-recovery quadrant (adaptive, review, spin, stuck) has no shared interface or abstract contract — each state is a concrete module called directly by the agent loop. This makes the loop a fan-in point coupled to all four implementations; adding a new recovery state requires modifying the loop rather than registering a new implementation, violating the open-closed principle at the one layer where extensibility matters most.
- landing.ts has no dedicated build target visible in zone metadata; if it shares the viewer's tsconfig or esbuild config, landing page code may be bundled into the viewer artifact, and viewer code changes could silently break the landing page compilation
- Recorded zone insight incorrectly states rex-gateway.ts is hosted in mcp-route-layer when it is actually in web-dashboard; the integration seam zone (mcp-route-layer) should own both gateways it bridges — moving rex-gateway.ts here would make the dual-package import surface auditable from a single zone
- Authoritative design documents (prd-steward-vision.md) and time-stamped analysis snapshots (2026-03-03-refresh-*.md) are structural peers in a flat docs/ directory with no convention distinguishing them — readers cannot determine whether a given file represents current policy or a historical artifact, creating silent authority ambiguity that grows as the doc count increases.
- Architecture policy enforcement is deferred to e2e tests only; no build-time import-graph check (e.g. dependency-cruiser, eslint-plugin-import) enforces the spawn-only rule during typecheck or unit-test CI steps, leaving a window where cross-layer imports can land undetected if e2e is skipped.
- archive.json grows without bound — unlike execution-log.jsonl which uses file rotation, dismissed PRD items have no retention policy or size cap. Long-running projects with repeated rex analyze cycles will accumulate all-time dismissed items, creating latent parse-time and disk-usage risk with no automated remediation path.
- task-usage.ts (zone entry point) has no unit test while both supporting files do; entry-point logic (aggregation, data routing) should be the first surface tested, not the last — add a unit test for task-usage.ts before the zone's public API surface grows
- Four viewer UI files (elapsed-time.ts, use-tick.ts, route-state.ts, task-audit.ts) are zone-members of web-build-infrastructure despite being functionally unrelated to build tooling. Any zone-scoped policy applied here — linting rules, ownership, CI gates — would silently govern UI code under a build-infrastructure label, producing incorrect policy application with no visible error signal.
- Zone contains 3 viewer files that the project zone hints explicitly place in web-viewer; the micro-zone contradicts the zone hint policy rather than refining it — dissolving this zone by merging into web-viewer eliminates the fragmentation and aligns the zone map with stated intent
- rex-gateway.ts is classified inside web-dashboard while its structurally equivalent peer domain-gateway.ts is classified inside mcp-route-layer; gateways should be co-located in the zone that owns the integration boundary (mcp-route-layer) to make the full cross-package import surface auditable in one place
- God function: registerMcpTools in packages/sourcevision/src/cli/mcp.ts calls 36 unique functions — consider decomposing into smaller, focused functions
- God function: <module> in scripts/hench-callgraph-analysis.mjs calls 33 unique functions — consider decomposing into smaller, focused functions

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-08T07:02:27.647Z
- **Completed:** 2026-03-08T07:14:19.862Z
- **Duration:** 11m
