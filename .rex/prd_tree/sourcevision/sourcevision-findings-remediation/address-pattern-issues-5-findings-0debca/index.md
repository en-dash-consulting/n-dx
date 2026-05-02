---
id: "0debcab8-0b82-4b67-99ef-0a4bcfc81032"
level: "task"
title: "Address pattern issues (5 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-07T02:33:46.980Z"
completedAt: "2026-03-07T02:39:29.935Z"
acceptanceCriteria: []
description: "- crash-recovery has only 1 incoming call-graph edge despite 3 cross-zone import edges from web-viewer. The zone is consumed by a single caller at runtime, making it a de facto singleton utility. This strengthens the case for absorbing it into web-dashboard as an internal sub-module rather than maintaining a separate zone boundary.\n- Generated artifact HENCH_CALLGRAPH_FINDINGS.md is committed but has no CI regeneration-and-diff guard; it can silently go stale after hench source changes\n- A single gateway file (src/prd/rex-gateway.ts) is the only cross-zone coupling surface for 160 files; gateway API breakage has maximum blast radius within hench — no incremental migration path exists if the rex API changes.\n- Orchestration-to-domain boundary is enforced at runtime only (subprocess spawning); a mismatched CLI argument or removed subcommand will produce a silent runtime failure with no compile-time safety net.\n- Zone conflates web-package unit tests with monorepo-root contract scripts; splitting into separate zones aligned to their physical location would improve discoverability and ownership clarity"
recommendationMeta: "[object Object]"
---

# Address pattern issues (5 findings)

🟠 [completed]

## Summary

- crash-recovery has only 1 incoming call-graph edge despite 3 cross-zone import edges from web-viewer. The zone is consumed by a single caller at runtime, making it a de facto singleton utility. This strengthens the case for absorbing it into web-dashboard as an internal sub-module rather than maintaining a separate zone boundary.
- Generated artifact HENCH_CALLGRAPH_FINDINGS.md is committed but has no CI regeneration-and-diff guard; it can silently go stale after hench source changes
- A single gateway file (src/prd/rex-gateway.ts) is the only cross-zone coupling surface for 160 files; gateway API breakage has maximum blast radius within hench — no incremental migration path exists if the rex API changes.
- Orchestration-to-domain boundary is enforced at runtime only (subprocess spawning); a mismatched CLI argument or removed subcommand will produce a silent runtime failure with no compile-time safety net.
- Zone conflates web-package unit tests with monorepo-root contract scripts; splitting into separate zones aligned to their physical location would improve discoverability and ownership clarity

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-07T02:33:46.980Z
- **Completed:** 2026-03-07T02:39:29.935Z
- **Duration:** 5m
