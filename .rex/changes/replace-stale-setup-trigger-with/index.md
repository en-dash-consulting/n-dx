---
id: "dffc3dc6-6c96-4f44-8b07-0e6c15f85d30"
type: "change"
title: "Replace stale-setup trigger with direct existence check for .sourcevision, .rex, and .hench folders"
slug: "replace-stale-setup-trigger-with"
intent: "Audit every code path that emits the 'project setup is stale' message, identify the current trigger conditions, and replace them with a single filesystem probe that checks whether each of .sourcevision, .rex, and .hench exists at the project root. Only emit the warning when at least one of the three directories is absent. Suppress the message entirely when all three directories are present, regardless of file timestamps, manifest version drift, or other staleness heuristics that previously fired the notice."
acceptanceCriteria:
  - "Stale-setup notice is suppressed in all CLI commands when .sourcevision, .rex, and .hench directories all exist at the project root"
  - "Stale-setup notice is emitted when one or more of the three directories is missing, naming the missing directories"
  - "No call site emits the notice based on manifest age, version drift, or other heuristics — only directory presence"
  - "Stale-setup detection helper is centralized so all CLI entry points share a single trigger predicate"
amends: [{"target":"2037c955-24ba-4fc4-9d3f-6f17ddd70139","delta":"modified","summary":"Replace stale-setup trigger with direct existence check for .sourcevision, .rex, and .hench folders","base":"12c1364762fbbddc0e577c1af511c5fe8ac102ca5cbe0a2edcb58420441f5ffc"}]
priority: "high"
tags:
  - "cli"
  - "ux"
  - "bug-fix"
source: "smart-add"
---
