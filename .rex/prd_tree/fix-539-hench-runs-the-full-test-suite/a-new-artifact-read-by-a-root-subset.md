---
id: "b0944ccf-271e-4dd7-ae7e-5e5cbe44f055"
level: "task"
title: "a new artifact read by a root-subset test but missing from VALIDATED_ARTIFACTS is not detected"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Adding a tests/*.md path read via readFileSync/join by a ROOT_POLICY_TEST_FILES test, without a VALIDATED_ARTIFACTS entry, fails a unit test"
  - "The test passes on the current tree with the five existing entries"
description: "Found by the adversarial review of task e51ab955 (F2 fix). Verdict: should-fix, low — no current failure.\n\ntests/unit/select-suites.test.js (\"validated artifacts\") checks the map in one direction only: each listed artifact's test exists, mentions the path, and runs in the mapped subset. Nothing checks the reverse. Scenario: someone adds tests/foo-inventory.md read by a new policy test in ROOT_POLICY_TEST_FILES and forgets the map → editing that inventory alone selects [] again (F2 recurs), and every unit test stays green.\n\nOption (recommended): a unit test that scans each file in ROOT_SUBSET_TEST_FILES for string literals naming a tests/*.md or docs/** path (and join(ROOT, \"tests\", \"x.md\") forms) and requires each to be a VALIDATED_ARTIFACTS key with that subset. Cost: one test, a regex; risk: false positives from @see comments — restrict to readFileSync/join arguments or allowlist."
lastModified: "2026-10-07T16:43:32.892Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
