---
id: "d3a995ca-7ea2-400a-b9a3-37f07acaa77f"
level: "task"
title: "`@n-dx/rex` fails intermittently under `pnpm test` but passes standalone"
status: "in_progress"
priority: "medium"
tags:
  - "flaky-test"
  - "ci-reliability"
source: "ndx-capture"
startedAt: "2026-09-10T20:40:54.864Z"
acceptanceCriteria:
  - "The failing test and its assertion are captured from a real failing run, not inferred"
  - "The root cause is identified — shared temp path, port/lock collision, timeout under load, or ambient state from another suite"
  - "`pnpm test` passes across at least 20 consecutive runs after the fix"
  - "If the cause is contention rather than a test defect, the fix isolates the resource (unique temp dirs, ephemeral ports) rather than raising a timeout to paper over it"
  - "Any timeout raised is justified in a comment naming what it is waiting for"
description: "**CAPTURED on 2026-09-11, fifth sighting.** The subtask that made the runner retain per-suite output caught it on its first full run. The failing assertion, from `.test-logs/n-dx-rex.log`:\n\n    FAIL tests/integration/import-bundle-transaction.test.ts\n      > rex import-bundle transaction discipline\n      > does not lose either writer's items when two imports run concurrently\n\n    AssertionError: Error: [NDX_CLI_GENERIC] Stale-save guard: this save would\n    delete 1 item written after the document being saved was loaded — the\n    snapshot is stale, and saving it would destroy another writer's work:\n      - From First Bundle [aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa]\n    Reload the document (or run the mutation inside store.withTransaction) and\n    retry. A deliberate whole-tree rewrite can pass allowBulkDelete.\n    : expected 1 to be +0\n\n    ❯ tests/integration/import-bundle-transaction.test.ts:98:32\n        expect(b.status, b.output).toBe(0);\n\nTest Files 1 failed | 238 passed (239). A re-run of the whole suite immediately afterwards passed 6/6, as every previous sighting has.\n\nThe test launches two `rex import-bundle` CLIs concurrently against disjoint bundles and asserts both exit 0. The second one's save was rejected by the stale-save guard, meaning it saved a document that had been loaded before the first writer's write landed.\n\n**What that rules out.** `FolderTreeStore.withTransaction` loads *inside* the lock — `withLock(lockPath, async () => { const doc = await this.loadDocument(); ... })` — so the simple explanation of an unlocked read is wrong. The read is correctly serialised.\n\n**Where to look next**, in order:\n1. Whether both processes genuinely held the lock across their own read-modify-write, or whether one was stolen. `packages/rex/src/store/file-lock.ts` has `STALE_LOCK_MS = 30_000` and `ACQUIRE_TIMEOUT_MS = 10_000`. Under the full run the rex suite reports ~53s wall with ~276s of test time, so a CLI subprocess holding the lock past 30s while the machine is saturated is not far-fetched — and a stolen live lock is exactly how two writers end up interleaved. Note `file-lock.test.ts` guards this for a *same-process* holder (\"does not steal a live same-process lock held longer than staleMs\"); the cross-process path is the one to check.\n2. Whether the stale-save guard's comparison snapshot is taken at load time inside the lock or earlier.\n3. Whether `ensureSnapshot` — a recursive directory copy that now runs *before* the transaction in `cmdImportBundle` — widens the window between process start and lock acquisition enough to matter.\n\nThis is a genuine concurrency question, not merely a slow test: the guard fired because it detected exactly the lost-update it exists to prevent. Whether the correct fix is in the lock, the guard, or the test's expectation that two concurrent imports both succeed is the open question. Do not simply raise a timeout.\n\n**Earlier sightings and dead ends**, kept because they still narrow the space. Four sightings on 2026-09-10 and 2026-09-11, all under `pnpm test`, all passing standalone immediately after. The original capture claimed the failure needed parallel `pnpm -r` execution; that was wrong — `scripts/run-all-tests.mjs` runs suites sequentially. Reproduction attempts that came back clean: 10 idle full runs; the rex suite alone under full CPU saturation (load ~22, runtime stretched 25s → ~10min, all 5023 tests passed); 25 isolated runs of `file-lock.test.ts` + `stale-save-guard.test.ts`; and a reviewer's six standalone runs. So CPU pressure alone does not do it, and the isolated lock tests do not either — the trigger needs the full suite's own concurrency.\n\nThe raw captured log is at `.test-logs/n-dx-rex.log` when it recurs; that directory is gitignored and overwritten each run, so copy it aside before re-running."
lastModified: "2026-09-11T11:36:59.351Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Retain each suite's output from `pnpm test` so an intermittent failure is diagnosable](./retain-each-suite-s-output-from-pnpm.md) | completed |
