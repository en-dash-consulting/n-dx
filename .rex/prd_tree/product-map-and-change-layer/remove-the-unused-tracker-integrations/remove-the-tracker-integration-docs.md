---
id: "ec5b4506-39ff-4737-bb6b-f7dab146f9b6"
level: "task"
title: "Remove the tracker integration docs and record the removal"
status: "completed"
priority: "medium"
tags:
  - "pr-03"
  - "lane-rex-surface"
  - "rex"
  - "web"
blockedBy:
  - "1444b872-6285-4629-a8dd-d7b92971790f"
source: "roadmap"
startedAt: "2026-10-06T07:18:52.587Z"
completedAt: "2026-10-06T07:42:52.974Z"
endedAt: "2026-10-06T07:42:52.974Z"
resolutionType: "code-change"
resolutionDetail: "Excised the tracker-adapter documentation from the guides, command/MCP references and rex's README; corrected three references to deleted files; dropped .rex/adapters.json from the ndx init gitignore template and this repo's .gitignore; added .changeset/remove-tracker-docs.md. change-management.md was kept rather than deleted — see the log entry."
acceptanceCriteria:
  - "No user doc describes the removed adapters or their config keys"
  - "A changeset describes the removal"
description: "Delete change-management.md and any README or docs section describing the adapters. Add a changeset noting the removal and that a new bridge comes later."
lastModified: "2026-10-06T07:42:53.403Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
