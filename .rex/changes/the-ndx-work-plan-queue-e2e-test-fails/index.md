---
id: "76dabc63-c83b-4546-aa7c-7f4c6fe8153c"
type: "change"
title: "The ndx work --plan-queue e2e test fails: the plan JSON now carries changeTitle"
slug: "the-ndx-work-plan-queue-e2e-test-fails"
intent: "Out-of-scope finding from the adversarial review of 785c4836. Commit 36f22999e (\"run controls say Start and Live run; runnable rows name their change\") added `changeTitle` to each `PlannedLane` in packages/hench/src/queue/plan-queue.ts:227. tests/e2e/cli-work-plan-queue.test.js:56 checks `plan.lanes` with `toEqual` against an object that has no `changeTitle`. Reproduce: build hench, then run `node_modules/.bin/vitest run tests/e2e/cli-work-plan-queue.test.js`. The test fails with `+ \"changeTitle\": \"Add Apple Pay\"`. CI runs this suite, so the branch's PR will be red.\n\nVerdict: out-of-scope (pre-existing on the branch, not this task's change), severity medium.\n\nOptions:\n1. (Recommended) Add `changeTitle: \"Add Apple Pay\"` to the expected lane. This is cheap and pins the new field.\n2. Switch to `toMatchObject`. This is cheaper but stops catching unexpected new keys."
acceptanceCriteria:
  - "tests/e2e/cli-work-plan-queue.test.js passes against a freshly built hench"
  - "The e2e test's expected lane includes changeTitle, so dropping the field fails it"
touches:
  - "4ca9aac4-cd85-4af3-96d9-c4274e2d9f83"
priority: "medium"
discoveredFrom: {"item":"785c4836-0aff-4725-baca-33d10834bf42","run":"974ffffd-eeaf-4bfb-9bb5-76a64dcb1844"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
