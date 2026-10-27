---
id: "da20dc09-9f7e-46f1-8772-5da52fa6a927"
type: "change"
title: "Flaky tests on Windows and under load"
slug: "flaky-tests-on-windows-and-under-load"
intent: "Six test flakes that cost CI re-runs: four on Windows (EBUSY at temp-dir teardown in hub-auth-token, sv serve and sv analyze e2e; a 5 s grandchild ready wait in stop-orphan-children) and two under parallel load (request-security's chunked 413 test hitting write EPIPE; prompt-census's staleness probe tripping architecture-policy). Each red Windows job costs a 15–20 minute re-run. Fix the tests, not product code, unless a flake proves to be a real product bug. One PR: fix/flaky-tests-windows-load-2 (replaces #821, whose v1 capture predates the v2 migration). #783 (run-summary clock race) was already fixed by #786 and closed."
acceptanceCriteria:
  - "Every task below is complete and its issue is closed by the PR"
  - "Two CI runs on the final head pass every Windows job without a re-run"
touches:
  - "3181cbc2-b8b7-45cf-98cc-abccadfe7352"
  - "8230a96e-0108-494d-879b-4a76f7ee4360"
priority: "high"
tags:
  - "flaky-test"
  - "ci-reliability"
  - "issue-cleanup"
source: "ndx-capture"
---
