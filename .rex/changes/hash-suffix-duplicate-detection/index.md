---
id: "8d68561d-ae3e-4718-9842-1ac18ee56556"
type: "change"
title: "Hash-suffix duplicate detection ignores the documented oldest-createdAt tie-break"
slug: "hash-suffix-duplicate-detection"
intent: "packages/rex/src/analyze/add-reshape.ts (~94) documents \"oldest createdAt\" as the third tie-break for which suffixed sibling to keep, but the sort (~172–184) never reads createdAt. Trigger: two childless hash-suffixed siblings, the newer listed first — `detectHashSuffixDuplicates` keeps the newer one.\n\nReachable: yes, via add-time reshape on hash-suffixed duplicate titles.\n\nFix options: (1, recommended) add the createdAt comparison to the sort; small. (2) correct the doc if insertion order is the intended rule.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "Of two otherwise-equal hash-suffixed siblings, detection keeps the one with the older createdAt regardless of list order"
  - "A unit test lists the newer sibling first and asserts the older is kept"
touches:
  - "11be7299-0ef9-4b4e-808a-a09e98fe708e"
priority: "low"
source: "ndx-adversarial-review"
---
