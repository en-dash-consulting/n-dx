---
id: "21d748de-f42e-4cda-95f5-1e21f85b3713"
level: "task"
title: "Add resolveItem helper that falls back to title matching when ID lookup misses"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "core"
source: "smart-add"
startedAt: "2026-05-19T16:36:59.713Z"
completedAt: "2026-05-19T16:39:52.532Z"
endedAt: "2026-05-19T16:39:52.532Z"
resolutionType: "code-change"
resolutionDetail: "Added resolveItem to tree.ts with ID-first then title-fallback lookup; exported from public.ts; 6 unit tests added."
acceptanceCriteria:
  - "Passing a valid UUID to resolveItem returns the same result as findItem"
  - "Passing an exact title (any case) to resolveItem returns the matching item"
  - "Passing a title that matches multiple items returns the first match and logs a warning"
  - "Passing a string that matches neither ID nor title returns null"
  - "findItem signature and call sites are not changed by this addition"
description: "Introduce a `resolveItem(items, query)` utility in `packages/rex/src/core/tree.ts` that first attempts an exact ID match via the existing `findItem`, then — on miss — performs a case-insensitive, normalized title search across all tree nodes. The existing `findItem` signature must remain unchanged so callers that already have a canonical ID are unaffected. If multiple items share a normalized title, return the first match and emit a warning so callers can surface ambiguity to the user."
---
