---
id: "391a5838-082d-4b5d-928e-7759329ad87a"
type: "task"
title: "No test fails if rex_update_status stops passing the worker cap to requirement validation"
slug: "no-test-fails-if-rex-update-status"
summary: "A test only checks the helper that runs requirement checks, not the step that hands it the worker limit, so that step could silently break."
description: "Verdict: should-fix (low). Found by adversarial review of commit 9f67254e0.\n\nScenario: someone drops the second argument at packages/hench/src/tools/rex.ts:80 (`createCommandExecutor(options.projectDir, options.testMaxWorkers)` back to `createCommandExecutor(options.projectDir)`). `testMaxWorkers` is optional, so it still compiles. tests/integration/test-worker-cap.test.ts only probes createCommandExecutor directly, so every test stays green while API-loop requirement validation runs vitest uncapped again.\n\nReachable: API loops (claude-api, local, google) via rex_update_status → toolRexUpdateStatus → validateAutomatedRequirements, for requirements with validation commands.\n\nOptions:\n1. (Recommended) Integration test through toolRexUpdateStatus: temp git project with a committed change, a PRD store holding a task with an automated requirement whose command is the existing NDX_TEST_MAX_WORKERS probe, call with testMaxWorkers: 3, assert no [REQUIREMENTS_FAILED]. Cost: fixture setup (store + git), ~40 lines. Risk: none.\n2. Make testMaxWorkers a required (number | undefined) parameter so the call site cannot omit it. Cheaper, but only guards omission, not passing the wrong value."
acceptanceCriteria:
  - "A test calls toolRexUpdateStatus with testMaxWorkers set and a requirement whose validation command checks NDX_TEST_MAX_WORKERS, and it fails if rex.ts stops passing options.testMaxWorkers to createCommandExecutor"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "validation-gate"
source: "ndx-adversarial-review"
---
