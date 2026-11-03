---
id: "b72a668d-4bf6-4c1c-9caf-a2a25f96e6ea"
type: "task"
title: "Tests ignore an ambient NDX_CLI_PATH, so graview's trust tests pass inside an ndx work gate"
slug: "tests-ignore-an-ambient-ndx-cli-path"
description: "PR 1, pre-existing defect found by T1's gate. packages/core/cli.js exports NDX_CLI_PATH and hench's test gate inherits it. graview's planProductFace (packages/graview/src/face.ts) then asks the real n-dx CLI for the graview-face sidecar, gets refused, and serve returns 2, so both tests in packages/graview/tests/integration/graview-app-trust.test.ts fail inside every ndx work gate while passing in CI. Reproduced on main 9efc25752. graview depends on llm-client, so the gates for T2, T3 and T5 would all hit it. Fix it the way NDX_AGENT_RUN is handled: delete it in tests/setup-session-env.js, which every suite loads."
acceptanceCriteria:
  - "tests/setup-session-env.js deletes NDX_CLI_PATH beside NDX_AGENT_RUN, with a comment saying why"
  - "With NDX_CLI_PATH exported to the real CLI, pnpm --filter @n-dx/graview exec vitest run tests/integration/graview-app-trust.test.ts passes (it fails on main)"
  - "Any test that needs NDX_CLI_PATH sets it on its own spawn; the graview suite and the root suite pass"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
---
