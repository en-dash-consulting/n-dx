---
id: "a125725d-45df-498c-894a-ef1548243e4a"
level: "feature"
title: "Autonomous review capture"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "autonomous-review-capture"
source: "caos work management: feature ndx 0.7.1 - Autonomous review capture (follow-up from the guards run, 2026-09-22)"
acceptanceCriteria:
  - "Every finding in .hench/reviews/<run>.json carries a disposition (fixed, dropped, offered, deferred) and, where relevant, a reason."
  - "An autonomous --review run records deferred findings instead of dropping them and prints their count and location at the end of the run."
  - "A CLI command lists deferred findings for a run without opening the JSON by hand."
  - "Interactive review behaviour is unchanged."
description: "ndx work --review runs an adversarial review after each task and offers its findings for capture into the PRD, but the capture gate requires a person to select findings at a prompt. In autonomous mode there is no person at the prompt, so every deferred finding is dropped: across three reviewed runs in one session, one, then two, then four findings were offered and lost, two of them rated should-fix, and each survived only in terminal scrollback. The review record on disk carries severity and text but no disposition, so nothing downstream can even find a dropped finding. This feature gives every finding a recorded disposition and gives autonomous runs a non-interactive way to park deferred findings where the operator sees them after the run. Every 0.7.1 lane is recommended with --review, so this lands before those lanes open.\n\nGoal: no review finding is lost because nobody was at the prompt; every finding has a recorded fate and deferred ones surface to the operator after the run."
lastModified: "2026-09-22T02:47:33.576Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add a disposition field to review records](./add-a-disposition-field-to-review.md) | pending |
| [Park deferred review findings as a pending-capture queue in autonomous mode](./park-deferred-review-findings-as-a.md) | pending |
