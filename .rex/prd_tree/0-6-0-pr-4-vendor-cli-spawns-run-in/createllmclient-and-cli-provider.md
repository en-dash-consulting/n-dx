---
id: "1030134e-3060-4536-a1de-16f096164b1e"
level: "task"
title: "createLLMClient and cli-provider accept a cwd and the Ask route passes ctx.projectDir"
status: "pending"
priority: "high"
tags:
  - "pr-04"
  - "llm-client"
  - "web"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Ask requests spawn the vendor CLI with cwd = ctx.projectDir."
  - "llm-client unit test covers the cwd pass-through; web route test asserts the option is forwarded."
description: "Add an optional cwd to the LLM client options (packages/llm-client/src/index / client factory) threaded into cli-provider.ts's spawnCli call. Pass ctx.projectDir from routes-sourcevision-ask.ts and any other web call site that creates a client (grep createLLMClient in packages/web/src/server). Hench already passes cwd = projectDir in cli-loop.ts (~1760, ~1926); leave it. Unit test in packages/llm-client asserts spawn receives { cwd }. Do not change env handling (CLAUDECODE stripping) or argument construction."
lastModified: "2026-09-10T20:11:49.944Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
