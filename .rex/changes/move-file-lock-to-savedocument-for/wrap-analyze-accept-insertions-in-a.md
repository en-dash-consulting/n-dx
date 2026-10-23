---
id: "9ebc5a0b-692f-4017-ad3d-69fe40f45266"
type: "task"
title: "Wrap analyze --accept insertions in a single store transaction"
slug: "wrap-analyze-accept-insertions-in-a"
description: "`acceptProposals` (`packages/rex/src/cli/commands/analyze.ts:238-294`) inserts every accepted epic, feature and task via its own `store.addItem` call, so an accept of N items runs N separate transactions and serializes the whole folder tree N times. Each intermediate state is written to disk: an epic added before its first feature is written as the leaf `general.md`, then the next transaction must delete that leaf to promote it to `general/index.md`. That delete is what the stale-save guard (`folder-tree-serializer.ts:147`, added by task 2eb30359) inspects, comparing the leaf's mtime against the transaction's `loadedAt` with only a 2 ms tolerance.\n\nUnder load this trips: `rex analyze --no-llm --accept` fails with \\\"Stale-save guard: this save would delete 1 item written after the document being saved was loaded\\\" naming `prd_tree/general.md`, failing `packages/rex/tests/e2e/cli-analyze.test.ts` cases \\\"accepts proposals into PRD with --accept\\\" and \\\"batch record includes accepted proposal titles\\\". Reproducible via `node scripts/run-all-tests.mjs` (2/2 runs); passes when the rex suite runs alone (2/2), so it presents as flake. `scripts/run-all-tests.mjs` already documents \\\"rex's load-sensitive tests\\\" in its own header.\n\nThis is the write path the parent feature missed: its description lists `reorganize`, `prune` and `reshape` as the CLI commands doing their own load→mutate→save, but `analyze --accept` does the same and was never converted. Doing all insertions inside one `store.withTransaction` is what the guard's own error message advises, removes the intermediate promotion churn so no stale leaf is ever written, makes the accept atomic (matching the intent of the existing `.accepting` sentinel), and drops N-1 redundant full-tree serializations."
acceptanceCriteria:
  - "`rex analyze --accept` performs all item insertions inside a single store.withTransaction span"
  - "The two cli-analyze.test.ts cases pass under `node scripts/run-all-tests.mjs`, not only when the rex suite runs in isolation"
  - "A regression test pins the stale-save scenario deterministically rather than relying on load to surface it"
  - "Accepted item count, batch record output and execution-log entry are unchanged from the pre-fix behaviour"
  - "No intermediate leaf-to-directory promotion is written to the tree during an accept"
priority: "high"
tags:
  - "rex"
  - "reliability"
  - "concurrency"
  - "analyze"
  - "flaky-test"
source: "ndx-capture"
---
