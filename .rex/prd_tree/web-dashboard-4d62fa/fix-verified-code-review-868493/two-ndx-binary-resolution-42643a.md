---
id: "42643afb-78b5-4f73-96ca-1e08d66f58f4"
level: "task"
title: "Two ndx binary resolution ladder tests are red in packages/web"
status: "pending"
priority: "high"
tags:
  - "e2e-finding"
  - "failing-test"
  - "severity:high"
source: "ndx-capture"
acceptanceCriteria:
  - "Established whether the failures are a ladder-ordering regression in resolveNdxBin or environment dependence in the tests"
  - "Both tests pass on a clean checkout and on a machine with a project-local .bin/ndx present"
  - "If the tests were environment-dependent, they no longer depend on ambient state outside their fixture"
  - "pnpm run validate passes with no failing tests in packages/web"
description: "Surfaced by the adversarial reviewer running the full suite on run 60c3a951: `npm run test` reports 2 failed / 3066 passed / 7 skipped, with FAIL @n-dx/web.\n\nBoth failures are in packages/web/tests/unit/server/routes-commands.test.ts, describe block \"commands route -- ndx binary resolution ladder\":\n- :539 \"prefers the project-local .bin/ndx when present\" — expects spawnManaged's first argument to be the temp-dir bin path, receives \"node\"\n- :553 \"uses N_DX_CLI_PATH when set and no local bin exists\" — expects the temp path, receives the monorepo dogfood path\n\nConfirmed unrelated to the llm-client model-constant change that ran alongside: routes-commands.test.ts is not in that diff and the resolution ladder does not read model constants. So this is pre-existing red, not a regression from run 60c3a951.\n\nTriage note from the reviewer, worth honouring: both assertions embed machine-specific temp paths, so the first question is whether this is a genuine ladder-ordering regression or an environment-dependent test that fails only where a project-local .bin/ndx or N_DX_CLI_PATH happens to exist. That determines whether the code or the test is wrong. The nearest existing PRD item, \"resolveNdxBin: resolve @n-dx/core from the server module graph before the dogfood path\" (44bea9a4-d841-41b5-9a8b-cfe67d598298), is completed and describes the ladder these tests assert on, but nothing tracked the current red state."
lastModified: "2026-08-27T16:50:34.915Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
