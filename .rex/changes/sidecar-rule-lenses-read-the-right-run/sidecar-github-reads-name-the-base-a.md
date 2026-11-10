---
id: "0622d9eb-3019-4cc1-b19d-bc963b79b72e"
type: "task"
title: "Sidecar GitHub reads name the base a check fails on and stay behind git.branchHealth"
slug: "sidecar-github-reads-name-the-base-a"
description: "Review F3 (github.ts:90) and F4 (routes-sidecar.ts:318) on #945. F3: baseCheckResult labels any failing base 'Class: failing on main', so on a stacked PR (base = the parent layer) the model tells the operator main is failing. F4: github_read of kind pr runs readWorktreeBranchHealth (git merge-tree, gh pr view, gh run view --log-failed) while git.branchHealth is off, though GET /api/branch-health answers 404 then and the Diagnose branch lens is unavailable."
acceptanceCriteria:
  - "A check failing on its base reads 'Class: failing on main' only when base is the repository's default branch; on any other base it reads 'Class: failing on the base (<base>)'. The Diagnose branch instructions and the github_read tool description use the same two wordings (tested with a default-branch base and a stacked base)"
  - "While git.branchHealth is off, github_read of kind pr reads nothing and returns 'Nothing was read: the git.branchHealth feature is off.', and broker-mcp refuses it the same way before raising a network-read card, so the operator is never asked to approve a read that will be refused (tested: no collector call, no card)"
  - "github_read of kind check is unchanged by the git.branchHealth toggle, and every read stays behind web.sidecarGithubReads as before (existing tests keep passing)"
source: "ndx-capture"
---
