---
id: "f76c699d-d3d9-4f68-8425-e8d47a984a95"
level: "task"
title: "affected mode never runs run-options-contract, catalog-runtime-contract or prd-slug-conformance for the package-source change they police"
status: "in_progress"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
startedAt: "2026-10-07T16:55:45.496Z"
acceptanceCriteria:
  - "selectAffected for a packages/web/src/shared/run-options.ts-only change selects a suite that runs tests/e2e/run-options-contract.test.js, pinned by a unit test"
  - "selectAffected for a packages/llm-client/src/config.ts-only change selects a suite that runs tests/e2e/catalog-runtime-contract.test.js, pinned by a unit test"
  - "selectAffected for a packages/rex/src/store/-only change selects a suite that runs tests/e2e/prd-slug-conformance.test.js, pinned by a unit test"
  - "An audit of root tests that read package sources is recorded (in the log or the commit) listing each one and why it is or is not in a root subset"
  - "TESTING.md states root-drift's members and its re-measured time"
description: "Source: adversarial review of task c1e6e68c (root-drift label, commit 184f6d656). Verdict: should-fix — same class as #546 finding F1, which that task closed only for the four files it named.\n\nFailure: ROOT_DRIFT_TEST_FILES (scripts/lib/select-suites.mjs) lists prompt-census, iso-skill-drift, hench-config-gate-contract and instruction-alignment. Other root tests compare a package source outside src/cli/ against a copy or a checked-in artifact and are in neither root subset, so a change confined to that source selects [root-policy, root-drift, <pkg>, dependents] and never runs them:\n- tests/e2e/run-options-contract.test.js imports packages/web/src/shared/run-options.ts (a copy of hench's run-option table) and rex's RUN_SETTING_KEYS. Trigger: add an option to RUN_OPTION_SPECS in web/src/shared/run-options.ts only → selects [root-policy, root-drift, web]; gate green, CI red. Measured 3.1 s.\n- tests/e2e/catalog-runtime-contract.test.js pins packages/llm-client/src/config.ts DEFAULT_CLAUDE_MODEL / codex-cli-provider.ts DEFAULT_CODEX_MODEL against packages/core/llm-model-catalog.js. Trigger: change DEFAULT_CLAUDE_MODEL only → no root suite runs it.\n- tests/e2e/prd-slug-conformance.test.js imports packages/rex/src/store/folder-tree-serializer.ts and checks the committed .rex/prd_tree conforms. Trigger: change the slug rule in rex/src/store only → the committed tree's non-conformance is caught only in CI.\nReachable: any ndx work run on this repo (hench.testGate.command = run-all-tests.mjs affected {base}).\n\nOptions:\n1. (recommended) Audit tests/e2e and tests/integration for every root test that reads a package source outside src/cli/ and compares it to a copy or checked-in artifact; add the cheap ones to ROOT_DRIFT_TEST_FILES and re-measure root-drift (currently ~12-16 s). Cost: small; risk: root-drift grows a few seconds.\n2. Replace the hand list with a marker comment (e.g. `ROOT-DRIFT`) in each such test, discovered at selection time and pinned by a policy test so a new drift test cannot be forgotten. Cost: moderate; removes the recurrence, which this finding shows is the real defect."
lastModified: "2026-10-07T16:55:45.719Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
