---
id: "21d748de-f42e-4cda-95f5-1e21f85b3713"
type: "change"
title: "Add resolveItem helper that falls back to title matching when ID lookup misses"
slug: "add-resolveitem-helper-that-falls-back"
intent: "Introduce a `resolveItem(items, query)` utility in `packages/rex/src/core/tree.ts` that first attempts an exact ID match via the existing `findItem`, then — on miss — performs a case-insensitive, normalized title search across all tree nodes. The existing `findItem` signature must remain unchanged so callers that already have a canonical ID are unaffected. If multiple items share a normalized title, return the first match and emit a warning so callers can surface ambiguity to the user."
acceptanceCriteria:
  - "Passing a valid UUID to resolveItem returns the same result as findItem"
  - "Passing an exact title (any case) to resolveItem returns the matching item"
  - "Passing a title that matches multiple items returns the first match and logs a warning"
  - "Passing a string that matches neither ID nor title returns null"
  - "findItem signature and call sites are not changed by this addition"
amends: [{"target":"1797eb3e-8ef9-4148-80fe-966693dd4e97","delta":"modified","summary":"Add resolveItem helper that falls back to title matching when ID lookup misses","base":"3eff1277f48bb8f92522aba77e891fc515d81b0d7def896e35d21203e3434241"}]
priority: "high"
tags:
  - "rex"
  - "core"
source: "smart-add"
---
