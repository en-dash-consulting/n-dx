---
id: "93871c16-aeb7-4027-9b76-0054a992ba41"
level: "task"
title: "Offer only validated, path-scoped recovery commands after an uncommitted-work refusal"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "claims-hardening"
  - "wm-2048"
source: "caos work management: WM2048 (Offer only validated, path-scoped recovery commands after an uncommitted-work refusal); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "Every command in the refusal output carries an explicit pathspec limited to the listed paths (`git add -- <paths>`, `git commit -- <paths>`, `git stash push -- <paths>`)."
  - "Paths are existence-checked before being printed; a deleted path is shown with `git rm --cached -- <path>`."
  - "A unit test on the formatter asserts the output contains no unscoped git command and every path appears in a pathspec."
  - "A repo-wide test asserts no hench source string contains `git add -A` or `git add .`."
description: "When the uncommitted-work gate refuses completion, hench prints a refusal (formatUncommittedWorkRefusal and formatLoopRefusal in packages/hench/src/agent/lifecycle/uncommitted-work-gate.ts) listing the dirty paths and suggesting how to recover. The suggested commands must be limited to exactly the listed paths and must exist before being printed: no `git add -A`, no unscoped `git commit`, no `git stash` without a pathspec, because a broad command is how an unrelated in-flight change gets swept into a hench commit.\n\nImplementation notes: Rewrite formatUncommittedWorkRefusal, formatLoopRefusal and formatResetDeferredCommitSkipped in packages/hench/src/agent/lifecycle/uncommitted-work-gate.ts so every suggested command is scoped with `--` and the exact listed paths, existence-check each path (deleted paths get `git rm --cached -- <path>`), and never suggest -A, `.` or an unscoped stash. Add unit tests on the formatters' output and a policy test under tests/e2e or packages/hench/tests asserting no source file in packages/hench/src contains the strings 'git add -A' or 'git add .'. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-21T17:24:17.802Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
