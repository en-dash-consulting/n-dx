---
id: "d8b23226-f958-4fba-a873-eb35c9045761"
level: "task"
title: "Make item routes type-aware and remap views that use level"
status: "completed"
priority: "medium"
tags:
  - "pr-21"
  - "lane-web"
  - "web"
source: "roadmap"
startedAt: "2026-10-12T04:06:19.268Z"
completedAt: "2026-10-12T04:56:24.420Z"
endedAt: "2026-10-12T04:56:24.420Z"
resolutionType: "code-change"
resolutionDetail: "Web reads node type through the shared/item-type.ts shim; item CRUD accepts `type`; criteria terminology applied. The home-page remap is left out: the v2 product views have no reader or route yet."
acceptanceCriteria:
  - "No web source reads level outside a compatibility shim"
  - "Plan, Work and Live e2e tests pass"
description: "Item CRUD routes accept type; the about 41 web files that read level move to type; the product layer becomes the home page with Plan, Work and Live remapped.\n\nLabel a capability's criteria 'capability criteria' and a work item's acceptanceCriteria 'done when' (terminology decided 2026-10-08)."
lastModified: "2026-10-12T04:56:24.945Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
