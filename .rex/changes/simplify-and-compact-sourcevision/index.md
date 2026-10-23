---
id: "caa57841-e765-418d-9c47-035b2a0a01f3"
type: "change"
title: "Simplify and compact sourcevision analysis code for readability and reduced context size"
slug: "simplify-and-compact-sourcevision"
intent: "Refactor overly verbose or redundant code in the sourcevision analysis modules — particularly large functions and duplicated logic across scan passes — to be more compact. Compaction reduces the surface area when code is included as context in prompts or read by AI tooling, and makes the codebase cheaper to reason about. All changes must be behaviorally equivalent: same inputs produce same outputs, and the existing test suite passes green."
acceptanceCriteria:
  - "Refactored functions produce identical outputs on existing test inputs"
  - "Full test suite (unit + integration) passes without modification"
  - "No new abstractions are introduced that don't already have at least two call sites"
  - "Code size reduction is visible in diff — no net-new lines added beyond what is removed"
touches:
  - "ede8a6b4-dff8-4576-abea-3af9fbd7eaba"
priority: "medium"
tags:
  - "sourcevision"
  - "refactor"
  - "compaction"
source: "smart-add"
---
