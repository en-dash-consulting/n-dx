---
id: "d8b23226-f958-4fba-a873-eb35c9045761"
type: "change"
title: "Make item routes type-aware and remap views that use level"
slug: "make-item-routes-type-aware-and-remap"
intent: "Item CRUD routes accept type; the about 41 web files that read level move to type; the product layer becomes the home page with Plan, Work and Live remapped.\n\nLabel a capability's criteria 'capability criteria' and a work item's acceptanceCriteria 'done when' (terminology decided 2026-10-08)."
acceptanceCriteria:
  - "No web source reads level outside a compatibility shim"
  - "Plan, Work and Live e2e tests pass"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "medium"
tags:
  - "pr-21"
  - "lane-web"
  - "web"
source: "roadmap"
---
