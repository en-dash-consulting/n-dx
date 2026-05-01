---
id: "7b6be42e-d317-4f02-b0b7-aa1eba1cd3dc"
level: "task"
title: "Audit and remove all prd.md read fallbacks and write paths from ndx add and rex add pipelines"
status: "in_progress"
priority: "high"
tags:
  - "rex"
  - "prd"
  - "cli"
source: "smart-add"
startedAt: "2026-05-01T13:58:28.708Z"
acceptanceCriteria:
  - "No production code path under ndx add, rex add, or smart-add reads .rex/prd.md"
  - "No production code path under ndx add, rex add, or smart-add writes .rex/prd.md"
  - "If .rex/prd.md exists alongside .rex/prd_tree, it is ignored at runtime and a one-line warning recommends running rex migrate-to-folder-tree"
  - "Regression test asserts ndx add against a fixture containing both .rex/prd.md and .rex/prd_tree mutates only the folder tree"
description: "Trace every code path reachable from ndx add, rex add, and the smart-add LLM pipeline. Remove any remaining prd.md read fallbacks and any write calls that touch .rex/prd.md. The folder-tree must be the sole source of truth at runtime; legacy migration remains the only surface that reads prd.md."
---
