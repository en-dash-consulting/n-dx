---
id: "1f1e011a-313d-4602-b407-7876fbd05302"
level: "task"
title: "Count project content under .rex/ and .ndx/ as changes in the completion check"
status: "pending"
priority: "high"
tags:
  - "hench"
  - "bug"
  - "completion-gate"
source: "ndx-capture"
acceptanceCriteria:
  - "A run whose only change is .rex/workflow.md is treated as having changes and goes through the test gate (test)"
  - "The same holds on the .ndx/ layout for the container's rex/workflow.md (test)"
  - "A run whose only change is PRD status bookkeeping, the execution log or acknowledged-findings.json is still treated as no changes (test)"
  - "BOOKKEEPING_PREFIXES and the completion diff summary share one list resolved through the layout resolver"
description: "Found while fixing #539: a task that only edits .rex/workflow.md can never complete through ndx work. Before the test gate, hench decides whether a run changed anything, and discoverChangedFiles filters with BOOKKEEPING_PREFIXES (packages/hench, changed-files.ts:73): [\".rex/\", \".hench/\", \"<.ndx container>/\"]. Everything under those prefixes counts as bookkeeping, but some of it is project content: .rex/workflow.md goes into every agent brief, and .rex/config.json is project configuration. So a workflow-only change is rejected as \"no changes\" and the gate never runs. The same happens on the .ndx/ layout, where the whole container is excluded, including its rex/workflow.md.\n\nFix: replace the blanket prefixes with an explicit list of bookkeeping paths, resolved through the layout resolver (llm-client layout.ts, via hench's llm-gateway) so both layouts are covered: the PRD tree's status writes, execution-log*.jsonl, .cache/, tree-meta.json, archive.json, pending-proposals.json and acknowledged-findings.json (tool state written by rex's finding acknowledgment), plus hench's own state. Everything else under .rex/ or the container, including workflow.md and config.json, counts as a change. completion.ts:42 (the diff summary) must use the same list. The v2 state.yaml files join the list when storage v2 lands."
lastModified: "2026-10-06T22:41:08.751Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
