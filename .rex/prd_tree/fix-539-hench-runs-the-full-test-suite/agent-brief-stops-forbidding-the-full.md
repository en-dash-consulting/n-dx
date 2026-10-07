---
id: "e512ac52-6918-46db-8efa-98e620b92952"
level: "task"
title: "agent brief stops forbidding the full suite when the test gate is skipped"
status: "in_progress"
priority: "medium"
startedAt: "2026-10-07T16:47:07.987Z"
acceptanceCriteria: []
description: "Source: adversarial review of fix/539-scoped-test-gate (#546) by Hal, posted on #530 on 2026-10-07. Finding F3, severity medium.\n\nFailure: the CLI agent brief's Validation section (packages/hench/src/agent/planning/prompt.ts:205-212) is guarded only by isCli. With ndx work --skip-test-gate or hench.skipFullTestGate set, the agent is still told not to run the whole repository suite because the gate runs after it finishes, and that finishing is not skipping validation because the gate still runs. Both are false under that flag: the agent runs scoped checks only, no gate runs, and the work is committed and the task completed with nothing having run the suite. The reviewer brief already has the right guard: cli-loop.ts:2127 passes testGateFollows: config.skipFullTestGate !== true. Traces to completed item 4ecb7c25, which specified the agent bullet with no skip condition.\n\nApproach: thread skipFullTestGate into buildSystemPrompt the way testGateFollows is threaded for the reviewer. When the gate is skipped, drop the do-not-run-the-whole-suite bullet and both gate-follows claims.\n\nAcceptance criteria:\n- With skipFullTestGate false, the CLI system prompt keeps today's Validation section verbatim, pinned by a test.\n- With skipFullTestGate true, the prompt contains neither 'Do not run the whole repository suite' nor 'the gate still runs', pinned by a test.\n- prompt-non-redundancy still passes: no new pnpm test or pnpm typecheck literal.\n- docs/analysis/prompt-token-baseline.{md,json} regenerated with node scripts/prompt-census.mjs --write in the same commit; tests/e2e/prompt-census.test.js passes."
lastModified: "2026-10-07T16:47:08.217Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
