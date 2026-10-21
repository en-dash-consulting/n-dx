---
id: "26a42aed-6a93-471f-9ab4-259b97877d68"
level: "feature"
title: "Readiness and infrastructure visible in the dashboard"
status: "pending"
priority: "high"
source: "ndx-capture"
acceptanceCriteria:
  - "The dashboard Overview shows SDLC readiness and discovered infrastructure"
  - "Hub project cards show readiness and infrastructure counts"
  - "Infrastructure discovery reports no resources from test fixtures"
description: "Sourcevision writes readiness.json, sdlc-profile.json and infrastructure.json, and GET /api/status already serves sv.readiness and an sv.infrastructure count (packages/web/src/server/routes-status.ts). No viewer or hub UI renders any of it: the Overview has no section for CI/CD readiness or discovered infrastructure, the hub cards stop at repoName/remoteHost, and the iso-map hero is the only place infrastructure appears. This feature makes the outside infrastructure and pipeline maturity visible and usable."
lastModified: "2026-10-21T04:17:09.301Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Hub project cards show readiness and infrastructure counts](./hub-project-cards-show-readiness-and.md) | pending |
| [Infrastructure discovery skips test fixtures](./infrastructure-discovery-skips-test.md) | completed |
| [Overview section for SDLC readiness and discovered infrastructure](./overview-section-for-sdlc-readiness.md) | completed |
