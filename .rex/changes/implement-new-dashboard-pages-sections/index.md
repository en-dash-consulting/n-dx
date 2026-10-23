---
id: "97480040-aaa1-4bfc-a416-eb2d5bcabc2f"
type: "change"
title: "Implement new dashboard pages/sections for uncovered functions"
slug: "implement-new-dashboard-pages-sections"
intent: "For each gap identified in the audit, add a dashboard page or section that exposes the function so it can be used and applied from the UI. Follow web package zone governance (viewer composition through viewer-ui-hub, data access through gateways/external.ts) and add navigation entries for each new page/section."
acceptanceCriteria:
  - "Every audit gap is addressed with a page/section or documented exclusion"
  - "New pages follow web package gateway and zone boundary rules (boundary-check.test.ts passes)"
  - "Navigation exposes all new pages/sections"
  - "pnpm build, typecheck, and web tests pass"
amends: [{"target":"d7f5ba08-a413-44f2-a560-0423be6b4413","delta":"modified","summary":"Implement new dashboard pages/sections for uncovered functions","base":"9f4d51093c12065adc5227338edddbe8c67a55036b42efb285cdcba7e3c06648"}]
priority: "high"
tags:
  - "web"
  - "ui"
source: "ndx-capture"
blockedBy:
  - "15afdaf1-e70e-4be2-a5a7-4c6fcb4486b4"
---
