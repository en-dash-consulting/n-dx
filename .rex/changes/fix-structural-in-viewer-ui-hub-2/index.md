---
id: "bc5defb9-d003-450a-bdba-6bc728c22ff5"
type: "change"
title: "Fix structural in viewer-ui-hub (2 findings)"
slug: "fix-structural-in-viewer-ui-hub-2"
intent: "- Bidirectional 74-edge coupling with Web Dashboard Platform is the largest cross-zone relationship in the web package — a periodic audit of import direction and gateway compliance would reduce risk of eroding the viewer↔server boundary.\n- Zone meets both dual-fragility thresholds (cohesion 0.38 < 0.4, coupling 0.63 > 0.6). As the intentional viewer composition hub, this is structurally expected, but the zone should be baseline-documented in the CLAUDE.md fragility governance table alongside web-shared and rex-cli."
touches:
  - "ed4461f5-7667-4c72-bbee-f39457b951fe"
priority: "high"
source: "sourcevision"
---
