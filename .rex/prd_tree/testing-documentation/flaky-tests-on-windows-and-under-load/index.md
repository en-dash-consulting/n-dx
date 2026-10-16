---
id: "e0165015-12fe-4fae-86f6-86997e239da3"
level: "feature"
title: "Flaky tests on Windows and under load"
status: "pending"
priority: "high"
tags:
  - "flaky-test"
  - "ci-reliability"
  - "issue-cleanup"
source: "ndx-capture"
acceptanceCriteria:
  - "Every task below is complete and its issue is closed by the PR"
  - "Two CI runs on the final head pass every Windows job without a re-run"
description: "Six test flakes that cost CI re-runs: four on Windows (EBUSY at temp-dir teardown in hub-auth-token, sv serve and sv analyze e2e; a 5 s grandchild ready wait in stop-orphan-children) and two under parallel load (request-security's chunked 413 test hitting write EPIPE; prompt-census's staleness probe tripping architecture-policy). Each red Windows job costs a 15–20 minute re-run. Fix the tests, not product code, unless a flake proves to be a real product bug. One PR: fix/flaky-tests-windows-load. #783 (run-summary clock race) was already fixed by #786 and closed."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T21:28:44.614Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Give stop-orphan-children's grandchild ready wait a Windows-sized timeout and report elapsed time](./give-stop-orphan-children-s-grandchild.md) | pending |
| [Make the over-cap chunked-body 413 test accept the server hanging up mid-body](./make-the-over-cap-chunked-body-413.md) | pending |
| [Retry the hub-auth-token integration test's temp-dir removal on Windows](./retry-the-hub-auth-token-integration.md) | pending |
| [Retry the last bare .sourcevision removal in the sv analyze e2e test](./retry-the-last-bare-sourcevision.md) | pending |
| [Retry the sv serve e2e test's temp-dir removal on Windows](./retry-the-sv-serve-e2e-test-s-temp-dir.md) | pending |
| [Write the prompt-census staleness probe outside the scanned tree](./write-the-prompt-census-staleness.md) | pending |
