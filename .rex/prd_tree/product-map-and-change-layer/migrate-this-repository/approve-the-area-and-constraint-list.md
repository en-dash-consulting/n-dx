---
id: "8126e68e-9c80-4a35-a049-ac0415c38896"
level: "task"
title: "Approve the area and constraint list for this repository"
status: "pending"
priority: "high"
tags:
  - "pr-26"
  - "lane-migration"
  - "core"
source: "roadmap"
acceptanceCriteria:
  - "The approved list is recorded on this item and applied through the plan's entries"
  - "Per-area stewards are named after the cut"
description: "Ryan and one coworker review the job-shaped area and constraint list from ndx migrate --plan against the tests in the design: stable, nameable, balanced, and the 0.7.1 and 0.8.0 changes each place in one primary area. Assign per-area stewards.\n\nDecided 2026-10-22 (Ryan): of the 24 areas the rules propose, dissolve five as delivery containers: Security & Data Safety (9e34fc07), Hotfix · Skip CI on draft pull requests (d94e33aa), Repository infrastructure (c3f5a0c4), Dashboard UI cleanup and the Analyze page as a tile dashboard (914926bd), and Fix · sourcevision incremental imports drop Go package-directory edges (efafdb61). The other 19 are approved; Language packs for sourcevision stays and is renamed after the cut. The plan file has no field for approvals or stewards, and migrate-apply reads only each entry's target and parent, so each dissolve sets that area's plan entry to target \"release\"; the dry run checks it. Stewards are named after the cut, in the v2 area frontmatter."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-22T18:49:10.000Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
