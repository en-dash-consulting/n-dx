---
id: "8686d48a-6fee-42da-af2e-f7b6c2268e50"
level: "task"
title: "`stampChangedItems` attribution-only widening changes the rule for every `withTransaction` caller"
status: "pending"
priority: "medium"
tags:
  - "code-review"
  - "reviewer:ryrykeith"
  - "severity:medium"
  - "sync"
source: "ndx-capture"
acceptanceCriteria:
  - "An item that arrives with `lastModifiedBy` but no `lastModified` acquires a `lastModified` through any `withTransaction` path, not only bundle import"
  - "That item's original `lastModifiedBy` is preserved — the importer does not become the recorded author"
  - "`isModifiedSinceSync` returns true for such an item when it has never been synced, so its first sync pushes rather than pulls"
  - "The partial-stamp fill writes only the absent field rather than assigning the whole stamp object"
  - "A test exercises a non-import path (e.g. MCP `add_item` or a direct store transaction) with an attribution-only item and asserts both properties hold"
description: "Found by code review of the portable-PRD-bundle branch. This is the residual of the completed task \"Bundle-imported item with `lastModifiedBy` but no `lastModified` is never pushed by remote sync\", which found the same hazard and fixed it for one path only.\n\n`stampChangedItems` (packages/rex/src/core/sync.ts) treats an item as already stamped when it carries either half of a stamp:\n\n    const changed = previous === undefined\n      ? item.lastModified === undefined && item.lastModifiedBy === undefined\n      : previous !== itemSignature(item);\n\nThe widening is correct in intent — checking only `lastModified` would overwrite the original author with the importer on exactly the items a bundle exists to carry. But `isModifiedSinceSync` opens with `if (!meta.lastModified) return false`, so an item that arrives carrying only `lastModifiedBy` is treated as already stamped and never acquires a `lastModified` — not in this transaction and not in any later one, since `snapshotItemContent` will hold it from then on. Such an item is permanently invisible to remote sync: `rex sync` never pushes it, and the next pull overwrites its content with the remote's value in silence.\n\nThat was fixed by defaulting `lastModified` to the bundle's `exportedAt` on the import path (`defaultTimestampFromExport` in prd-bundle.ts). That covers bundle import and nothing else: `stampChangedItems` runs inside every `withTransaction` on both store adapters, so any other path that inserts an attribution-only item — MCP `add_item`, a hand-edited `index.md` picked up by a later transaction, a future importer — reproduces the original defect.\n\nReviewer's suggestion: fill only the missing `lastModified` and leave `lastModifiedBy` untouched, which preserves both properties. The current code trades one for the other because `Object.assign(item, stamp)` writes both fields together.\n\nNote this is a change to shared sync behaviour rather than to the bundle feature — scope the fix and its tests accordingly.\n\nCaptured separately because the branch's other review-finding captures do not cover it: they record the original import-path defect, which is closed, not this residual."
lastModified: "2026-09-10T19:39:23.964Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
