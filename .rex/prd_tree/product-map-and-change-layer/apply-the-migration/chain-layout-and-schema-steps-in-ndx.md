---
id: "ad842166-7ac1-4875-bac8-e5f55ea18402"
level: "task"
title: "Chain layout and schema steps in ndx migrate and refuse legacy projects"
status: "pending"
priority: "high"
tags:
  - "pr-23"
  - "lane-migration"
  - "rex"
  - "core"
blockedBy:
  - "11c88bce-4e63-4e56-b0b8-041232f0a21a"
source: "roadmap"
acceptanceCriteria:
  - "A legacy fixture migrates with one command"
  - "Other commands print the refusal naming ndx migrate"
  - "ndx init creates a v2 project"
description: "ndx migrate runs versioned steps (layout to .ndx, then schema to v2) so a later schema step is one more link. Other commands refuse a legacy project and name ndx migrate. ndx init scaffolds product/index.md."
lastModified: "2026-10-06T16:54:29.385Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
