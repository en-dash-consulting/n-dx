---
"@n-dx/web": patch
---

test(web): count render and traversal work in the viewer tree performance suites instead of timing it

`large-tree-performance.test.ts` and `prd-tree-live-tick-perf.test.ts` held 25 of
the repo's elapsed-time assertions, all comparing `performance.now()` against an
absolute budget scaled by a `BUDGET_MULTIPLIER` hardcoded to `10` rather than read
from `NDX_TEST_TIME_MULTIPLIER`. Under full-suite load, the live-tick budget of
160ms measured 420.10ms while the same file completed in 108ms run alone. Raising
the budgets is not available — TESTING.md forbids padding one to green a suite,
and the next busier machine just fails at the new number.

Growth-ratio timing was tried first and rejected on measurement: `diffItems` timed
across an 8x size step read 7.7x idle and 46.5x loaded, because min-of-N filters
a ~4ms block and a ~30ms block differently. A ratio only cancels load when both
readings face the same preemption risk, which sub-millisecond work cannot give.

Both files now count work (TESTING.md Family 2, technique 1) via a new
`tests/helpers/tree-work-count.ts`:

- `countTreeReads` instruments the fixture's `children` arrays, so a traversal's
  step count is exact. Reads per node hold to three significant figures across a
  7.97x size range and are unchanged with every core saturated; an injected O(n²)
  reads 197.8 per node against a clean 1.18, and grows 62.91x against a 15.94x
  bound.
- `countRenderWork` counts vnodes diffed via Preact's `options.diffed` hook and
  DOM records via a `MutationObserver`. Both counters are needed: a broken
  `shouldComponentUpdate` gives 7 805 diffs / 442 mutations against a clean
  1 033 / 1, while churning row keys gives 263 / 512 — each regression is
  invisible to the other counter. Both were injected and confirmed failing.

Two non-timing assertions in the same file were also failing under load. Every
render is now unmounted: `useLiveTick` starts a real 1s `setInterval` while an
in-progress row is visible, so each render previously left a live interval
re-rendering a 500–2000 row tree for the rest of the file, free to interrupt a
later test mid-measurement.

The DOM-per-item assertion also stops guessing. It subtracted a hardcoded
`overheadEstimate = 200` for the tree's chrome; the real figure, measured by
rendering an empty document in the same process, is 9. It had been reporting 18.6
DOM nodes per row where the true value is 21.7 — passing, but not for the reason
it stated.

Full suite verified green with a concurrent `pnpm build` and every core saturated
(15-minute load average 24.6). No production behaviour changes.
