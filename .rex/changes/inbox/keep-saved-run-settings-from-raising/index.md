---
id: "a9246960-2666-4298-b084-9cdeb64628cf"
type: "change"
title: "Keep saved run settings from raising the permission mode"
slug: "keep-saved-run-settings-from-raising"
intent: "A task's saved run block, an empty allowedGitSubcommands list and an untrusted guard.env.allow can each raise execution posture on the CLI path. Make saved settings only ever tighten the operator's values, and clamp env.allow on hench's own spawn path as core already does for the reviewer."
acceptanceCriteria:
  - "resolveRunPermissionMode never lets task.run raise permissionMode, provider, skipTestGate, tokenBudget or maxTurns above the invocation flag or hench.* value, with a unit test per field"
  - "The rex MCP server refuses a run block on add_item and edit_item while NDX_AGENT_RUN is set, and the rex validator rejects bypassPermissions in a saved run block"
  - "An explicit empty allowedGitSubcommands resolves to the language baseline, never to Bash(git:*); the schema requires at least one entry"
  - "While a repository is restricted, applyRepoTrust drops guard.env.allow on hench's CLI spawn and tool children, covered by a unit test in packages/hench/tests/unit/store/trust.test.ts"
priority: "high"
source: "ndx-capture"
---
