---
id: "4e4bec55-c0db-4d0b-a255-ca23bade7672"
level: "task"
title: "docs/guide/skills.md says the PRD skills' v2 versions have not shipped and lists ndx-reshape as v1-only"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "docs/guide/skills.md no longer says the PRD skills' v2 versions ship later"
  - "The ndx-reshape row in docs/guide/skills.md names no epic or level change"
  - "The skills.md descriptions for the five PRD skills match or are consistent with packages/core/assistant-assets/manifest.json"
description: "Found by the adversarial review of 617878ae. Pre-existing: d5f63839 rewrote /ndx-capture, /ndx-plan, /ndx-reshape, /ndx-work and /ndx-adversarial-review to branch on the layout, but docs/guide/skills.md:34 still says the skills \"are written for the v1 PRD ... The skills' v2 versions ship with the migration\", and docs/guide/skills.md:29 describes ndx-reshape as \"Restructure a v1 PRD tree — regroup epics, change levels, merge overlaps\", which no longer matches the manifest description (\"Restructure the PRD — regroup, reparent, merge overlaps and place changes\"). Scenario: a v2 user reads the guide, is told the skills do not support v2, and falls back to raw add_item/place_change. Nothing breaks; the docs misinform. No test reads skills.md descriptions against the manifest (docs-skill-refs checks references only), so a docs-only edit selects no suite. Fix: rewrite line 34 to say the skills detect the layout via get_prd_status, and align the table row with the manifest description. Optional: a test comparing the skills.md table descriptions to the manifest. Verdict out-of-scope (predates this change), low."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T04:33:15.944Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
