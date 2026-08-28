---
id: "19c7893a-f1d5-4024-a75d-9b27baecf6dc"
level: "task"
title: "FolderTreeStore and FileStore guard the same folder tree with different lock files"
status: "pending"
priority: "low"
tags:
  - "prd-correctness"
  - "concurrency"
  - "severity:low"
  - "latent"
source: "ndx-capture"
acceptanceCriteria:
  - "Both stores that serialize .rex/prd_tree/ acquire the same lock file, or the divergence is documented with the compatibility reason it exists for"
  - "A test asserts that a FileStore transaction and a FolderTreeStore transaction over the same rexDir serialize against each other rather than interleaving"
  - "If the lock file name changes, the transition for a process still holding the old lock is considered"
description: "Found while fixing the syncFolderTree lost update (task ff501eb1). Both stores serialize the same tree at `.rex/prd_tree/`, but they take different lock files:\n\n- `FileStore` — `tree.lock` (file-adapter.ts, now via `PRD_TREE_LOCK_FILENAME`)\n- `FolderTreeStore` — `prd.lock` (folder-tree-store.ts:108, :246)\n\nTwo writers on different lock files do not exclude each other, so a FileStore transaction and a FolderTreeStore transaction could interleave their read-modify-writes over the same directory — the same class of loss the lock exists to prevent.\n\nLatent today, not live: `grep \"new FolderTreeStore\"` across `packages/*/src` returns nothing, so the class is instantiated only by tests; `resolveStore` always returns a `FileStore`. The trap is that wiring FolderTreeStore into any real path would silently reintroduce the hole, and nothing in the tests would catch it — the lock-path divergence is invisible unless you go looking.\n\nFix is small: point FolderTreeStore at `PRD_TREE_LOCK_FILENAME` too, or, if `prd.lock` must stay for compatibility with older processes still holding it, document why the two differ and add an assertion that both stores resolve the same path."
lastModified: "2026-08-28T18:09:18.664Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
