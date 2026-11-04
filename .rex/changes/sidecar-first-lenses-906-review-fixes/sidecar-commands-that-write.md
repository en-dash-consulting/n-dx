---
id: "adafce1f-9a8f-4308-8ad3-34a2550f7479"
type: "task"
title: "Sidecar commands that write .sourcevision take the sourcevision write lock"
slug: "sidecar-commands-that-write"
description: "#906 F1 (medium, should-fix). startSidecarCommand (routes-commands.ts, via launchAsyncJob) never calls acquireSvWriteLock, so an approved or allow-listed run_command of `ndx analyze .`, `ndx ci .` or `ndx refresh .` runs alongside the dashboard's own analyze, CI or refresh, and two writers hit .sourcevision/ at once. The lock fails in both directions: while the Sidecar command runs, the dashboard buttons aren't refused either. That breaks the root concurrency contract (ndx refresh with any write command). M1's allow-list fix stops these being remembered, but a one-time approval still runs unlocked.\n\nDecided: option 1. Take the lock for .sourcevision writers, refuse with the holder's name, release when the job settles.\n\nSource: Adversarial review by Hal (endash-shal), 2026-11-04 on #906."
acceptanceCriteria:
  - "startSidecarCommand takes the .sourcevision write lock for an ndx subcommand that writes .sourcevision (analyze, ci, refresh, and any other the command manifest's writes effect names) and releases it when the job settles"
  - "While another job holds the lock the Sidecar command is refused naming the holder, as startAsyncJob refuses; while a Sidecar command holds it the dashboard's analyze, CI and refresh are refused"
  - "A test starts a Sidecar ndx analyze while sv-analyze holds the lock and asserts the refusal, and a second test asserts the lock is released after the Sidecar job ends"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "review:#906-F1"
source: "ndx-adversarial-review"
---
