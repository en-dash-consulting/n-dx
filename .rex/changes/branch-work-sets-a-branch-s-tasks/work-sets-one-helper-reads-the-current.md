---
id: "4f7ddb95-7409-4752-9c77-ab697ee66924"
type: "task"
title: "Work sets: one helper reads the current work-set branch, null on the default branch or a detached HEAD"
slug: "work-sets-one-helper-reads-the-current"
description: "Breakdown P2-1 task 2 (the current branch). Add one rex helper, e.g. `currentWorkSetBranch(projectDir): string | null`, that returns the workspace's checked-out branch (`git symbolic-ref --short HEAD` run in projectDir) and null when there is no work-set branch: the default branch, a detached HEAD, or no git repository. Reuse the default-branch logic in packages/rex/src/store/branch-naming.ts (resolveGitBranch, isDefaultBranch: origin/HEAD's target, else main, else master); do not add another origin/HEAD resolver. Callers pass the workspace directory they resolved (the MCP server's workspace.projectDir from roots, the CLI's dir argument), never process.cwd(). Export it so the CLI, the MCP tools and hench (through its rex gateway, in a later task) can use the one helper. Operator notes: scope is P2-1 only. No dashboard UI, no 'Start a branch', no work-sets.json mirror, no cross-worktree refusal (P2-2 and P2-3, later PRs). hench reaches rex only through packages/hench/src/prd/rex-gateway.ts; read docs/architecture/gateways.md and the gateway ceiling in tests/e2e/architecture-policy.test.js before adding to it, and prefer one export over several. PRD writes go through withPrdModelTransaction. Run the static root policy suites before finishing (tests/e2e/architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code). Add a patch changeset (scoped name, e.g. @n-dx/rex) for every package you touch. Do not write under .claude/."
acceptanceCriteria:
  - "Returns the branch name on a feature branch and null on main, on a detached HEAD and outside a git repository (tests with temporary repositories)"
  - "With no origin/HEAD, main is the default branch; with origin/HEAD naming another branch, that branch is (tests)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
