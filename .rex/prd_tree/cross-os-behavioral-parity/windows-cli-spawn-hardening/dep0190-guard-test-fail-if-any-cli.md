---
id: "ba6e02f5-3d4e-49d0-a57b-6ba2632c36cf"
level: "task"
title: "DEP0190 guard test: fail if any CLI spawn reintroduces shell:true"
status: "completed"
priority: "medium"
tags:
  - "windows"
  - "testing"
  - "gh:37"
  - "gh:68"
blockedBy:
  - "ab2081f7-57bc-4ef1-9f61-4772eadcce2a"
startedAt: "2026-07-12T02:46:19.540Z"
completedAt: "2026-07-12T02:51:38.564Z"
endedAt: "2026-07-12T02:51:38.564Z"
resolutionType: "code-change"
resolutionDetail: "Added DEP0190 spawn guard describe block to tests/e2e/architecture-policy.test.js with two tests: (1) stale-entry guard for DEP0190_SCOPE list, (2) scan of 11 in-scope CLI spawn files for shell:process.platform (always banned) and shell:true with non-empty args (banned; empty-args pattern allowlisted for runShellTestCommand). Also added the new policy to DOCUMENTED_POLICIES and bumped count to 21."
acceptanceCriteria:
  - "Guard test fails if any CLI-binary spawn site reintroduces shell:true + args"
  - "PRECISION TRAP: all four routed sites now contain explanatory COMMENTS mentioning 'shell:true' (e.g. 'instead of shell:true+args'). The scan MUST match actual code, not comments — verify by confirming the test is GREEN on the current (correct) code, and RED when shell:true is reintroduced in real code. Also do not flag execShellCmd's intentional sh -c usage."
  - "Guard test lives with the other architecture-policy / boundary tests"
  - "Full suite still green with the guard in place"
description: "Add a cross-cutting guard test (architecture-policy style, alongside tests/e2e/architecture-policy.test.js) that scans CLI-binary spawn sites and FAILS if any reintroduces `shell: process.platform` or shell:true combined with an args array (the DEP0190 pattern). Scan scope now includes ALL sites routed on this branch: llm-client cli-provider.ts + codex-cli-provider.ts, hench cli-loop.ts + adapters (claude-cli-adapter.ts, codex-cli-adapter.ts), core config.js + pair-programming.js + the extracted win-spawn helper, and sourcevision's rex spawn modules. Known intentional exclusions to allowlist explicitly: exec.ts execShellCmd (sh -c by design), ci.js/pr-check.js pnpm spawns (documented follow-up). The per-feature correctness tests live in their own tasks — this is only the regression lock."
---
