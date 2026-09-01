---
id: "ceaaf15d-6d66-4f6c-aa25-3ac532ca13f0"
level: "task"
title: "Stale-save guard false-positives on a same-millisecond write, failing FileStore tests intermittently"
status: "pending"
priority: "medium"
tags:
  - "flake"
  - "prd-tree"
  - "stale-save-guard"
  - "rex"
source: "ndx-capture"
acceptanceCriteria:
  - "store-roundtrip passes across at least 20 consecutive isolated runs and inside a full pnpm test"
  - "The guard still refuses a genuinely stale save that would delete another writer's item — covered by a test that does not depend on timing"
  - "The false-positive mechanism is addressed rather than the tolerance widened, or the widening is justified with a measured false-positive rate"
  - "No call site is changed to pass allowBulkDelete as a workaround"
description: "The stale-save guard rejects legitimate writes at a meaningful rate, failing different `FileStore` tests from run to run:\n\n    Error: Stale-save guard: this save would delete 1 item written after the document being saved was loaded\n      - Auth System [epic-1] (.../\\.rex/prd_tree/auth-system-epic1.md)\n      at guardStaleEntries folder-tree-serializer.ts:162\n      at FileStore.addItem file-adapter.ts:560\n\nObserved failing tests, both in `packages/rex/tests/integration/`:\n- `store-roundtrip.test.ts` › \"full lifecycle persists state to folder tree\"\n- `markdown-only-writes.test.ts` › \"FileStore.saveDocument does not create branch-scoped prd_*_*.md files\"\n\nNot one flaky test — one flaky guard, surfacing wherever a test loads and saves inside the same few milliseconds.\n\nRate and independence:\n- Reproduced 1-in-3 and 1-in-5 running `store-roundtrip.test.ts` ALONE on an idle machine, so it is not merely full-suite load.\n- Reproduced inside full `pnpm test` runs on separate occasions, hitting a different test each time.\n- NOT a regression from 7fb079f6 (layout-churn reporting). Verified by checking out the pre-7fb079f6 `folder-tree-serializer.ts` and `folder-tree-store.ts` and re-running: still 1 failure in 5. The defect pre-dates that commit.\n- The failing runs had a freshly built `dist/`, so this is not the separate stale-build guard.\n\nMechanism — the tolerance in `guardStaleEntries`:\n\n    const MTIME_TOLERANCE_MS = 2;\n    if ((await newestMtime(entry.path)) > options.loadedAt + MTIME_TOLERANCE_MS) → violation\n\n`loadedAt` is `Date.now()` (integer ms); `mtimeMs` carries fractional milliseconds. The comment already concedes the granularity mismatch and picks 2ms as \"close enough\". A caller that creates an item and immediately adds a child does load-then-save inside that window, so a file the load definitely saw can read as newer than the load.\n\nWorth treating as a product defect, not a test flake. The guard exists to refuse destroying a concurrent writer's work. A guard that also refuses legitimate writes will eventually be worked around with `allowBulkDelete` — which disables the protection entirely. Its false-positive rate is what decides whether it stays trusted.\n\nDirections worth weighing:\n- Compare like with like: record the maximum mtime observed during the load and compare candidates against that, instead of wall-clock `Date.now()` against filesystem time.\n- Identify entries by item id rather than timestamp: an entry whose id is absent from the loaded document was not written by a concurrent writer, whatever its mtime. This removes the race rather than widening it.\n- Widening the tolerance is the cheap option, but it only moves the race, and each widening weakens the guard.\n\nFound while working task 3e46780d; deliberately not fixed there to avoid retuning a safety guard as a side effect of an unrelated change."
lastModified: "2026-09-01T02:39:33.121Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
