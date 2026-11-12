---
id: "8bc1f961-778d-4eac-8370-2cea280bfcb6"
type: "task"
title: "Work sets: `rex branch add/remove/show` and the MCP tool `assign_to_branch`"
slug: "work-sets-rex-branch-add-remove-show"
description: "Breakdown P2-1 task 3 (decision D2). Add `rex branch add <id>… [--move]`, `rex branch remove <id>…` and `rex branch show` (a new packages/rex/src/cli/commands/branch.ts, registered in the CLI and in help.ts), all acting on the current branch from the current-branch helper and writing through the work-set core functions inside withPrdModelTransaction. They accept the same ids other commands do (full ids, display ids, change ids). On the default branch or a detached HEAD they refuse, saying a work set belongs to a feature branch and to switch to one. `add` and `remove` print each task written (id, title, and for --move the branch it came from); `show` lists the set grouped by change with each task's status, and says when the branch has none. `--format=json` is supported. None of them commit. Add one MCP tool, `assign_to_branch` (packages/rex/src/cli/mcp-tools/, registered in the registry), with `ids: string[]`, optional `remove: boolean` and `move: boolean`; it uses the session's resolved workspace (mcp-workspace.ts), refuses while the workspace is refused and on the default branch or a detached HEAD, and returns what it wrote. Update packages/rex/tests/unit/cli/mcp-tools-list-snapshot.test.ts and the schema-coverage and tool-access tests that list every tool. Do not change edit_item. Operator notes: scope is P2-1 only. No dashboard UI, no 'Start a branch', no work-sets.json mirror, no cross-worktree refusal (P2-2 and P2-3, later PRs). hench reaches rex only through packages/hench/src/prd/rex-gateway.ts; read docs/architecture/gateways.md and the gateway ceiling in tests/e2e/architecture-policy.test.js before adding to it, and prefer one export over several. PRD writes go through withPrdModelTransaction. Run the static root policy suites before finishing (tests/e2e/architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code). Add a patch changeset (scoped name, e.g. @n-dx/rex) for every package you touch. Do not write under .claude/."
acceptanceCriteria:
  - "`rex branch add`, `remove` and `show` write, clear and list the current branch's set, refuse on main and on a detached HEAD, and do not commit (CLI tests)"
  - "`assign_to_branch` assigns, moves and removes, and the MCP tools-list snapshot includes it (MCP tests)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
blockedBy:
  - "7567a708-d942-448f-9869-3cbc2aed9bab"
  - "4f7ddb95-7409-4752-9c77-ab697ee66924"
---
