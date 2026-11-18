---
id: "5ebf7eba-b5c3-4c21-b09b-80eed9399acb"
type: "task"
title: "P1: bound the PHP pack's memory by releasing per-file captures and narrowing dynamic.scm"
slug: "p1-bound-the-php-pack-s-memory-by"
summary: "Stops analysis of very large legacy PHP sites from running out of memory and failing outright."
description: "#1082 review P1 (high), lang-php `dynamic.scm` and the runner (`readDynamicCode`, `databaseFeeds`); PR 10 commits b2c0f00d3 / ea5345e41.\n\nMeasured on the review: ten copies of a 900 KB class file (9 MB of PHP) with every kind enabled peaked at 1.55 GB (0.98 GB at PR 10); `imports` alone 224 MB. With `--max-old-space-size=1024`, 27 MB of PHP aborts with \"heap out of memory\"; the default heap runs out at roughly 35–90 MB of PHP (Magento 1, Drupal 7 with contrib, WordPress with many plugins). PR 12 measured 1.75 GB peak RSS on a 346 MB repository. The abort is not contained, so the whole analysis fails where main would have finished.\n\nCause: `dynamic.scm` captures every argument, array element, assignment, member access and `.` operand, and the runner, `readDynamicCode` and `databaseFeeds` keep every file's captures alive at once.\n\nFix, in order of effect (measure after each):\n1. Release each file's captures once its frameworks have read them (or process files in batches), keeping only the derived facts.\n2. Narrow `dynamic.scm` to the arguments of known sinks and the assignments that feed them.\n3. Contain an out-of-memory risk: if a file's captures exceed a cap, record a notice and skip that file's dynamic-code facts rather than failing the pack.\n\nFacts produced must be identical on the pack's existing fixtures. Add a memory regression test (generated input, e.g. 20 MB of PHP built in the test) asserting peak heap stays under a stated bound, skipped when the grammar is not built. Report before/after peak heap in the resolution detail."
acceptanceCriteria:
  - "Peak heap on the generated 20 MB input is bounded and stated, well under the review's figure"
  - "Dynamic-code and database-feed facts are identical on existing fixtures"
  - "A file whose captures exceed the cap yields a notice, not a failed pack"
priority: "high"
run: {"tier":"heavy","review":true,"skipTestGate":true}
tags:
  - "lang-php"
  - "performance"
---
