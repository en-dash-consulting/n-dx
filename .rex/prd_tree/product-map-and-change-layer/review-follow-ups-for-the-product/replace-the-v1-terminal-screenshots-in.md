---
id: "93bde8d5-bde9-4c0d-8d6a-baf41ce3823b"
level: "task"
title: "Replace the v1 terminal screenshots in quickstart and existing-project with v2 ones"
status: "pending"
priority: "low"
tags:
  - "docs"
  - "pr-28"
source: "ndx-work"
acceptanceCriteria:
  - "quickstart.md step 3 and step 5 show a screenshot of a v2 project's output"
  - "No v1 screenshot appears outside a v1 info block"
  - "`npx vitepress build docs` passes"
description: "Out of scope for 4301fba6 (v2 docs rewrite): docs/guide/quickstart.md and existing-project.md still show documentation/ndx_add_*.png, ndx_status.png and ndx_plan.png from a v1 project. The rewrite labels them as v1 inside v1 info blocks, but there are no v2 screenshots because `ndx init` still creates v1 projects and `ndx status` does not read a v2 PRD. Capture v2 screenshots (ndx add creating an Inbox change, rex product show) once the migration (PR 23) makes init create v2 projects, and move the v1 ones out of the main flow."
lastModified: "2026-10-10T05:54:31.913Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
