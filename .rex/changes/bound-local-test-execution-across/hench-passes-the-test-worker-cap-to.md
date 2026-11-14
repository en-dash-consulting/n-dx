---
id: "9861a7ad-5ff9-47b7-863e-b38ac6cd5da1"
type: "task"
title: "Hench passes the test worker cap to the runs it manages"
slug: "hench-passes-the-test-worker-cap-to"
description: "PR 1 of 3 (worker cap), task 2 of 3. Depends on the shared vitest helper (NDX_TEST_MAX_WORKERS).\n\nAdd `hench.testGate.maxWorkers` (positive integer, optional) to hench's config: the type and validation in packages/hench/src/schema/v1.ts and schema/validate.ts, loading in store/config.ts (including the `.n-dx.json` `hench.*` merge), and the CLI config metadata so `ndx config` can show and set it. Unset means hench sets nothing, so behaviour is unchanged.\n\nWhen set, hench puts `NDX_TEST_MAX_WORKERS=<n>` into the environment of every test command it runs:\n- the gate and its reruns (`runTestGate` in tools/test-runner.ts, called from finalizeRun in agent/lifecycle/shared.ts);\n- post-task tests (`runPostTaskTests`);\n- the completion check's test run (`validateCompletion` in validation/completion.ts);\n- the agent session's shell, so an agent's own `npx vitest` is capped too.\n\nThese commands get their environment from `repoCommandEnv` (llm-client, via prd/llm-gateway.ts), which sanitizes the child environment against a policy. Confirm the variable survives that sanitizing and the vendor CLI's env handling; if it is stripped, allow it through. The value only tightens what runs, so it is safe to take from repository config (constraint 1bb0333a); still follow the existing repository-trust handling for config values.\n\nTurn it on for this repository: set `hench.testGate.maxWorkers` to 2 in `.n-dx.json`.\n\nOperator notes:\n- Tests must not write `process.env.NDX_*` or call `vi.stubEnv(\"NDX_…\")`: assert on the env object passed to the exec helper.\n- Extend the schema round-trip tests so the new field survives save and load.\n- Run the static root policy tests before finishing (architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy, obfuscated-code-policy)."
acceptanceCriteria:
  - "hench.testGate.maxWorkers is accepted, validated as a positive integer, survives save/load, and appears in config metadata"
  - "When set, the gate, its reruns, post-task tests, the completion test run and the agent session's shell all receive NDX_TEST_MAX_WORKERS with that value"
  - "When unset, no test command's environment changes"
  - "This repository's .n-dx.json sets hench.testGate.maxWorkers to 2"
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-1-worker-cap"
source: "ndx-capture"
blockedBy:
  - "d34d2902-408a-4b05-9de9-7b2932aae778"
---
