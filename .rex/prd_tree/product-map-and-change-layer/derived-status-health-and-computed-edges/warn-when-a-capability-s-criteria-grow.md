---
id: "8c18cb17-e9b6-496c-ae18-e442448a4a61"
level: "task"
title: "Warn when a capability's criteria grow past a threshold"
status: "pending"
priority: "medium"
tags:
  - "pr-11"
  - "lane-rex-domain"
  - "rex"
  - "token-budget"
source: "roadmap"
acceptanceCriteria:
  - "rex health warns for a capability whose own plus inherited criteria exceed the threshold, and names it (test)"
  - "The threshold defaults to 15 and is configurable in .n-dx.json"
  - "A capability at or under the threshold produces no warning (test)"
description: "Apply adds criteria to a capability; replacing or removing them by id only happens when someone does it. A capability that collects dozens of criteria over time makes every agent brief that touches it larger, until the brief's budget trims it. This is the product layer's equivalent of needing compaction. Add a rex health warning when a capability's criteria (including inherited ones from a parent capability) exceed a threshold, default 15, configurable, naming the capability and suggesting a modify change that consolidates criteria, or rex product tidy once it exists (1.x)."
lastModified: "2026-10-06T23:22:33.050Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
