---
id: "5a7bcd96-f8ce-4fb9-9c96-c88edc3cec79"
level: "task"
title: "Add diagnoseCliInvocation helper and wire it into spawn error paths (closes #68)"
status: "completed"
priority: "high"
tags:
  - "windows"
  - "llm-client"
  - "gh:68"
blockedBy:
  - "75258767-d3b2-4bb6-ab89-bed8627ca7e9"
source: "exploration-2026-07-10"
startedAt: "2026-07-10T17:02:41.110Z"
completedAt: "2026-07-10T17:10:22.481Z"
endedAt: "2026-07-10T17:10:22.481Z"
resolutionType: "code-change"
resolutionDetail: "TDD: 9 failing tests written first for diagnoseCliInvocation (both branches, with/without configKey). Implemented resolveExecutablePath (private, refactors isExecutableOnPath to delegate to it), CliInvocationDiagnosis type, and diagnoseCliInvocation in exec.ts. Exported from public.ts. Wired into cli-provider.ts (ENOENT handler + NOT_FOUND_PATTERNS block) and codex-cli-provider.ts (ENOENT handler), replacing ad-hoc pathNote message-building. Added 5 new assertions to public-api.test.ts for killWithFallback/quoteWindowsToken/buildWindowsCliCommandLine/spawnCli/diagnoseCliInvocation plus SpawnCliOptions/CliInvocationDiagnosis type imports. All 1117 non-pre-existing tests pass."
acceptanceCriteria:
  - "TDD: failing tests for BOTH branches (on-PATH-but-not-invokable, and not-found) written before implementation"
  - "diagnoseCliInvocation reuses the existing isExecutableOnPath helper in exec.ts; no duplicate PATH-resolution logic"
  - "Callable independently of a spawn attempt (no ChildProcess required) so #42's init/doctor can reuse it"
  - "Produces a distinct actionable message per branch naming the resolved path and a fix hint"
  - "Wired into the error paths of the CLI spawn sites, replacing the ad-hoc NOT_FOUND_PATTERNS / raw ENOENT handling"
description: "Add diagnoseCliInvocation(binary) to packages/llm-client/src/exec.ts. On a spawn failure it distinguishes: (a) the binary resolves on PATH (via the existing isExecutableOnPath helper, which uses `where` on win32) but is not invokable from a Node child process — e.g. a .cmd shim or a path containing spaces — versus (b) the binary is not found at all. It produces a specific, actionable message per case (the path it resolved to + likely cause + fix hint such as setting llm.<vendor>.cli_path). Must be callable OUTSIDE a spawn attempt so the future #42 install-time doctor/preflight can reuse the same logic. This is the piece that actually closes #68 (explicit diagnostics when an executable exists in the shell but is not invokable from a Node child process). Follow TDD: tests first."
---
