---
id: "97480040-aaa1-4bfc-a416-eb2d5bcabc2f"
level: "task"
title: "Implement new dashboard pages/sections for uncovered functions"
status: "in_progress"
priority: "high"
tags:
  - "web"
  - "ui"
blockedBy:
  - "15afdaf1-e70e-4be2-a5a7-4c6fcb4486b4"
source: "ndx-capture"
startedAt: "2026-08-12T18:55:55.171Z"
acceptanceCriteria:
  - "Every audit gap is addressed with a page/section or documented exclusion"
  - "New pages follow web package gateway and zone boundary rules (boundary-check.test.ts passes)"
  - "Navigation exposes all new pages/sections"
  - "pnpm build, typecheck, and web tests pass"
description: "For each gap identified in the audit, add a dashboard page or section that exposes the function so it can be used and applied from the UI. Follow web package zone governance (viewer composition through viewer-ui-hub, data access through gateways/external.ts) and add navigation entries for each new page/section."
---

## Children

| Title | Status |
|-------|--------|
| [Adaptive optimization page](./adaptive-optimization-page.md) | completed |
| [Add ndx refresh trigger to dashboard](./add-ndx-refresh-trigger-to-dashboard.md) | completed |
| [Requirements and traceability page](./requirements-and-traceability-page.md) | completed |
| [Restore orphaned ZonesView and AnalysisView into navigation](./restore-orphaned-zonesview-and-02333a.md) | completed |
| [Tier 3 small coverage items](./tier-3-small-coverage-items.md) | pending |
| [Token usage depth and self-heal live view](./token-usage-depth-and-self-heal-c8d17f.md) | pending |
| [Validation view actions: rex fix, reshape, ndx ci triggers](./validation-view-actions-rex-fix-e1e765.md) | pending |
