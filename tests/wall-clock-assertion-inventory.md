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

`tests/e2e/wall-clock-inventory-policy.test.js` scans for clock-derived
assertions and fails if a file holding one is not named anywhere in this file.
Being listed does not mean an assertion is *good* — it means somebody looked at
it and wrote down why it is still there.

---

## Converted — no clock remains

| Site | Was | Now |
|---|---|---|
| `packages/web/tests/unit/viewer/prd-tree-live-tick-perf.test.ts` | `expect(elapsedMs).toBeLessThan(16 * 10)` around a tick re-render. Observed at 420.10ms under full-suite load; the same file completes in 108ms run alone. | Counts Preact vnode diffs and DOM mutations (`countRenderWork`). A tick must diff under a third of a cold mount's vnodes and must not exceed one DOM mutation per in-progress row. Both regressions injected and confirmed failing. |
| `packages/web/tests/unit/viewer/large-tree-performance.test.ts` | 24 assertions of the form `expect(elapsed).toBeLessThan(N * BUDGET_MULTIPLIER)`, with `BUDGET_MULTIPLIER` hardcoded to `10` rather than read from `NDX_TEST_TIME_MULTIPLIER`. Three tests in this file failed under load and passed on a serial rerun. | Counts `children` reads on an instrumented fixture (`countTreeReads`) and Preact render work. Per-size tests bound reads per node; a separate block bounds each operation's growth across a 7.97x size step to 2x linear. An injected O(n²) measures 62.91x against a 15.94x bound. |
| `tests/e2e/vitest-timeout-failure.test.js:115` | `expect(result.durationMs).toBeLessThan(10_000)` next to an independent `spawnSync` `timeout: 10_000`. Two literals that had to stay equal, presented as a latency budget when a reading at the bound only ever means the child was killed. | Single named `FIXTURE_SPAWN_TIMEOUT_MS`, used for both, with the failure message stating that a reading at the bound means termination and that the guardrail — not the product — is what to raise. |

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

---

## Justified — clock retained deliberately

| Site | Assertion | Why it stays |
|---|---|---|
| `packages/hench/tests/unit/tools/shell.test.ts:272` | `expect(elapsed).toBeLessThan(TIMEOUT_COMMAND_LIFETIME_MS / 4)` | A *discriminating* bound: it separates "returned on timeout" (~200ms) from "waited for the command" (~60s). Already in the fraction-of-the-number-it-must-stay-under form TESTING.md prescribes, and deliberately not multiplier-scaled — scaling it to 40s would make both outcomes pass, which is the exact bug that form exists to prevent. |
| `packages/hench/tests/unit/store/run-change-detector.test.ts:154` | `expect(...mtimeMs).toBeGreaterThan(0)` | Filesystem mtime, not an elapsed measurement. Cannot be 0 for a file that exists. |
| `packages/web/tests/unit/server/routes-hench-audit.test.ts:73` | `expect(info.serverUptime).toBeGreaterThanOrEqual(0)` | Asserts the field is present and non-negative, not that any duration was achieved. Monotonic. |
| `packages/web/tests/unit/server/routes-hench-task-usage-rollup.test.ts:286,287,290` | `expect(...runningMs).toBeGreaterThanOrEqual(90_000)` | The fixture's start is `Date.now() - 90_000` and the server re-reads the clock later, so the delta can only grow. Load makes this *more* true, never less. |
| `packages/web/tests/unit/viewer/dom-performance-monitor.test.ts:988,992` | `expect(...durationMs).toBeGreaterThanOrEqual(0)` | Shape assertions on a recorded duration field. No bound to overshoot. |
| `packages/rex/tests/unit/store/folder-tree-parser.test.ts:957` | (comment only) | Prose recording that this file already replaced an absolute budget with a growth ratio. The reference implementation of technique 2, alongside `write-path-profile.test.ts`. |

---

## Open — clock-derived and not yet converted

Each of these is a real instance of the pattern this register exists to retire.
They were left alone rather than half-converted: each needs its own measurement
in both directions to pick a bound, which is the work TESTING.md rule 3 asks for
and not something to do blind. Tracked as PRD tasks under the "Make test results
independent of ambient environment and machine load" feature.

