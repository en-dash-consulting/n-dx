---
id: "fadeee3e-7f86-49f9-8102-e6f5cdfbe033"
level: "task"
title: "Add ndx claim to list and release cross-worktree task claims"
status: "in_progress"
priority: "medium"
tags:
  - "0.7.1"
  - "claims-hardening"
  - "wm-2046"
blockedBy:
  - "8257feec-266e-412a-9881-c0b93dc5d53c"
source: "caos work management: WM2046 (Add ndx claim to list and release cross-worktree task claims); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "`ndx claim list` prints every live claim with task title, worktree, pid, alive/dead, expiry and reason; `--format=json` emits the same as JSON."
  - "`ndx claim release <taskId>` frees a claim whose pid is dead or whose reason is uncommitted-work; with a live pid it refuses unless --force and names the pid."
  - "`ndx claim release --all` frees this worktree's claims."
  - "Tests cover list, release, refusal and --force; `ndx --help` documents the command."
description: "Claims live in .git/ndx/claims.json in the shared git directory and today can be inspected only by reading the file or the dashboard's GET /api/rex/claims. Operators need a CLI to see who holds what and to free a claim that is held on purpose (after a refused completion) or stuck. Add a rex command with an ndx alias: list shows task id and title, worktree, pid, whether the pid is alive, expiry and held reason; release frees one task's claim, refusing if the holding pid is alive unless --force; release-all frees every claim held by this worktree.\n\nImplementation notes: Add a `claim` command to packages/rex/src/cli (subcommands list, release <taskId>, release --all, with --force and --format=json) built on openClaimsStore, resolveClaimHolder and defaultIsPidAlive in packages/rex/src/store/claims.ts, joining task ids to titles through the PRD store. Register an `ndx claim` alias in packages/core/cli.js that spawns the rex command (core must spawn, never import), and add help text in packages/core/help.js. Add unit tests for the store operations and an e2e test for the CLI surface in tests/e2e. If the claim record has a held reason (companion item), print it; otherwise print 'running'. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T20:15:39.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
