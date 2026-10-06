---
id: "12138fcd-c804-4da3-bf3d-10c563ea3397"
level: "task"
title: "Parse the v1 tree and the v2 map and changes roots into one model"
status: "pending"
priority: "high"
tags:
  - "pr-09"
  - "lane-rex-store"
  - "rex"
source: "roadmap"
acceptanceCriteria:
  - "The v1 tree in this repository parses to the same items as today (golden test)"
  - "A v2 fixture parses with intent and state merged"
  - "An unknown schema major is refused with a message naming the version"
description: "A dual-read parser: if .ndx/rex/product exists (schema rex/v2 in its root index.md) read product/ and changes/ with state.yaml; otherwise read the v1 prd_tree and map level to type. Refuse an unknown major schema with a clear message."
lastModified: "2026-10-06T16:54:36.182Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