| Site | Assertion | Problem |
|---|---|---|
| `packages/rex/tests/integration/prd-tree-atomic-writes.test.ts:317` | `expect(median).toBeLessThan(500)` | Raw absolute constant, no multiplier. Already marked DEFERRED in place. |
| `packages/rex/tests/integration/prd-tree-atomic-writes.test.ts:340` | `expect(latency).toBeLessThan(500)` | Same. |
| `packages/rex/tests/integration/prd-tree-atomic-writes.test.ts:369` | `expect(addTime).toBeLessThanOrEqual(reserializeTime)` | Compares two independent micro-spans where the expected gap is small; one scheduling hiccup in the first span flips the verdict. Needs technique 1 — count the writes, which is what "no full-tree re-serialization" actually claims. |
| `packages/web/tests/unit/server/search-index.test.ts:524` | `expect(rebuildElapsed).toBeLessThan(5000)` | Absolute, no multiplier, directly beside a sibling on line 531 that does scale. Cannot simply be scaled: `5000 * 20` exceeds the package's 30s `testTimeout`, so the assertion would become unfailable. The claim is "rebuild is not super-linear" and wants a growth ratio over two index sizes. |
| `packages/web/tests/unit/server/routes-search.test.ts:250` | `expect(data.elapsed_ms).toBeLessThan(200)` | Absolute, no multiplier, beside a sibling on line 252 that scales. Server-measured elapsed returned over HTTP. |
| `packages/hench/tests/unit/cli/commands/run-loop.test.ts:75` | `expect(elapsed).toBeGreaterThanOrEqual(40)` | A *lower* bound on a real 50ms sleep. Multiplier scaling cannot help a `toBeGreaterThanOrEqual`, and a coarse or early-firing timer under-fires it. Wants fake timers. |
| `packages/web/tests/unit/viewer/dom-performance-monitor.test.ts:824` | `expect(elapsed).toBeLessThan(COUNT_1000_BUDGET_MS)` | Env-gated on `CODEX_CI` but not on `NDX_TEST_TIME_MULTIPLIER`. The same file's line 881 already counts traversal steps for its linearity claim, so technique 1 is available here. |

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
| `packages/web/tests/unit/server/routes-search.test.ts:252` | `expect(elapsed).toBeLessThan(500 * BUDGET_MULTIPLIER)` |
| `packages/web/tests/unit/server/search-index.test.ts:531` | `expect(searchElapsed).toBeLessThan(200 * BUDGET_MULTIPLIER)` |

---

## Not clock-derived, but load-sensitive for a different reason

The scanner does not detect these, and they are a different family: real timers
driving an *ordering* or *count* assertion. Recorded here so the sweep is
honest about its own edges rather than implying the register is complete.

| Site | Assertion | Note |
|---|---|---|
| `packages/web/tests/unit/server/register-scheduler.test.ts:159,180` | `expect(maxConcurrent).toBe(1)`, `expect(callCount).toBeGreaterThanOrEqual(1)` | 15–30ms intervals observed over a 100–150ms real window. A starved event loop yields zero ticks. |
| `packages/web/tests/integration/seam-register-scheduler.test.ts:83,121,166` | `toHaveBeenCalled()`, `expect(fired).toBe(true)` | 10ms intervals, 50–100ms real waits. |
| `packages/hench/tests/unit/store/run-retention-scheduler.test.ts:256` | `expect(broadcasts.length).toBeGreaterThanOrEqual(1)` | 50ms interval, 600ms wait. The comment already acknowledges 100–200ms event-loop delays; the response was widening the window, not removing the dependency. |
| `packages/rex/tests/unit/store/file-lock.test.ts:75,106` | `expect(order).toEqual([...])` | Ordering rests on a real 5ms delay landing inside a 50ms / 300ms critical section. |
| `packages/hench/tests/unit/queue/execution-queue.test.ts:213,345,346,366,384,385` | `expect(order).toEqual([...])`, `expect(maxObserved).toBeLessThanOrEqual(2)` | Real 1–10ms sleeps as the only settling barrier; line 361 adds `Math.random()` to the mix. |
| `packages/web/tests/unit/viewer/elapsed-time-memoization.test.ts:138,143` | `expect(formatElapsed(...)).toBe("30s")` | Fixture built from `Date.now()` a few statements before the assertion reads it again; ≥1s of drift between the two flips the expected string. |

`packages/rex/tests/integration/concurrent-write-lost-update.test.ts:224,284`
looks like this family and is not: its ordering is forced by explicit promise
gates, so load cannot reorder the verdict.

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
   the large one does not. Check that before trusting a ratio on cheap work.
4. Absolute budget as a last resort, scaled through `BUDGET_MULTIPLIER`, named
   for the property it guards rather than for a millisecond figure — and never
   where the bound's job is to sit below another number.
5. Add a row here.
