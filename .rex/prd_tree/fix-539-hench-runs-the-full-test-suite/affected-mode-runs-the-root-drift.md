---
id: "c1e6e68c-ec4e-41ed-9c1c-5542c949fc58"
level: "task"
title: "affected mode runs the root drift tests when a package source changes"
status: "in_progress"
priority: "high"
startedAt: "2026-10-07T16:19:09.629Z"
acceptanceCriteria: []
description: "Source: adversarial review of fix/539-scoped-test-gate (#546) by Hal, posted on #530 on 2026-10-07. Finding F1, severity high.\n\nFailure: ROOT_POLICY_TEST_FILES (scripts/lib/select-suites.mjs:27) lists six static policy files, and the root rule (:180-190) selects full root only for src/cli/ changes. Root tests that catch a package source drifting from a checked-in artifact are not in the list, so a change inside packages/<dir>/src/ outside src/cli/ never runs them at the gate: tests/e2e/prompt-census.test.js, tests/e2e/iso-skill-drift.test.js, tests/e2e/hench-config-gate-contract.test.js and tests/e2e/instruction-alignment.test.js. Measured: packages/hench/src/agent/planning/prompt.ts selects [root-policy, hench]; packages/sourcevision/src/export/iso-map.ts selects [root-policy, sourcevision, web]; packages/hench/src/schema/validate.ts selects [root-policy, hench]. The gate goes green, hench commits, and CI goes red after the run. This is the unfinished half of completed item e3c0e72f.\n\nApproach: add the four files to ROOT_POLICY_TEST_FILES (recommended). Measure first: if root-policy then takes more than about 10 s, use a separate root-drift label instead, selected on the same condition and documented separately.\n\nAcceptance criteria:\n- prompt-census, iso-skill-drift, hench-config-gate-contract and instruction-alignment run whenever a change under packages/<dir>/src/ selects root-policy and not full root.\n- A unit test pins the selection for a prompt.ts-only change and for a packages/sourcevision/src/export/-only change, and fails before the fix.\n- The existing every-listed-file-exists-on-disk unit test covers the added entries.\n- node scripts/run-all-tests.mjs root-policy completes within the time TESTING.md states, and that figure is updated.\n- TESTING.md's Running a subset of suites section lists the new members."
lastModified: "2026-10-07T16:19:09.833Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
