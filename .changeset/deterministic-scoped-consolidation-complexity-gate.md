---
"@n-dx/rex": patch
---

test(rex): count comparisons instead of timing them in the scoped consolidation complexity gate

`add-auto-reshape.test.ts` asserted that the scoped consolidation pass grows
sub-quadratically by comparing two wall-clock readings. It failed on an idle
machine at 8.6x against an 8x bound, and failed reliably under the CPU load of an
`ndx work` run — which took the hench pre-commit test gate red on every task,
for reasons unrelated to the code under test.

Tuning the bound could not fix it. The readings were dominated by loading the
tree (26 vs 101 items) rather than by the cohort scan the test claimed to guard,
so the signal was a minority of what was measured and the noise floor sat at the
threshold. The test had already been hardened three times (absolute budget →
growth ratio, shared store → one store per size, single shot → min of 7).

It now counts calls to `similarity`, the pairwise content-comparison primitive
that defines the complexity: grouping by normalized title calls it once per
colliding pair, while comparing every sibling against every other calls it O(n²)
times. Counts are exact integers, so the result is identical on an idle machine
and a saturated one. Verified in the failing direction — a nested pairwise scan
added to `detectNonDuplicateTitleCollisions` took the 24-sibling count from 12 to
288 and the growth from 4x to 16x.

The test no longer builds a store or touches disk: ~35s of setup and a raised
60s timeout are gone, and the file runs in under 3s.

No production behaviour changes.
