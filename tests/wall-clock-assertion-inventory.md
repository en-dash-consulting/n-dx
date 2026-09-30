# Wall-clock assertion inventory

Every test assertion whose verdict is a function of elapsed time, and what was
decided about it.

**Why this file exists.** A test whose result depends on `(code, machine load)`
rather than `(code)` teaches people to disbelieve red, and then hides a real
regression behind "probably just flaky". `ndx work` runs the full suite as its
post-task gate, so a load flake marks a run failed even though the work
committed — which is how this register came to be written.

**The policy this register serves lives in [TESTING.md](../TESTING.md), Flake
Resistance → Family 2.** Read it first. In short, and in preference order:

1. **Count work, not time.** Traversal steps, call counts, rendered node counts.
   Exact on every machine.
2. **If you must use a clock, assert growth between two sizes**, with the bound
   derived from measurement in both directions and the numbers recorded in place.
3. **Absolute budgets are the weakest tool — hang guardrails only** — and are
   scaled through
   `const BUDGET_MULTIPLIER = Number(process.env["NDX_TEST_TIME_MULTIPLIER"] ?? 20)`.

`tests/e2e/wall-clock-inventory-policy.test.js` scans for two shapes and fails
if a file holding either is not named anywhere in this file:

1. **A clock decides a bound** — the file reads a clock and an `expect` whose
   subject names a duration is bounded by a comparison matcher.
2. **A real sleep is the barrier before the assertion** — an awaited non-zero
   `setTimeout`/`sleep` followed by an `expect(` with no `await` in between.
   Nothing here names a duration; the verdict is an ordering or a count that
   real timers produced, and the sleep is a bet on the event landing inside it.

Being listed does not mean an assertion is *good* — it means somebody looked at
it and wrote down why it is still there.

---

## Converted — no clock remains

