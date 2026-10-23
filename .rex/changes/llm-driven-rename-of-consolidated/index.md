---
id: "f848f434-bbcc-4161-942f-bf0d1e524f40"
type: "change"
title: "LLM-driven rename of consolidated children to descriptive titles"
slug: "llm-driven-rename-of-consolidated"
intent: "After children are reparented under the new generated parent, invoke an LLM call per consolidation group that takes each child's body/description and proposes a distinct, descriptive replacement title that captures what makes that specific item unique relative to its siblings. Use the existing centralized vendor/model resolver and the shared LLM error classifier so failures surface consistent diagnostics. The rename must update the item title in the folder-tree write path (and rename the on-disk file/folder per the title-based naming convention), guarantee uniqueness within the new parent (falling back to a deterministic suffix only if the LLM returns colliding titles), and skip the rename for any child whose original non-hash portion of the title is already meaningfully distinct."
acceptanceCriteria:
  - "LLM is invoked once per consolidation group with all member bodies as context, not once per child"
  - "Each child receives a new title distinct from its siblings under the new parent"
  - "Title-based filename/folder rename runs through the existing title-to-filename normalizer"
  - "Rename pass uses resolveVendorModel and the shared LLM error classifier; quota/rate-limit failures degrade gracefully (children keep hash-suffixed titles, reshape continues, warning is logged)"
  - "If the LLM returns duplicate or empty titles, a deterministic fallback ensures uniqueness without overwriting other items"
  - "Integration test asserts that after reshape against a fixture of three hash-suffixed observation findings, the three children have three distinct human-readable titles"
touches:
  - "d08290fd-0664-4fb9-8881-0974b2879c50"
priority: "high"
tags:
  - "rex"
  - "reshape"
  - "llm"
source: "smart-add"
---
