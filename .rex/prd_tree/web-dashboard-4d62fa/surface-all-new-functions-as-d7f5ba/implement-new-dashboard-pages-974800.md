---
id: "97480040-aaa1-4bfc-a416-eb2d5bcabc2f"
level: "task"
title: "Implement new dashboard pages/sections for uncovered functions"
status: "pending"
priority: "high"
tags:
  - "web"
  - "ui"
blockedBy:
  - "15afdaf1-e70e-4be2-a5a7-4c6fcb4486b4"
source: "ndx-capture"
acceptanceCriteria:
  - "Every audit gap is addressed with a page/section or documented exclusion"
  - "New pages follow web package gateway and zone boundary rules (boundary-check.test.ts passes)"
  - "Navigation exposes all new pages/sections"
  - "pnpm build, typecheck, and web tests pass"
description: "For each gap identified in the audit, add a dashboard page or section that exposes the function so it can be used and applied from the UI. Follow web package zone governance (viewer composition through viewer-ui-hub, data access through gateways/external.ts) and add navigation entries for each new page/section."
---
