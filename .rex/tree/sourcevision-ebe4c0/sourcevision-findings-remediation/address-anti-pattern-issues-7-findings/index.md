---
id: "3010ce31-28c9-42c4-b918-07b6a8a1613b"
level: "task"
title: "Address anti-pattern issues (7 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-08T17:45:09.198Z"
completedAt: "2026-03-08T17:57:01.166Z"
acceptanceCriteria: []
description: "- architecture-policy.test.js is a single point of failure for four-tier hierarchy enforcement. If this file is skipped, broken, or omitted from a CI run, cross-tier import violations can merge undetected. The policy should be backed by at least one redundant mechanism (e.g. an eslint import boundary rule or a dedicated CI step that runs before package tests).\n- Only 2 integration test files exist at the monorepo boundary. As cross-package interactions grow (rex↔sourcevision data flow, hench↔rex task selection, web↔rex MCP contract), the integration ring has no mechanism to enforce proportional growth — unlike the e2e suite which has an architecture-policy guard. A test coverage policy for cross-package contracts is absent.\n- The two-phase pending-proposals.json → acknowledged-findings.json workflow has no crash-recovery sentinel. A tool run that terminates between the two writes leaves both files in an inconsistent state with no machine-detectable signal. This is a data-integrity gap that could cause silent PRD corruption on restart.\n- shared-types.ts defines types consumed cross-zone by web-dashboard but lives inside the analytics zone with no explicit export contract. Consumers reach into zone-internal types rather than through a stable interface boundary, making the contract implicit and fragile if the zone is ever refactored.\n- The phantom zone's 0.73 coupling score is being counted in aggregate web-package health metrics. Any CI gate or automated report that sums or averages zone coupling will treat the web package as unhealthy due solely to a community-detection artifact, not a real architectural problem. This false signal may cause teams to ignore legitimate future coupling regressions because the baseline is already flagged.\n- Zone mixes Node.js server code and browser Preact viewer code in a single zone. These two sub-environments are mutually exclusive at runtime — Node modules (http, fs) cannot load in the browser and vice versa. A split into web-server and web-viewer sub-zones would enforce the runtime boundary structurally, not just by convention.\n- God function: cmdPrune in packages/rex/src/cli/commands/prune.ts calls 34 unique functions — consider decomposing into smaller, focused functions"
recommendationMeta: "[object Object]"
---

# Address anti-pattern issues (7 findings)

🔴 [completed]

## Summary

- architecture-policy.test.js is a single point of failure for four-tier hierarchy enforcement. If this file is skipped, broken, or omitted from a CI run, cross-tier import violations can merge undetected. The policy should be backed by at least one redundant mechanism (e.g. an eslint import boundary rule or a dedicated CI step that runs before package tests).
- Only 2 integration test files exist at the monorepo boundary. As cross-package interactions grow (rex↔sourcevision data flow, hench↔rex task selection, web↔rex MCP contract), the integration ring has no mechanism to enforce proportional growth — unlike the e2e suite which has an architecture-policy guard. A test coverage policy for cross-package contracts is absent.
- The two-phase pending-proposals.json → acknowledged-findings.json workflow has no crash-recovery sentinel. A tool run that terminates between the two writes leaves both files in an inconsistent state with no machine-detectable signal. This is a data-integrity gap that could cause silent PRD corruption on restart.
- shared-types.ts defines types consumed cross-zone by web-dashboard but lives inside the analytics zone with no explicit export contract. Consumers reach into zone-internal types rather than through a stable interface boundary, making the contract implicit and fragile if the zone is ever refactored.
- The phantom zone's 0.73 coupling score is being counted in aggregate web-package health metrics. Any CI gate or automated report that sums or averages zone coupling will treat the web package as unhealthy due solely to a community-detection artifact, not a real architectural problem. This false signal may cause teams to ignore legitimate future coupling regressions because the baseline is already flagged.
- Zone mixes Node.js server code and browser Preact viewer code in a single zone. These two sub-environments are mutually exclusive at runtime — Node modules (http, fs) cannot load in the browser and vice versa. A split into web-server and web-viewer sub-zones would enforce the runtime boundary structurally, not just by convention.
- God function: cmdPrune in packages/rex/src/cli/commands/prune.ts calls 34 unique functions — consider decomposing into smaller, focused functions

## Info

- **Status:** completed
- **Priority:** critical
- **Level:** task
- **Started:** 2026-03-08T17:45:09.198Z
- **Completed:** 2026-03-08T17:57:01.166Z
- **Duration:** 11m
