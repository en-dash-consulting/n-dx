---
id: "1ddbce45-9768-4e21-bd5b-210f5d3cef47"
level: "task"
title: "Run the final migration on this repository and add the major changeset"
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
  - "The major changeset is present"
description: "Rebase, run ndx migrate --apply with the approved plan, add the major changeset for the fixed group. PRD writes on main pause only for this step."
lastModified: "2026-10-06T04:20:40.851Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
