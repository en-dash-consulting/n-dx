---
id: "583bf032-c437-4c65-a571-3cb0ce056b8d"
type: "change"
title: "Replace verbose manual patterns with existing utility functions already present in the codebase"
slug: "replace-verbose-manual-patterns-with"
intent: "Identify call sites that manually implement logic already provided by a utility function in the same codebase (e.g., multi-line object-spread merges that duplicate a merge helper, multi-step string normalization that duplicates a slug utility, manual array filtering patterns that duplicate a selector already in rex-gateway or llm-gateway). Replace each with a call to the existing utility. Do not introduce new utilities — only consolidate toward functions that already exist."
acceptanceCriteria:
  - "No production call site manually implements logic that is already provided by an existing utility function in the same codebase"
  - "All replacements use the existing utility directly without wrapping"
  - "pnpm build and pnpm test pass after every replacement"
  - "Net line reduction is at least 80 lines"
amends: [{"target":"6d9f3098-b7e8-4feb-8279-ec46b4b54958","delta":"modified","summary":"Replace verbose manual patterns with existing utility functions already present in the codebase","base":"7e351086ddc48f23e4e3443f5d8442dc316bf05a2980206504b6ebc7ebd3c7fc"}]
priority: "low"
tags:
  - "refactor"
  - "deduplication"
  - "simplification"
source: "smart-add"
---