| Site | Was | Now |
|---|---|---|
| `packages/web/tests/unit/viewer/prd-tree-live-tick-perf.test.ts` | `expect(elapsedMs).toBeLessThan(16 * 10)` around a tick re-render. Observed at 420.10ms under full-suite load; the same file completes in 108ms run alone. | Counts Preact vnode diffs and DOM mutations (`countRenderWork`). A tick must diff under a third of a cold mount's vnodes and must not exceed one DOM mutation per in-progress row. Both regressions injected and confirmed failing. |
| `packages/web/tests/unit/viewer/large-tree-performance.test.ts` | 24 assertions of the form `expect(elapsed).toBeLessThan(N * BUDGET_MULTIPLIER)`, with `BUDGET_MULTIPLIER` hardcoded to `10` rather than read from `NDX_TEST_TIME_MULTIPLIER`. Three tests in this file failed under load and passed on a serial rerun. | Counts `children` reads on an instrumented fixture (`countTreeReads`) and Preact render work. Per-size tests bound reads per node; a separate block bounds each operation's growth across a 7.97x size step to 2x linear. An injected O(n²) measures 62.91x against a 15.94x bound. |
| `tests/e2e/vitest-timeout-failure.test.js:115` | `expect(result.durationMs).toBeLessThan(10_000)` next to an independent `spawnSync` `timeout: 10_000`. Two literals that had to stay equal, presented as a latency budget when a reading at the bound only ever means the child was killed. | Single named `FIXTURE_SPAWN_TIMEOUT_MS`, used for both, with the failure message stating that a reading at the bound means termination and that the guardrail — not the product — is what to raise. |
| `packages/hench/tests/unit/cli/commands/run-loop.test.ts:75` | `expect(elapsed).toBeGreaterThanOrEqual(40)` around a real `loopPause(50)`. A *lower* bound, which multiplier scaling cannot widen — `BUDGET_MULTIPLIER` only helps a `toBeLessThan` — and which a coarse or early-firing platform timer under-fires with the code unchanged. | Fake timers. The test asserts the claim exactly: the promise is still pending after `advanceTimersByTimeAsync(49)` and resolved after one more millisecond. Regression injected by raising `loopPause`'s immediate-resolve threshold from `ms <= 0` to `ms <= 100`: fails. Lines 85 and 99 in the same file still read a real clock and remain in the scaled-budget section below. |
| `packages/web/tests/unit/viewer/dom-performance-monitor.test.ts:824` | `expect(elapsed).toBeLessThan(COUNT_1000_BUDGET_MS)` — 250ms, widened to 500ms under `CODEX_CI` but never scaled by `NDX_TEST_TIME_MULTIPLIER`, so the documented load allowance did not reach it. | Counts pointer moves, reusing the `firstChild`/`nextSibling`/`parentNode` counter the file's linearity test already had — now hoisted to module scope and returning the snapshot alongside the count, so neither test needs its own copy. The walk makes 7002 moves over 2001 nodes (3.50/node); the bound is 6 per node. Regression injected by rescanning siblings from the parent's `firstChild`: 254.12 moves per node, and 15.48× on the linearity test beside it. |
| `packages/web/tests/unit/server/search-index.test.ts:524` | `expect(rebuildElapsed).toBeLessThan(5000)` on a 1000-item rebuild that reads 3.98ms — 1250x headroom, and unscalable, since `5000 * 20` exceeds the package's 30s `testTimeout`. | A growth ratio across a 16x size step (500 vs 8000 items), `fastestMs` min-of-5, bound at `sizeRatio * 2`. Both directions measured: clean 13.61x, injected quadratic 63.26x. The `* 4` headroom `folder-tree-parser.test.ts` uses would be 64 and would let that regression through — `rebuild()` re-reads and re-parses the PRD file each call, so I/O dominates the linear baseline and compresses the separation. Confirmed failing at 55.8x with the regression in place. |
| `packages/web/tests/unit/server/routes-search.test.ts:250` | `expect(data.elapsed_ms).toBeLessThan(200)` on a server-measured search that reads 0.15ms. | A nested-span assertion: `elapsed_ms` must be non-negative and strictly smaller than the round trip the client times around it. True on any machine — load inflates both spans — so no clock decides the verdict. **A growth ratio was tried and rejected on measurement:** `elapsed_ms` times `index.search()` alone, which is fixed-cost dominated at route-test sizes (0.150ms at 250 items vs 0.182ms at 1000 — 1.21x for a 4x step). The index's complexity claim stays where the work is, in `search-index.test.ts`. Regression injected by returning `performance.now()` instead of the delta: 1506.64ms against a 1.25ms round trip, fails. Limit recorded in place: a wrong-but-still-nested span (timing the handler rather than the query) passes. |
| `packages/rex/tests/integration/prd-tree-atomic-writes.test.ts` | Three assertions, all inside a `describe.skip` marked DEFERRED: `expect(median).toBeLessThan(500)` and `expect(latency).toBeLessThan(500)` (raw constants, no multiplier) and `expect(addTime).toBeLessThanOrEqual(reserializeTime)` (two adjacent micro-spans with a small expected gap). | Counts files written, via the paths the serializer already reports through `takeSaveFileReport()` — technique 1. A single add writes 2 files (the item and its parent's `index.md`) identically at 6 items and at 1000, a 167× size step; `updateItem` writes that exact pair of paths; a root-level add writes exactly its own file against one-file-per-item for a full serialization of the same tree in the same process. Regression injected by disabling `writeIfChanged`'s skip: 6 vs 2, 39 vs 2, and 40 vs 1 — all three fail. Now unskipped and running: the Mocha-only `this.timeout()` calls that would have thrown under vitest are gone. **Timed out under load at the original fixture sizes** — every one of these paid for a real `saveDocument` of 1110 items before reaching its load-immune assertion, 21.2s and 10.7s idle against a 30s `testTimeout`. The two exact-path-set tests now build 39 items instead (182ms, 130ms — scale buys an exact set nothing), and the size-step test keeps its 1110-item tree behind an explicit `5_100 * NDX_TEST_TIME_MULTIPLIER` per-test timeout, its measured idle worst case times the documented allowance. |

A row naming a bare file converted every clock-decided assertion in it. A row
naming a specific line converted that assertion only; the file keeps other clock
reads, and those are accounted for in their own row further down.

Also fixed alongside them, and the likely cause of the two *non-timing*
assertions in `large-tree-performance.test.ts` that were also seen failing under
load: every `PRDTree` render in that file is now unmounted. `useLiveTick` starts
a real 1s `setInterval` whenever an in-progress row is visible, so each render
used to leave a live interval re-rendering a 500–2000 row tree for the rest of
the run, free to interrupt a later test mid-measurement.

`tests/e2e/cli-ci-child-cleanup.test.js` was on the same list and had a different
cause — not a budget at all. See that file's header: `ndx ci` runs its
documentation phase, ending in a `pnpm docs:build` spawn, *before* the analysis
phase whose children the suite tracks, so pnpm's startup was charged against the
3s deadline for the first PID record (measured: 539ms total, ~490ms of it pnpm).
The docs spawn is now redirected to a stub and the deadline is unchanged;
time-to-first-PID is 111ms.

That fix removed the cost but not the exposure: the 3s deadline was still a raw
constant, and the closing soak for 0.8.0 (`scripts/soak-under-build-load.mjs`)
hit it at 8678ms under concurrent build load. Every wait in that file is now
`BUDGET_MULTIPLIER`-scaled — the two PID-record deadlines, the orphan-reap grace,
the normal-exit grace and the SIGINT case's per-test ceiling — except the mirror
of the product's own 5s force-kill timer, which is not the test's to widen. These
are Family 3 polling guardrails, not clock-decided assertions, so neither
detector flags them and the file is listed here only for the narrative above.

---

## Justified — clock retained deliberately

| Site | Assertion | Why it stays |
|---|---|---|
| `packages/hench/tests/unit/tools/shell.test.ts:272` | `expect(elapsed).toBeLessThan(TIMEOUT_COMMAND_LIFETIME_MS / 4)` | A *discriminating* bound: it separates "returned on timeout" (~200ms) from "waited for the command" (~60s). Already in the fraction-of-the-number-it-must-stay-under form TESTING.md prescribes, and deliberately not multiplier-scaled — scaling it to 40s would make both outcomes pass, which is the exact bug that form exists to prevent. |
| `packages/hench/tests/integration/test-gate-kill-tree.test.ts` | `expect(gate.totalDurationMs).toBeLessThanOrEqual(PLAIN_TREE_BOUND_MS / STUBBORN_TREE_BOUND_MS)` | The acceptance criterion *is* a duration: a timed-out gate must report at most its timeout plus the kill's grace (run 8dc53406 reported 6m 45s over). Both bounds are discriminating and in units of the kill's 5s grace, not multiplier-scaled: plain tree clean timeout+0.1s vs one forced grace timeout+5.1s (bound: half a grace); stubborn tree clean timeout+5.1s vs a second forced grace timeout+10.1s (bound: one and a half). Numbers recorded beside the constants. Liveness of every pid is asserted separately, by count, not by clock. |
| `packages/hench/tests/unit/store/run-change-detector.test.ts:154` | `expect(...mtimeMs).toBeGreaterThan(0)` | Filesystem mtime, not an elapsed measurement. Cannot be 0 for a file that exists. |
| `packages/web/tests/unit/server/routes-hench-audit.test.ts:73` | `expect(info.serverUptime).toBeGreaterThanOrEqual(0)` | Asserts the field is present and non-negative, not that any duration was achieved. Monotonic. |
| `packages/web/tests/unit/server/routes-hench-task-usage-rollup.test.ts:286,287,290` | `expect(...runningMs).toBeGreaterThanOrEqual(90_000)` | The fixture's start is `Date.now() - 90_000` and the server re-reads the clock later, so the delta can only grow. Load makes this *more* true, never less. |
| `packages/web/tests/unit/viewer/dom-performance-monitor.test.ts:988,992` | `expect(...durationMs).toBeGreaterThanOrEqual(0)` | Shape assertions on a recorded duration field. No bound to overshoot. |
| `packages/rex/tests/unit/store/folder-tree-parser.test.ts:957` | (comment only) | Prose recording that this file already replaced an absolute budget with a growth ratio. The reference implementation of technique 2, alongside `write-path-profile.test.ts`. |
| `packages/web/tests/integration/worktrees-route.test.ts:386` | `await new Promise((r) => setTimeout(r, 1_000))` then `expect(broadcast).not.toHaveBeenCalled()` | Proving an absence: the claim is that serving a worktree arms no second watcher, so the sleep is the window in which a spurious broadcast would show up. Load cannot turn this red — a busier machine makes a stray broadcast *less* likely to land inside the window, never more. The exposure is the opposite one, a false pass when a watcher fires late, which no bound can close; only asserting on the watcher registry itself would. Surfaced by the widened scanner (the `1_000` separator hid it from the old pattern), not newly written. |
| `packages/web/tests/unit/setup/preact-frame-leak-guard.test.ts:46` | `await new Promise((resolve) => setTimeout(resolve, RAF_TIMEOUT + 50))` then `expect(getPendingFrameFallbackTimerCount()).toBe(before)` | Two timers, not a duration: preact's after-paint fallback is armed at `RAF_TIMEOUT`, and this waits `RAF_TIMEOUT + 50`. Timers fire in deadline order, so the fallback has always fired by the time this one does, however far behind the event loop is running — load delays both equally and cannot reorder them. Waiting it out is the point: the canary must not leave the pair pending, or it would trip the very guard it tests. Surfaced by the widened scanner (the `RAF_TIMEOUT + 50` expression hid it from the old pattern). |

---

## Open — clock-derived and not yet converted

No unscaled absolute budgets remain. Every site below follows the documented
policy; they are listed because policy-compliant is not the same as good.

### Open, scaled through `BUDGET_MULTIPLIER`

These follow the documented policy for a standalone hang guardrail, so they are
policy-compliant today. They are listed because TESTING.md is explicit that "if
the claim is really about complexity, prefer rule 2 and delete the budget rather
than scaling it" — and every one of these is named for a complexity claim.

| Site | Assertion |
|---|---|
| `packages/rex/tests/unit/core/tree-hardened.test.ts:642,652,661,670` | `expect(elapsed).toBeLessThan(100 or 50 * BUDGET_MULTIPLIER)` — "guards against super-linear traversal" |
| `packages/rex/tests/unit/core/item-token-rollup.test.ts:323` | `expect(elapsed).toBeLessThan(50 * BUDGET_MULTIPLIER)` |
| `packages/rex/tests/unit/analyze/dedupe.test.ts:291` | `expect(elapsed).toBeLessThan(2000 * BUDGET_MULTIPLIER)` |
| `packages/sourcevision/tests/unit/analyzers/dedup-findings.test.ts:193` | `expect(elapsed).toBeLessThan(1000 * BUDGET_MULTIPLIER)` |
| `packages/llm-client/tests/unit/cli-provider.test.ts:82` | `expect(elapsed).toBeLessThan(2000 * BUDGET_MULTIPLIER)` |
| `packages/hench/tests/unit/cli/commands/run-loop.test.ts:85,99` | `expect(elapsed).toBeLessThan(50 or 200 * BUDGET_MULTIPLIER)` |
| `packages/web/tests/unit/server/routes-search.test.ts:288` | `expect(roundTripMs).toBeLessThan(500 * BUDGET_MULTIPLIER)` |
| `packages/web/tests/unit/server/search-index.test.ts:550` | `expect(searchElapsed).toBeLessThan(200 * BUDGET_MULTIPLIER)` |

---

## Not clock-derived, but load-sensitive for a different reason

A second family: real timers driving an *ordering* or a *count*. Nothing in
these assertions names a duration, so the clock detector cannot see them — they
were listed by hand here until 0.8.0, which is the arrangement that goes stale.
**`wall-clock-inventory-policy.test.js` now scans for them too**: an awaited
non-zero sleep followed by an `expect(` with no `await` in between. The hand
list below is now a record of what was done, not the mechanism.

### Converted

| Site | Was | Now |
|---|---|---|
| `packages/web/tests/unit/server/register-scheduler.test.ts` | `expect(maxConcurrent).toBe(1)` after a real 150ms sleep with a 15ms interval and a 50ms callback, and `expect(callCount).toBeGreaterThanOrEqual(1)` after 100ms with a 30ms interval. A starved event loop delivers no tick in either window, and `maxConcurrent` comes back 0 with the overlap guard working perfectly. | Fake timers. The overlap test holds one cycle open with a gate across ten firings and asserts `getTaskUsage` was called once, then releases it and asserts the next firing runs a cycle — the guard must also let go. The interval test asserts nothing fired at 29ms and one tick fired at 30ms. Regressions injected: disabling the `running` guard gives 10 concurrent calls against a bound of 1; adding 5ms to the resolved interval fails the second — where `≥ 1` after 100ms passed it. |
| `packages/web/tests/integration/seam-register-scheduler.test.ts` | Four real 50–100ms waits for a 10ms interval, then `toHaveBeenCalled()` / `expect(fired).toBe(true)`. | Each test waits on a promise the injected callback resolves. A seam that never fires now trips vitest's timeout ("never called") instead of failing an assertion about something that merely had not happened yet. The broadcast test also gained the assertion it was named for: it slept 80ms and then checked only `collectAllIds`, never `broadcast`. |
| `packages/hench/tests/unit/store/run-retention-scheduler.test.ts` | `expect(broadcasts.length).toBeGreaterThanOrEqual(1)` after a 600ms wait on a 50ms interval. The comment acknowledged 100–200ms event-loop delays under full-monorepo load; the response had been to widen the window rather than remove the dependency on it. | Gated on the first `broadcast` call. |
| `packages/rex/tests/unit/store/file-lock.test.ts` | `expect(order).toEqual([...])` in two tests, resting on a real 5ms delay landing inside a real 50ms / 300ms critical section. | Promise gates: the holder signals that it owns the lock, the waiter is created, and the holder is released only afterwards — an unbounded hold rather than a 300ms approximation of one. An intermediate assertion proves the waiter did not run while the holder was inside. **Measured limit, recorded so it is not re-derived:** removing the in-process mutex is caught only intermittently, because the file lock refuses the second entrant independently and produces a rejection whose timing the filesystem decides. What the conversion guarantees is that the *passing* verdict is not a timing accident. |
| `packages/hench/tests/unit/queue/execution-queue.test.ts` | `expect(order).toEqual([...])` after a 10ms "allow all microtasks to settle" sleep, and three "simulate async work" sleeps of 1–10ms — one of them `Math.random() * 5`, so the interleaving a passing run exercised was unknown and unrepeatable. | `release()` shifts and resolves synchronously, so the FIFO test releases all three slots and awaits the three acquisitions; hand-off order is then microtask order. Work sleeps became microtask yields, staggered by index rather than by `Math.random()`. Injecting LIFO insertion fails the converted test in 0ms with a real diff — while the neighbouring unconverted FIFO test, which awaits each acquisition before the next release, deadlocks and reports a 30s timeout instead. |
| `packages/web/tests/unit/viewer/elapsed-time-memoization.test.ts` | `expect(formatElapsed(...)).toBe("30s")` on a fixture built from `Date.now()` a few statements before `formatElapsed` reads the clock again; a second of drift flips the string. | `vi.setSystemTime` pins the instant for the block. Fake timers were already installed by the outer `beforeEach`, but nothing fixed the instant they started from, so the two reads were equal by luck rather than by construction. |

`packages/rex/tests/integration/concurrent-write-lost-update.test.ts:224,284`
looks like this family and is not: its ordering is forced by explicit promise
gates, so load cannot reorder the verdict. Its `await sleep(150)` is a
*negative* window — it only gives the bug more chance to appear, and the gate
decides the verdict — which is why the scanner's `await`-free rule does not
flag it. That distinction is the rule, not an exemption: a sleep that must be
long enough for *correct* behaviour is the defect; a sleep that widens the
window for *broken* behaviour is sound.

### Open — real sleep before the assertion, not yet converted

Captured mechanically by the scanner at the time it was added, not reviewed
one by one. They are listed so the gate ratchets: anything **not** on this list
that matches must be converted or argued for. Do not read inclusion as
approval — read it as "this existed before the detector did".

Waiting on a spawned process or CLI:

- `tests/e2e/cli-prd-no-json-writes.test.js`
- `tests/e2e/cli-refresh.test.js`
- `tests/e2e/cli-start.test.js`
- `tests/e2e/cli-web.test.js`
- `tests/e2e/pair-programming-timeout-tree-kill.test.js`
- `tests/e2e/stop-orphan-children.test.js`
- `tests/integration/exec-interrupt-forwarding.test.js`
- `tests/integration/scheduler-startup.test.js`
- `tests/unit/web-port-occupant.test.js`
- `packages/hench/tests/integration/commit-msg-timer.test.ts`
- `packages/hench/tests/integration/git-mutation-failures.test.ts`
- `packages/hench/tests/integration/livelock-cli-spawn.test.ts`
- `packages/hench/tests/integration/stale-commit-msg-quarantine.test.ts`
- `packages/llm-client/tests/integration/exec-timeout-tree-kill.test.ts`
- `packages/rex/tests/e2e/cli-no-json-writes.test.ts`
- `packages/rex/tests/integration/backup-snapshots.test.ts`

Waiting on a server or socket:

- `packages/web/tests/integration/hench-runs-dashboard.test.ts`
- `packages/web/tests/integration/ws-health-integration.test.ts`
- `packages/web/tests/unit/server/routes-commands.test.ts`
- `packages/web/tests/unit/server/websocket.test.ts`
- `packages/web/tests/unit/server/ws-health-tracker.test.ts`

Waiting on a viewer effect or render:

- `packages/web/tests/unit/viewer/a11y-semantic-html.test.ts`
- `packages/web/tests/unit/viewer/next-steps-panel.test.ts`
- `packages/web/tests/unit/viewer/prune-diff-tree.test.ts`
- `packages/web/tests/unit/viewer/tier3-surfaces.test.ts`
- `packages/web/tests/unit/viewer/tree-event-delegate.test.ts`
- `packages/web/tests/unit/viewer/workspace-switcher.test.ts`
- `packages/web/tests/unit/viewer/workspaces-view.test.ts`

---

## Adding a new timed assertion

1. Try technique 1 first. For a tree or graph operation,
   `packages/web/tests/helpers/tree-work-count.ts` already counts traversal
   steps and Preact render work; `dom-performance-monitor.test.ts` counts DOM
   accesses.
2. If you reach for a clock, prefer a growth ratio, derive the bound by
   measuring clean *and* injecting the regression, and record both numbers next
   to the constant. `write-path-profile.test.ts` and `folder-tree-parser.test.ts`
   are the worked examples.
3. A ratio only cancels load when both readings face the same preemption risk.
   Measured here: `diffItems` timed across an 8x size step read 7.7x idle and
   46.5x loaded, because the small-size batch fits in a clean scheduler slice and
   the large one does not. Check that before trusting a ratio on cheap work — and
   be willing to conclude a ratio is not available. `SearchIndex.search` is
   fixed-cost dominated at any size a route test would serve (0.150ms at 250
   items, 0.182ms at 1000 — 1.21x for a 4x step), so the route's budget became a
   containment assertion instead.
4. A ratio's bound comes from the separation you measure, not from a convention.
   `folder-tree-parser.test.ts` uses `sizeRatio * 4` because its injected
   quadratic reads 128x against a linear 11x. `SearchIndex.rebuild` re-reads and
   re-parses the PRD file on every call, so I/O dominates the linear baseline and
   compresses the gap — clean 13.61x against an injected 63.26x, where `* 4`
   would be 64 and let the regression pass. Its bound is `sizeRatio * 2`. Copying
   the headroom from a neighbouring test is how a ratio goes quietly vacuous.
5. Absolute budget as a last resort, scaled through `BUDGET_MULTIPLIER`, named
   for the property it guards rather than for a millisecond figure — and never
   where the bound's job is to sit below another number.
6. Add a row here.
