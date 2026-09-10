---
id: "0aea078f-1a1e-4264-9c48-82e0af192c4e"
level: "task"
title: "Bundle import skips validateDAG and LEVEL_HIERARCHY — cycles and illegal placement reach the tree"
status: "pending"
priority: "medium"
tags:
  - "pr-review"
  - "severity:medium"
source: "pr-review"
acceptanceCriteria:
  - "parseBundle rejects a bundle containing a blockedBy cycle with a BundleError, before any store access"
  - "Replace-mode import rejects a bundle whose root items are not root-legal levels"
  - "Merge-mode graft refuses placement that violates LEVEL_HIERARCHY, naming the parent and child levels"
  - "Tests cover all three: cycle, illegal root level, illegal graft placement"
description: "Verdict: valid remainder of two review findings (the duplicate-id half was already fixed by assertUniqueIds, commit 1ea3d522). Verified: neither parseBundle nor cmdImportBundle calls validateDAG (core/dag.ts), which update.ts, add.ts, mcp-tools.ts, report.ts and create-from-recommendations.ts all consult; and mergeBundle's graft does a bare target.push(node) (core/prd-bundle.ts:552) with no LEVEL_HIERARCHY check, unlike insertChild (core/tree.ts:98), core/move.ts:91, and core/structural.ts.\n\nFailure scenarios: (1) a bundle with a blockedBy cycle imports cleanly, then wedges get_next_task and report; (2) a bundle whose root item is not an epic lands at PRD root in replace mode, where feature/task/subtask are illegal; (3) merge mode grafts bundle children under a same-id local item that a local reshape has since re-levelled, producing e.g. features under a task. validateDocument (the only post-transaction guard) is field-shape only and catches none of these — they surface later as rex health / reorganize violations.\n\nSolution: in parseBundle, run validateDAG over candidate.items and reject with BundleError on a cycle (rejection there costs nothing — before any write). In mergeBundle, validate level placement: check LEVEL_HIERARCHY for the graft target (or route through insertChild) and check root items are root-legal in replace mode."
lastModified: "2026-09-10T19:09:31.041Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
