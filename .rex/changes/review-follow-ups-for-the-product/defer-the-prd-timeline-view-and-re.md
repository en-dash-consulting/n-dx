---
id: "f11fbd38-5550-4165-84dd-0eb4f66c7ac2"
type: "task"
title: "Defer the PRD timeline view and re-scope it to the Changes view"
slug: "defer-the-prd-timeline-view-and-re"
description: "Agreed with Hal on #533: the time-ordered view belongs to the Changes view (the change layer is the linear history), not to the Product page. After #533 merges, edit its item \"PRD timeline view: time-ordered default with a tree toggle and recency desaturation\": set status deferred; retitle to \"Changes view: time-ordered default with recency desaturation\" (moving its file to the new slug in the same commit); retarget the default-layout criterion at the Changes view; use completedAt, then startedAt, then lastModified (drop createdAt); note that after the cut a task's parent is its change. It is built after 1.0.0."
acceptanceCriteria:
  - "The timeline item is deferred, retitled and re-scoped to the Changes view"
  - "rex validate passes after the edit"
priority: "low"
tags:
  - "follow-ups"
  - "web"
  - "pr-533"
source: "roadmap"
---
