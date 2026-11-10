---
id: "2cce9d4d-2f92-4c74-86bc-d319cb9409da"
type: "task"
title: "The Home Tune card repeats the Work card's run numbers"
slug: "the-home-tune-card-repeats-the-work"
description: "Verdict: should-fix (low). Found by adversarial review of 03b6cc9a.\n\nstageFacts in packages/web/src/viewer/views/stage-pages.ts handles analyze and plan explicitly and falls through to hench facts (runs / live / stale) for every other stage. Tune now takes that fallthrough too, so Home shows two cards with identical numbers, which reads as a bug and tells the reader nothing about Tune.\n\nOptions: give Tune its own facts (e.g. total runs and spend from token usage, or suggestions pending), or show none until S5 adds Outcomes by tier. Recommended: an explicit tune branch, empty until a Tune-specific number exists, so the fallthrough cannot reach new stages."
acceptanceCriteria:
  - "stageFacts has an explicit tune branch and no stage reaches the hench facts by fallthrough"
  - "A HomeView test asserts the Tune card's facts differ from the Work card's"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
