---
id: "b9a269f8-2123-4703-bfa0-677349fa71e1"
level: "task"
title: "Bundle-imported item with `lastModifiedBy` but no `lastModified` is never pushed by remote sync"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "An item imported from a bundle with `lastModifiedBy` set and `lastModified` absent ends up on disk with a non-empty `lastModified` (e.g. the bundle's `exportedAt`) while keeping its original `lastModifiedBy`"
  - "`isModifiedSinceSync` returns true for such an item when it has never been synced"
  - "A test imports a bundle containing a lastModifiedBy-only item and asserts both the preserved attribution and the sync-visible timestamp"
description: "Verdict: must-fix (severity medium). Found by adversarial review of the portable-PRD-bundle branch diff.\n\nFailure scenario: `stampChangedItems` (packages/rex/src/core/sync.ts:341) now treats `lastModifiedBy` alone as \"the item arrived with its own stamp\" and does not stamp it — correctly preserving the original author. But `isModifiedSinceSync` (sync.ts:89) starts with `if (!meta.lastModified) return false`, so an item with no timestamp is *never* considered modified. Import a bundle containing an item that carries `lastModifiedBy` but no `lastModified` (the e2e fixture in tests/e2e/cli-prd-bundle.test.ts builds exactly one: TASK_ONE) into a project with a remote adapter: the item lands on disk with no `lastModified`, `rex sync` never pushes it, and per the sync module's own doc comment (sync.ts:312) it can then be overwritten by the remote's value on the next pull, in silence.\n\nReachability: any hand-authored or LLM-generated bundle whose items carry attribution without timestamps, and any export→import chain seeded from one. No downstream guard defaults the timestamp — verified by reading isModifiedSinceSync and its callers.\n\nSolution options:\n(a) RECOMMENDED — in the import path, default `lastModified` to the bundle's `exportedAt` for added items that lack it. Semantically honest (the content is at least that old), preserves attribution, leaves the new stampChangedItems rule intact. ~3 lines in cmdImportBundle/mergeBundle plus one test.\n(b) In stampChangedItems, fill only the missing half of a partial stamp. Broader reach, but pairs `lastModified: now` with the original author — mild misattribution.\n(c) Accept and document sync-invisibility. Free, but contradicts the sync module's stated guarantee."
lastModified: "2026-09-10T16:33:55.071Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
