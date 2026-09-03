---
id: "f987905c-6d6b-45cf-8a19-be3e58e5650b"
level: "task"
title: "Replace rex's wall-clock scaling assertion — it fails the gate under agent CPU load"
status: "pending"
priority: "high"
tags:
  - "rex"
  - "flaky-test"
  - "test-gate"
source: "ndx-capture"
acceptanceCriteria:
  - "The sub-quadratic regression check no longer asserts on wall-clock durations"
  - "The replacement measure is deterministic — repeated runs on a loaded machine produce identical values"
  - "The check still fails when the scoped consolidation pass is made quadratic (verified by deliberately regressing the implementation and observing the failure)"
  - "`npm run test` from the repo root exits 0 on this machine"
  - "If any wall-clock timing assertion is retained anywhere in the suite, it is excluded from the command the hench test gate runs"
  - "The repo is scanned for other wall-clock-threshold assertions; each is either converted or documented as gate-excluded"
description: "`packages/rex/tests/integration/add-auto-reshape.test.ts` > \"scoped pass cost grows sub-quadratically with sibling count\" asserts a ratio of two wall-clock timings:\n\n    AssertionError: scoped pass scaled 8.6x for a 4x sibling increase\n      (25: 55.9ms, 100: 483.1ms). It was linear (~4x) when this test was written;\n      a quadratic regression would show ~16x.\n      expected 8.63870904295717 to be less than 8\n\nThis is the single failure making `npm run test` exit 1 today (5/6 suites; 1 failed of 4644 in rex). It is inherently load-dependent: the 25-sibling baseline is 55.9ms, small enough that scheduler noise on a loaded machine dominates it, which inflates the ratio. An `ndx work` run saturates the CPU with the agent's own subprocesses at exactly the moment the gate runs — so this test is most likely to fail precisely when it is most costly, blocking commits and burning loop iterations.\n\nThe intent (catch a quadratic regression in the scoped consolidation pass) is worth keeping. The measurement is the problem: a threshold of 8 sitting between the expected 4x and the regression signal 16x leaves no room for timing noise, and no threshold on wall-clock will, given the baseline's magnitude.\n\nPrefer counting the work rather than timing it — comparisons, sibling visits, or store reads — which is deterministic and detects the same regression. If a timing measure must be retained, it belongs outside the pre-commit gate path."
lastModified: "2026-09-03T19:45:37.043Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
