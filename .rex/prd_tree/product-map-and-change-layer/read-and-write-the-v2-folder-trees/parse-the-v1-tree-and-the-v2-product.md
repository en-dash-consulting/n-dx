---
id: "12138fcd-c804-4da3-bf3d-10c563ea3397"
level: "task"
title: "Parse the v1 tree and the v2 product and changes roots into one model"
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
  - "The refusal message names the tree's schema version, the newest this build understands, and how to fix it (test)"
  - "With the override set, read commands proceed with a warning and every write is still refused (test)"
description: "A dual-read parser: if .ndx/rex/product exists (schema rex/v2 in its root index.md) read product/ and changes/ with state.yaml; otherwise read the v1 prd_tree and map level to type. Refuse an unknown major schema with a clear message.\n\nThe refusal names both versions and the fix, e.g. \"PRD schema is rex/v3, this ndx understands up to rex/v2: upgrade ndx (or run ndx migrate on the other side)\". Add an explicit override for read-only inspection, NDX_IGNORE_SCHEMA_SKEW=1 or --ignore-schema-skew, which prints a warning to stderr and never allows writes."
lastModified: "2026-10-06T23:23:13.913Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
