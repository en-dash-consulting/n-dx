---
id: "92a4e1ed-adff-4386-8bf2-a0737945f204"
type: "task"
title: "Spring Boot scale test does not scale variable declarations, so the declaration sweep can regress unseen"
slug: "spring-boot-scale-test-does-not-scale"
description: "Verdict: should-fix (low), from the adversarial review of e36551f8c (task 77faf76b).\n\nScenario: packages/lang-java/tests/integration/spring-boot-scale.test.ts scales only call statements; the generated class has three fields and no locals. readOutbound's lookup from spring.variable.name to its spring.variable declaration (spring-boot.ts, the `declarationOf = innermostEach(variables, variableNames)` loop) was quadratic before e36551f8c (innermost per name over every declaration). Reverting that one line to `innermost(variables, name)` leaves the test at ~8x reads for an 8x step, so it passes; a generated file with thousands of locals would be quadratic again with no test failing.\n\nReachable: sv analyze with the Java pack, readSpringFile → readOutbound on any file with many local declarations. Not a current defect: the code is correct today; only the guard is missing.\n\nOptions:\n1. (Recommended) Have the generated method declare a local per call (e.g. `RestTemplate r${i} = rest;` every few lines) at both sizes, keeping the same read-count bound. Cost: a few lines; the facts assertions need their expected counts kept or updated.\n2. A second, smaller scale case for declarations alone.\n\nownerOf (methods × types) is not included: types per file are few, so even a revert stays near-linear."
acceptanceCriteria:
  - "The scale test's generated Java file declares local variables in proportion to its call count"
  - "Reverting the variable-declaration lookup in spring-boot.ts to a per-name innermost scan makes spring-boot-scale.test.ts fail"
  - "The read-count bound stays below 12.8 for the 1k-to-8k step on the current code"
priority: "low"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Take option 1. Test-only: change only packages/lang-java/tests (no src, query or golden change). Show in the log that the test fails when the declaration lookup is temporarily reverted to a per-name innermost scan, and passes on the current code; restore the code before committing. Keep the test's runtime reasonable (no more than about 20 s on the current code). Ship as one commit on feat/sv-lang-pr16b-spring-perf, no changeset (tests only)."}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-java"
  - "test-coverage"
source: "ndx-adversarial-review"
---
