---
id: "1ddbce45-9768-4e21-bd5b-210f5d3cef47"
level: "task"
title: "Run the final migration on this repository"
status: "pending"
priority: "high"
tags:
  - "pr-26"
  - "lane-migration"
  - "core"
blockedBy:
  - "21735168-45e9-4fc5-832f-1d8c6dc666a5"
source: "roadmap"
acceptanceCriteria:
  - "main's PRD is on .ndx/rex with schema rex/v2"
  - "rex health reports no errors"
  - "A patch changeset records the migration, and no changeset is major or announces 1.0.0"
description: "Rebase, run ndx migrate --apply with the approved plan, and add a patch changeset for the migration. PRD writes on main pause only for this step. No major changeset: until Ryan decides to cut 1.0.0, no changeset may be major and no changeset text may announce 1.0.0 (the six @n-dx packages are one fixed version group, so one major bumps all six)."
lastModified: "2026-10-09T19:07:28.905Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
