---
id: "52ecd173-5437-47fe-b9b7-48b0c930d187"
type: "capability"
title: "Narrow jsonResponse utility scope"
slug: "narrow-jsonresponse-utility-scope"
statement: "The web server's jsonResponse helper does one narrow job, so changing it touches few routes."
source: "sourcevision"
priority: "high"
---

- Hub function: jsonResponse in packages/web/src/server/response-utils.ts is called from 22 files — changes here have wide impact, consider if responsibilities can be narrowed

## History

- 2026-10-23 editorial: statement edited
