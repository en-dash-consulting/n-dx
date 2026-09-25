---
id: "da6ed767-ff0b-4eec-b647-bc55109f087a"
level: "task"
title: "Discount .hench/mcp/ as hench runtime state in the uncommitted-work gates"
status: "pending"
priority: "critical"
tags:
  - "0.7.2"
  - "hench"
  - "hotfix"
source: "ndx-capture"
acceptanceCriteria:
  - ".hench/mcp/ is in HENCH_RUNTIME_GITIGNORE_ENTRIES (packages/hench/src/store/artifacts.ts), so the completion gate, the pre-run gate and the loop gate all discount it and hench init writes it to .gitignore"
  - "A regression test shows that an untracked .hench/mcp/<runId>.json, in a git repo whose .gitignore does not list .hench/mcp/, is not reported as uncommitted work by findUncommittedWork"
  - "The exact-list assertion in packages/hench/tests/unit/agent/pre-run-gate-own-state.test.ts includes .hench/mcp/"
  - "The comment above writeAgentMcpConfig in packages/hench/src/process/agent-mcp-config.ts no longer claims all of .hench/ is gitignored, and points to HENCH_RUNTIME_GITIGNORE_ENTRIES"
  - "A patch changeset for @n-dx/hench describes the fix and the 0.7.1 workaround (add .hench/mcp/ to .gitignore)"
  - "No behaviour change outside the runtime-artifact list: the MCP config still lives under .hench/mcp/ and the withdraw/reset path is untouched"
  - "hench unit tests pass"
description: "J4 (#416) writes `.hench/mcp/<runId>.json` for every Claude-vendor run (packages/hench/src/process/agent-mcp-config.ts, `agentMcpConfigPath` / `writeAgentMcpConfig`, called from cli-loop.ts before the agent spawns). `HENCH_RUNTIME_GITIGNORE_ENTRIES` in packages/hench/src/store/artifacts.ts does not list `.hench/mcp/`, and `excludeHenchRuntimeArtifacts` only discounts that list. So in any project whose .gitignore lacks `.hench/mcp/` — nearly every existing consumer; n-dx's own .gitignore has it, which is why dogfooding never tripped it — `findUncommittedWork` (uncommitted-work-gate.ts, called from agent/lifecycle/shared.ts) reports the file as the run's uncommitted work, the completion is refused, and `withdrawCompletionClaim` resets the task to pending. The pre-run gate and the loop gate use the same list, and the file persists for 7 days, so the next run can be refused too. `packages/core/assistant-assets/ndx.gitignore` already lists `.hench/mcp/`; only hench's list is missing it.\n\nScope: the minimal fix only, for a same-day 0.7.2. Out of scope (separate follow-ups): moving the config to os.tmpdir(), making withdrawCompletionClaim leave a completion that is already committed on HEAD alone, and allowing the rex MCP write tools in the spawned session's --allowed-tools.\n\nWorking notes for this run: do not edit anything under .rex/ by hand — hench records the task's completion after the gate. `pnpm` is not an allowed command in this project; run tests with `npx vitest run <path>` from the repo root."
lastModified: "2026-09-25T17:49:04.146Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
