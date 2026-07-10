---
id: "a585caf7-a74d-4850-a9d9-046553359e47"
level: "task"
title: "Route the four CLI spawn sites through spawnCli"
status: "pending"
priority: "high"
tags:
  - "windows"
  - "llm-client"
  - "hench"
  - "gh:37"
  - "gh:69"
blockedBy:
  - "75258767-d3b2-4bb6-ab89-bed8627ca7e9"
  - "5a7bcd96-f8ce-4fb9-9c96-c88edc3cec79"
acceptanceCriteria:
  - "No CLI-binary spawn uses shell: process.platform === \"win32\" or shell:true+args anymore (all four sites)"
  - "Sites 1-3 call spawnCli; site 4 (core/config.js) uses the same cmd.exe recipe locally without importing llm-client"
  - "stdin piping, per-call timeouts, and SIGTERM/SIGKILL kill behavior preserved at every site"
  - "not-found/ENOENT diagnostics flow through diagnoseCliInvocation on both Windows and non-Windows"
  - "TDD: a test proves a routed site invokes a .cmd fixture without throwing EINVAL, including a binary path containing spaces"
  - "Fix carried over from task-2 review: cli-provider.ts passes 'claude.cli_path' to diagnoseCliInvocation (~lines 192 and 219) — correct it to 'llm.claude.cli_path' to match the codex sibling (codex-cli-provider.ts:238 uses 'llm.codex.cli_path') and the real .n-dx.json key"
  - "Baseline awareness: 6 pre-existing Windows test failures (4 in cli-provider.test.ts stdout-envelope, 2 in codex-cli-provider.test.ts rate-limit) also fail on origin/main and are NOT regressions from this work; ensure the total failing count does not increase, and note that routing the fake-CLI spawn through spawnCli may make some of the 4 envelope tests pass"
description: "Replace the fragile spawn(cliBinary, args, { shell: process.platform === \"win32\" }) pattern at all FOUR CLI-binary spawn sites discovered during exploration: (1) llm-client cli-provider.ts:139 (claude), (2) llm-client codex-cli-provider.ts:210 (codex), (3) hench cli-loop.ts:530 (spawnWithAdapter), and (4) core config.js:678 (testCliPath validator). Sites 1-3 call spawnCli from llm-client. Site 4 lives in the orchestration tier, which must NOT import llm-client (spawn-only rule, enforced by domain-isolation.test.js), so it applies the same cmd.exe verbatim recipe locally (~10 lines) rather than importing. Preserve stdin piping, per-call timeouts, and SIGTERM/SIGKILL at every site, and route not-found/ENOENT handling through diagnoseCliInvocation."
---
