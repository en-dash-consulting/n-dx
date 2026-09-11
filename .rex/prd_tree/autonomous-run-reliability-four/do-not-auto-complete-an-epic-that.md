---
id: "8cb6899d-7edb-45d1-a938-5f554ff12c72"
level: "task"
title: "Do not auto-complete an epic that still has deferred, blocked or failing children"
status: "deferred"
priority: "high"
tags:
  - "rex"
  - "gh-364"
source: "GitHub issues #362-#365, filed from the wave-1 session 2026-09-11"
startedAt: "2026-09-11T20:47:24.570Z"
acceptanceCriteria:
  - "An epic with any deferred, blocked or failing child does not auto-complete."
  - "An epic whose children are all completed still auto-completes as today."
  - "The same predicate is used everywhere completion is inferred from children (grep for the existing checks; fix all of them)."
  - "Unit tests cover each non-terminal child status."
description: "GitHub #364. Severity: high — misreports progress, and does so precisely when a run was interrupted, which is when accurate status matters most.\n\nFAILURE SCENARIO\nEpic b66dc09e (\"0.6.0 / PR 3\") was marked completed with three of its five children in deferred, after the account hit a session limit mid-loop. Anyone reading ndx status, the dashboard, or a release burndown saw PR 3 as finished. It was not: one of the deferred tasks was \"stop writing local-scope MCP registrations\", so ndx init was at that moment writing the new tracked .mcp.json AND the old absolute-path local-scope entries AND still stripping user scope — a half-migration, reported as done.\n\nSOLUTION\nAuto-completion should treat only terminal SUCCESSFUL states as done. deferred, blocked and failing are not done. Audit every place completion is inferred from children, including cascadeParentReset, not just the one path that produced this."
lastModified: "2026-09-11T20:48:05.580Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
