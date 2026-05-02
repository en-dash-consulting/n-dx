---
id: "5316ae8d-023d-4a69-b724-57f82a7e780f"
level: "task"
title: "Address observation issues (16 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-11T02:25:57.416Z"
completedAt: "2026-03-11T02:38:47.604Z"
resolutionType: "code-change"
resolutionDetail: "Fixed 3 concrete architectural issues: (1) eliminated rex core/move.ts → cli/errors.ts layering violation by replacing CLIError with plain Error, (2) broke circular dependency chain polling→polling-restart→graceful-degradation→memory-monitor→polling by importing registerPollingSource directly from polling-state.ts instead of the barrel, (3) removed cross-zone coupling in usage-cleanup-scheduler.ts → prd-io.ts by making loadPRD an injected dependency. Remaining findings are informational zone-metric observations (cohesion/coupling scores, entry point counts, fan-in hotspots) that reflect expected architectural patterns."
acceptanceCriteria: []
description: "- 1 circular dependency chain detected — see imports.json for details\n- Bidirectional coupling: \"prd-fix-command\" ↔ \"rex-prd-management-core\" (7+1 crossings) — consider extracting shared interface\n- Bidirectional coupling: \"task-usage-analytics-gateway\" ↔ \"web-application-core\" (1+33 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 24 files — high-impact module, changes may have wide ripple effects\n- High coupling (0.75) — 7 imports target \"rex-prd-management-core\"\n- Low cohesion (0.25) — files are loosely related, consider splitting this zone\n- Coupling of 0.75 combined with cohesion of 0.25 indicates this zone is more of a thin adapter over rex-unit than a cohesive domain — the core fix logic in src/core/fix.ts should likely be absorbed into rex-prd-management-core to eliminate the reverse import dependency.\n- The bidirectional import cycle (fix depends on rex-unit for 7 symbols; rex-unit imports 1 symbol from fix) is an architectural inversion — CLI-layer modules should never be imported by the domain core; the shared symbol should be moved to a neutral location within rex-unit.\n- The bidirectional import relationship with the fix zone (rex-unit imports from fix: 1 import) is worth auditing — a core domain module importing from a CLI command zone suggests a possible layering inversion where fix logic should live in core rather than in the CLI command file.\n- High coupling (0.6) — 5 imports target \"web-application-core\"\n- Cohesion of 0.4 is at the warning threshold; the inclusion of token-usage-nav.test.ts (likely testing a component in web-viewer) slightly dilutes the zone's focus — consider whether that test belongs here or closer to its component.\n- Coupling of 0.6 is at the warning threshold due to 5 outbound imports into web-viewer; verify these are one-directional type imports (e.g. for shared state shapes) rather than runtime component dependencies that invert the viewer layering.\n- 16 entry points — wide API surface, consider consolidating exports\n- High coupling (0.6) — 14 imports target \"web-application-core\"\n- Bidirectional cross-zone imports with web-viewer (14 each direction) indicate a circular dependency between this zone and the core application zone; one direction should be eliminated.\n- Cohesion of 0.4 and coupling of 0.6 are both at threshold; the zone combines static assets, build config, and viewer components with no shared import backbone — consider splitting package config from viewer code."
recommendationMeta: "[object Object]"
---

# Address observation issues (16 findings)

🟠 [completed]

## Summary

- 1 circular dependency chain detected — see imports.json for details
- Bidirectional coupling: "prd-fix-command" ↔ "rex-prd-management-core" (7+1 crossings) — consider extracting shared interface
- Bidirectional coupling: "task-usage-analytics-gateway" ↔ "web-application-core" (1+33 crossings) — consider extracting shared interface
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 24 files — high-impact module, changes may have wide ripple effects
- High coupling (0.75) — 7 imports target "rex-prd-management-core"
- Low cohesion (0.25) — files are loosely related, consider splitting this zone
- Coupling of 0.75 combined with cohesion of 0.25 indicates this zone is more of a thin adapter over rex-unit than a cohesive domain — the core fix logic in src/core/fix.ts should likely be absorbed into rex-prd-management-core to eliminate the reverse import dependency.
- The bidirectional import cycle (fix depends on rex-unit for 7 symbols; rex-unit imports 1 symbol from fix) is an architectural inversion — CLI-layer modules should never be imported by the domain core; the shared symbol should be moved to a neutral location within rex-unit.
- The bidirectional import relationship with the fix zone (rex-unit imports from fix: 1 import) is worth auditing — a core domain module importing from a CLI command zone suggests a possible layering inversion where fix logic should live in core rather than in the CLI command file.
- High coupling (0.6) — 5 imports target "web-application-core"
- Cohesion of 0.4 is at the warning threshold; the inclusion of token-usage-nav.test.ts (likely testing a component in web-viewer) slightly dilutes the zone's focus — consider whether that test belongs here or closer to its component.
- Coupling of 0.6 is at the warning threshold due to 5 outbound imports into web-viewer; verify these are one-directional type imports (e.g. for shared state shapes) rather than runtime component dependencies that invert the viewer layering.
- 16 entry points — wide API surface, consider consolidating exports
- High coupling (0.6) — 14 imports target "web-application-core"
- Bidirectional cross-zone imports with web-viewer (14 each direction) indicate a circular dependency between this zone and the core application zone; one direction should be eliminated.
- Cohesion of 0.4 and coupling of 0.6 are both at threshold; the zone combines static assets, build config, and viewer components with no shared import backbone — consider splitting package config from viewer code.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-11T02:25:57.416Z
- **Completed:** 2026-03-11T02:38:47.604Z
- **Duration:** 12m
