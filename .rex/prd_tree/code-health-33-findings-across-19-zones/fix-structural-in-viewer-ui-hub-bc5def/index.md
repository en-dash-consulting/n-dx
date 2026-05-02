---
id: "bc5defb9-d003-450a-bdba-6bc728c22ff5"
level: "feature"
title: "Fix structural in viewer-ui-hub (2 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-19T03:05:51.342Z"
completedAt: "2026-04-19T03:05:51.342Z"
acceptanceCriteria: []
description: "- Bidirectional 74-edge coupling with Web Dashboard Platform is the largest cross-zone relationship in the web package — a periodic audit of import direction and gateway compliance would reduce risk of eroding the viewer↔server boundary.\n- Zone meets both dual-fragility thresholds (cohesion 0.38 < 0.4, coupling 0.63 > 0.6). As the intentional viewer composition hub, this is structurally expected, but the zone should be baseline-documented in the CLAUDE.md fragility governance table alongside web-shared and rex-cli."
recommendationMeta: "[object Object]"
---

# Fix structural in viewer-ui-hub (2 findings)

🟠 [completed]

## Summary

- Bidirectional 74-edge coupling with Web Dashboard Platform is the largest cross-zone relationship in the web package — a periodic audit of import direction and gateway compliance would reduce risk of eroding the viewer↔server boundary.
- Zone meets both dual-fragility thresholds (cohesion 0.38 < 0.4, coupling 0.63 > 0.6). As the intentional viewer composition hub, this is structurally expected, but the zone should be baseline-documented in the CLAUDE.md fragility governance table alongside web-shared and rex-cli.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Fix structural in viewer-ui-hub: Bidirectional 74-edge coupling with Web Dashboard Platform is the largest cross- (+1 more) | task | completed | 2026-04-19 |

## Info

- **Status:** completed
- **Priority:** high
- **Level:** feature
- **Started:** 2026-04-19T03:05:51.342Z
- **Completed:** 2026-04-19T03:05:51.342Z
- **Duration:** < 1m
