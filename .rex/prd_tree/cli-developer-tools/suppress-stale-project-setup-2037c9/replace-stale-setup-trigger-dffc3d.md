---
id: "dffc3dc6-6c96-4f44-8b07-0e6c15f85d30"
level: "task"
title: "Replace stale-setup trigger with direct existence check for .sourcevision, .rex, and .hench folders"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "ux"
  - "bug-fix"
source: "smart-add"
startedAt: "2026-05-06T03:02:56.560Z"
completedAt: "2026-05-06T03:12:14.253Z"
endedAt: "2026-05-06T03:12:14.253Z"
resolutionType: "code-change"
resolutionDetail: "Replaced all heuristics in stale-check.js with a single directory-existence probe. Deleted dead staleness-check.js. Updated cli.js and tests."
acceptanceCriteria:
  - "Stale-setup notice is suppressed in all CLI commands when .sourcevision, .rex, and .hench directories all exist at the project root"
  - "Stale-setup notice is emitted when one or more of the three directories is missing, naming the missing directories"
  - "No call site emits the notice based on manifest age, version drift, or other heuristics — only directory presence"
  - "Stale-setup detection helper is centralized so all CLI entry points share a single trigger predicate"
description: "Audit every code path that emits the 'project setup is stale' message, identify the current trigger conditions, and replace them with a single filesystem probe that checks whether each of .sourcevision, .rex, and .hench exists at the project root. Only emit the warning when at least one of the three directories is absent. Suppress the message entirely when all three directories are present, regardless of file timestamps, manifest version drift, or other staleness heuristics that previously fired the notice."
---
