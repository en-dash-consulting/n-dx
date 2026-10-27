---
id: "811cf124-3b65-4623-b72f-bfc000229d6a"
type: "task"
title: "Add getWorktreeRoot(cwd) to llm-client exec helpers and re-export it through the hench gateway"
slug: "add-getworktreeroot-cwd-to-llm-client"
description: "packages/llm-client/src/exec.ts already has getCurrentHead(cwd), getCurrentBranch(cwd) and sanitizeBranchName(). Add getWorktreeRoot(cwd): runs `git rev-parse --show-toplevel` (sync, matching its siblings), returns the realpath-resolved absolute path or null outside a repo; add getGitCommonDir(cwd) (`git rev-parse --git-common-dir`, resolved absolute) alongside since PR 6 and PR 10 need it. Re-export both through packages/hench/src/prd/llm-gateway.ts (next to getCurrentBranch at ~line 119) and through packages/web/src/server's gateway if web needs them later. Unit tests in llm-client for a repo, a linked worktree (git worktree add in a temp repo) and a non-repo directory."
acceptanceCriteria:
  - "getWorktreeRoot and getGitCommonDir exist in @n-dx/llm-client with tests covering main checkout, linked worktree and non-repo."
  - "Both are re-exported through packages/hench/src/prd/llm-gateway.ts; tests/e2e/domain-isolation.test.js passes."
priority: "critical"
tags:
  - "pr-02"
  - "llm-client"
  - "hench"
source: "parallel-development roadmap, 2026-09-10 discovery session"
---
