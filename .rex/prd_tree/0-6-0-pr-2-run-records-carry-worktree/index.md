---
id: "c5932c7b-be3e-4833-be7b-1fa6329cac5a"
level: "epic"
title: "0.6.0 / PR 2 · Run records carry worktree root and branch; auto-commits gated"
status: "pending"
priority: "critical"
tags:
  - "parallel-dev"
  - "release-0.6.0"
  - "pr-02"
  - "hench"
  - "llm-client"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "A run whose HEAD is moved to another branch mid-task produces no automatic commit on that branch and the operator sees a message naming expected and actual branch."
  - "A run that stays on its starting branch commits exactly as today."
  - "Run records in .hench/runs carry worktreeRoot, branch, ndxVersion and cliPath."
description: "Release 0.6.0 (minor) · PR 2 of 7 · packages: @n-dx/hench, @n-dx/llm-client · changeset: patch.\n\nProblem. A hench run's automatic commits are not bound to the branch or worktree the run started on. Every automatic commit runs `git` with cwd = projectDir (packages/hench/src/agent/lifecycle/shared.ts around lines 1231, 1294, 1303, 1321; commit-msg-watcher.ts:134; agent/analysis/review-repairs.ts:126). The run record (packages/hench/src/schema/v1.ts RunRecord) has no worktree root, branch, or n-dx version. The agent's git allowlist includes checkout and stash, so HEAD can move mid-run and the later commit lands wherever HEAD points.\n\nPrior art. Task ec994d3f-b324-46fd-838a-bc19d75953b5 on branch hotfix/hench-commit-branch-gate (commit ac3f0db6, worktree .claude/worktrees/sv-analyze-skip-worktrees-6915ea) describes this same fix. Start by reviewing that branch; rebase or cherry-pick what is usable, then complete the tasks here. Do not remove checkout or stash from the agent allowlist (separate decision). Do not change how projectDir is resolved.\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .`\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-10T20:11:35.659Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add getWorktreeRoot(cwd) to llm-client exec helpers and re-export it through the hench gateway](./add-getworktreeroot-cwd-to-llm-client.md) | completed |
| [Capture worktreeRoot and branch at run start and refuse automatic commits when they no longer match](./capture-worktreeroot-and-branch-at-run.md) | pending |
| [Run record carries the n-dx version and CLI path that produced it](./run-record-carries-the-n-dx-version.md) | pending |
| [Unit tests: matching branch commits; mismatched branch, detached HEAD and worktree-root mismatch are refused](./unit-tests-matching-branch-commits.md) | pending |
