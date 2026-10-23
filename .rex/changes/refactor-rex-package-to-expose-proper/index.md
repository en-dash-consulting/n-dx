---
id: "fdd4fece-07ba-47c9-9611-6603a8bed17f"
type: "change"
title: "Refactor rex package to expose proper public API"
slug: "refactor-rex-package-to-expose-proper"
intent: "Rex has no package.json exports field or public API barrel — hench imports 7 runtime functions from 5 internal dist/ paths. Add packages/rex/src/public.ts re-exporting the 7 consumed functions + 3 consumed types, add exports field to rex package.json mapping rex → dist/public.js, update hench imports to use rex (not rex/dist/...)."
acceptanceCriteria:
  - "Creates packages/rex/src/public.ts with re-exports of consumed functions"
  - "Updates rex package.json with proper exports field"
  - "Updates hench imports to use public API"
  - "All internal implementation details are encapsulated"
touches:
  - "f69ce6c6-57f4-4fc6-8f06-beb5e538d8fc"
priority: "high"
tags:
  - "refactoring"
  - "architecture"
source: "llm"
---
