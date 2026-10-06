---
id: "91461587-ce70-4f31-a6bf-ea3d42364a3c"
level: "task"
title: "Make reshape, reorganize and prune layer-aware"
status: "pending"
priority: "medium"
tags:
  - "pr-18"
  - "lane-rex-surface"
  - "rex"
  - "core"
blockedBy:
  - "08b9e858-4312-4945-9dd5-6c211884d5f6"
source: "roadmap"
acceptanceCriteria:
  - "Reshape on product nodes produces a drafted change and moves no files (test)"
  - "reorganize and prune never write under product/ (test)"
description: "Change layer works as today. On the product layer, reshape drafts a change with removed and added amendments; reorganize only reports; prune does not apply."
lastModified: "2026-10-06T16:54:30.834Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
