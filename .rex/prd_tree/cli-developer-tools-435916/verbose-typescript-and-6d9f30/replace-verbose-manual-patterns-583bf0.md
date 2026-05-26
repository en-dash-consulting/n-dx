---
id: "583bf032-c437-4c65-a571-3cb0ce056b8d"
level: "task"
title: "Replace verbose manual patterns with existing utility functions already present in the codebase"
status: "pending"
priority: "low"
tags:
  - "refactor"
  - "deduplication"
  - "simplification"
source: "smart-add"
acceptanceCriteria:
  - "No production call site manually implements logic that is already provided by an existing utility function in the same codebase"
  - "All replacements use the existing utility directly without wrapping"
  - "pnpm build and pnpm test pass after every replacement"
  - "Net line reduction is at least 80 lines"
description: "Identify call sites that manually implement logic already provided by a utility function in the same codebase (e.g., multi-line object-spread merges that duplicate a merge helper, multi-step string normalization that duplicates a slug utility, manual array filtering patterns that duplicate a selector already in rex-gateway or llm-gateway). Replace each with a call to the existing utility. Do not introduce new utilities — only consolidate toward functions that already exist."
---
