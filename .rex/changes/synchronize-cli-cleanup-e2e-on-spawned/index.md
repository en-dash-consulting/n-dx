---
id: "a38db1f7-aae6-45d3-9753-2aa34bc8642d"
type: "change"
title: "Synchronize CLI cleanup E2E on spawned-child readiness"
slug: "synchronize-cli-cleanup-e2e-on-spawned"
intent: "PR #370 review found that tests/e2e/cli-ci-child-cleanup.test.js starts its 3-second PID deadline before ndx ci completes the preceding docs build. On macOS the successful-run case can fail before any fixture child starts. Make the fixture bypass or stub the unrelated docs build, or synchronize the assertion on an actual spawned-child readiness event; do not lengthen timing thresholds as the fix."
acceptanceCriteria:
  - "The successful-run cleanup assertion begins only after the fixture has emitted an observable spawned-child readiness signal, or the unrelated docs build is deterministically bypassed in this fixture."
  - "The test remains a real cleanup E2E: it proves fixture descendants are reaped and does not merely lengthen the PID deadline."
  - "The successful-run and SIGINT cases pass repeatedly on macOS, and the root child-cleanup suite is green."
  - "A patch changeset for @n-dx/core is included if production or shipped test behavior changes."
touches:
  - "8174c84e-2076-489b-8b2e-fadb75c0b386"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "macos"
  - "ci"
  - "process-lifecycle"
source: "ndx-adversarial-review"
blockedBy:
  - "1620e4cd-78b8-4835-82b4-14fd54cc3a45"
---
